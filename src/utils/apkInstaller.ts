import type { StoreApp } from '../types.ts';
import {
  localBuildOrFetchApkBlob,
  localHasStoredApkBlob,
  localIncrementInstall,
  localVerifyApkBlob,
} from './localStoreEngine.ts';
import { recordAppDownload } from './installHistory.ts';

export type InstallStage = 'idle' | 'verifying' | 'downloading' | 'launching' | 'ready' | 'error';

export interface InstallProgressState {
  stage: InstallStage;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface ApkVerificationInfo {
  isBinaryManifest: boolean;
  isSignedApk: boolean;
  signatureScheme?: string | null;
  signerCertSha256?: string | null;
  sha256?: string | null;
  externalApkUrl?: string | null;
  viaBlob?: boolean;
}

export interface CompletedInstallArtifact {
  filename: string;
  apkBlob: Blob | null;
  apkFile: File | null;
  blobUrl: string | null;
  intentUrl: string | null;
  directHttpsUrl: string | null;
  canShareFile: boolean;
  autoTriggered: boolean;
  apkCheckInfo: ApkVerificationInfo;
  updatedDownloads: number;
}

const APK_MIME = 'application/vnd.android.package-archive';

export function buildAndroidInstallerIntentUrl(httpsApkUrl: string): string | null {
  try {
    const parsed = new URL(httpsApkUrl, window.location.origin);
    if (parsed.protocol !== 'https:') return null;
    const urlWithoutScheme = `${parsed.host}${parsed.pathname}${parsed.search}`;
    return `intent://${urlWithoutScheme}#Intent;scheme=https;action=android.intent.action.VIEW;type=${APK_MIME};S.browser_fallback_url=${encodeURIComponent(
      parsed.toString()
    )};end`;
  } catch {
    return null;
  }
}

export function triggerBlobOrUrlHandoff(href: string, filename: string, isExternal = false): void {
  const link = document.createElement('a');
  link.href = href;
  link.setAttribute('download', filename);
  if (isExternal) {
    link.rel = 'noopener noreferrer';
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function openApkInAndroidInstaller(artifact: CompletedInstallArtifact): Promise<'shared' | 'intent' | 'download'> {
  if (
    artifact.apkFile &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      if (navigator.canShare({ files: [artifact.apkFile] })) {
        await navigator.share({
          files: [artifact.apkFile],
          title: artifact.filename,
        });
        return 'shared';
      }
    } catch {
      // Fall through to intent/download handoff
    }
  }

  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  if (isAndroid && artifact.intentUrl) {
    window.location.href = artifact.intentUrl;
    return 'intent';
  }

  if (artifact.blobUrl) {
    triggerBlobOrUrlHandoff(artifact.blobUrl, artifact.filename);
    return 'download';
  }

  if (artifact.directHttpsUrl) {
    triggerBlobOrUrlHandoff(artifact.directHttpsUrl, artifact.filename, true);
    return 'download';
  }

  return 'download';
}

async function streamDownloadApkBlob(
  url: string,
  expectedBytes: number,
  onChunk: (downloaded: number, total: number) => void
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error('Unexpected HTML response');
  }

  const headerLen = Number(res.headers.get('content-length') || '0') || expectedBytes;
  if (!res.body) {
    const ab = await res.arrayBuffer();
    onChunk(ab.byteLength, Math.max(headerLen, ab.byteLength));
    return new Blob([ab], { type: APK_MIME });
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onChunk(loaded, Math.max(headerLen, loaded));
    }
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([merged], { type: APK_MIME });
}

export async function runDirectApkInstall(
  app: StoreApp,
  onProgress: (state: InstallProgressState) => void,
  onDownloadsChanged?: (nextDownloads: number) => void
): Promise<CompletedInstallArtifact | null> {
  const filename = `${app.packageName}-v${app.versionName}.apk`;
  onProgress({ stage: 'verifying', percent: 12, downloadedBytes: 0, totalBytes: 0 });

  let backendOnline = false;
  let verified = false;
  let resolvedExternalUrl: string | null = null;
  let resolvedSha256: string | null = app.apkSha256 || null;
  let expectedSizeBytes = Math.round((app.sizeMB || 1) * 1024 * 1024);
  let apkCheckInfo: ApkVerificationInfo = {
    isBinaryManifest: Boolean(app.isBinaryManifest),
    isSignedApk: Boolean(app.isSignedApk),
    signatureScheme: app.signatureScheme || null,
    signerCertSha256: app.signerCertSha256 || null,
    sha256: resolvedSha256,
    externalApkUrl: app.externalApkUrl || null,
    viaBlob: false,
  };

  try {
    const verifyRes = await fetch(`./api/apps/${encodeURIComponent(app.id)}/verify-apk`);
    const ct = verifyRes.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      backendOnline = true;
      if (!verifyRes.ok) {
        onProgress({
          stage: 'error',
          percent: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          error: 'تعذر العثور على حزمة APK الخاصة بهذا التطبيق.',
        });
        return null;
      }
      const vData = (await verifyRes.json()) as {
        valid: boolean;
        isBinaryManifest: boolean;
        isSignedApk: boolean;
        signatureScheme?: string | null;
        signerCertSha256?: string | null;
        sha256?: string | null;
        externalApkUrl?: string | null;
        hasCustomApk?: boolean;
        sizeBytes?: number;
      };
      if (!vData.valid) {
        onProgress({
          stage: 'error',
          percent: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          error: 'ملف APK تالف أو غير مكتمل، تم إيقاف التثبيت لحماية جهازك.',
        });
        return null;
      }
      if (vData.sizeBytes && vData.sizeBytes > 0) {
        expectedSizeBytes = vData.sizeBytes;
      }
      resolvedExternalUrl = !vData.hasCustomApk && vData.externalApkUrl ? vData.externalApkUrl : null;
      resolvedSha256 = vData.sha256 || resolvedSha256;
      apkCheckInfo = {
        isBinaryManifest: Boolean(vData.isBinaryManifest),
        isSignedApk: Boolean(vData.isSignedApk),
        signatureScheme: vData.signatureScheme || app.signatureScheme || null,
        signerCertSha256: vData.signerCertSha256 || app.signerCertSha256 || null,
        sha256: resolvedSha256,
        externalApkUrl: vData.externalApkUrl || app.externalApkUrl || null,
        viaBlob: false,
      };
      verified = true;
    }
  } catch {
    backendOnline = false;
  }

  if (!backendOnline) {
    const hasLocalBlob = await localHasStoredApkBlob(app.id);
    const safeExternal =
      app.externalApkUrl && /^https:\/\/[^\s@]+$/.test(app.externalApkUrl)
        ? app.externalApkUrl
        : null;
    if (app.hasCustomApk && !safeExternal && !hasLocalBlob) {
      onProgress({
        stage: 'error',
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        error:
          'تعذر العثور على حزمة APK على الخادم؛ هذا التطبيق منشور من جهاز آخر على الاستضافة الثابتة دون رابط HTTPS مباشر. يرجى من المطور إضافة رابط تنزيل APK مباشر (HTTPS) أو النشر عبر خادم Play55 الكامل.',
      });
      return null;
    }
    const localCheck = await localVerifyApkBlob(app);
    if (!localCheck.valid) {
      onProgress({
        stage: 'error',
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        error: 'ملف APK تالف أو غير مكتمل، يرجى من المطور إعادة رفع حزمة صالحة.',
      });
      return null;
    }
    resolvedExternalUrl = localCheck.externalApkUrl || safeExternal || null;
    resolvedSha256 = localCheck.sha256 || resolvedSha256;
    apkCheckInfo = {
      isBinaryManifest: localCheck.isBinaryManifest,
      isSignedApk: localCheck.isSignedApk,
      signatureScheme: localCheck.signatureScheme || app.signatureScheme || null,
      signerCertSha256: app.signerCertSha256 || null,
      sha256: resolvedSha256,
      externalApkUrl: resolvedExternalUrl,
      viaBlob: !resolvedExternalUrl,
    };
    verified = true;
  }

  if (!verified) {
    onProgress({
      stage: 'error',
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: 'تعذر التحقق من سلامة ملف APK.',
    });
    return null;
  }

  onProgress({
    stage: 'downloading',
    percent: 20,
    downloadedBytes: 0,
    totalBytes: expectedSizeBytes,
  });

  let updatedDownloads = app.downloads;
  if (backendOnline) {
    try {
      const res = await fetch(`./api/apps/${encodeURIComponent(app.id)}/install`, {
        method: 'POST',
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = (await res.json()) as { downloads: number };
        updatedDownloads = data.downloads;
        onDownloadsChanged?.(updatedDownloads);
      }
    } catch {
      // Non-blocking counter update
    }
  } else {
    updatedDownloads = await localIncrementInstall(app).catch(() => app.downloads + 1);
    onDownloadsChanged?.(updatedDownloads);
  }

  let apkBlob: Blob | null = null;
  let directHttpsUrl: string | null = resolvedExternalUrl;

  if (resolvedExternalUrl) {
    try {
      apkBlob = await streamDownloadApkBlob(
        resolvedExternalUrl,
        expectedSizeBytes,
        (downloaded, total) => {
          const pct = total > 0 ? Math.min(94, Math.round(20 + (downloaded / total) * 74)) : 60;
          onProgress({
            stage: 'downloading',
            percent: pct,
            downloadedBytes: downloaded,
            totalBytes: total,
          });
        }
      );
    } catch {
      // Third-party HTTPS host may disallow CORS fetch; direct browser handoff still works
      apkBlob = null;
    }
  } else if (backendOnline) {
    const installEndpoint = `./api/apps/${encodeURIComponent(app.id)}/install-apk`;
    directHttpsUrl =
      typeof window !== 'undefined'
        ? new URL(`./api/apps/${encodeURIComponent(app.id)}/install-apk?mode=open`, window.location.href).toString()
        : null;
    try {
      apkBlob = await streamDownloadApkBlob(
        installEndpoint,
        expectedSizeBytes,
        (downloaded, total) => {
          const pct = total > 0 ? Math.min(94, Math.round(20 + (downloaded / total) * 74)) : 60;
          onProgress({
            stage: 'downloading',
            percent: pct,
            downloadedBytes: downloaded,
            totalBytes: total,
          });
        }
      );
    } catch {
      apkBlob = null;
    }
  } else {
    const rawBlob = await localBuildOrFetchApkBlob(app);
    apkBlob = new Blob([rawBlob], { type: APK_MIME });
    onProgress({
      stage: 'downloading',
      percent: 94,
      downloadedBytes: apkBlob.size,
      totalBytes: apkBlob.size,
    });
  }

  onProgress({
    stage: 'launching',
    percent: 98,
    downloadedBytes: apkBlob?.size || expectedSizeBytes,
    totalBytes: apkBlob?.size || expectedSizeBytes,
  });

  const apkFile = apkBlob ? new File([apkBlob], filename, { type: APK_MIME }) : null;
  const blobUrl = apkBlob ? URL.createObjectURL(apkBlob) : null;
  const intentUrl = directHttpsUrl ? buildAndroidInstallerIntentUrl(directHttpsUrl) : null;

  let canShareFile = false;
  if (
    apkFile &&
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      canShareFile = navigator.canShare({ files: [apkFile] });
    } catch {
      canShareFile = false;
    }
  }

  // Automatically trigger immediate post-download handoff as soon as download completes (no File Manager needed)
  if (blobUrl) {
    triggerBlobOrUrlHandoff(blobUrl, filename);
  } else if (directHttpsUrl) {
    triggerBlobOrUrlHandoff(directHttpsUrl, filename, true);
  }

  recordAppDownload(app, resolvedSha256);

  onProgress({
    stage: 'ready',
    percent: 100,
    downloadedBytes: apkBlob?.size || expectedSizeBytes,
    totalBytes: apkBlob?.size || expectedSizeBytes,
  });

  return {
    filename,
    apkBlob,
    apkFile,
    blobUrl,
    intentUrl,
    directHttpsUrl,
    canShareFile,
    autoTriggered: true,
    apkCheckInfo,
    updatedDownloads,
  };
}
