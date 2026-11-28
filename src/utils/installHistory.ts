import type { StoreApp } from '../types.ts';

const STORAGE_KEY = 'play55_downloaded_apps_v1';
export const INSTALL_HISTORY_EVENT = 'play55-install-history-changed';

export interface DownloadedAppRecord {
  appId: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  apkSha256?: string;
  apkFilename?: string;
  updatedAt: string;
  downloadedAt: string;
}

export type AppDownloadStatus = 'install' | 'update' | 'installed';

let memoryHistory: Record<string, DownloadedAppRecord> = {};

function readRawHistory(): Record<string, DownloadedAppRecord> {
  if (typeof window === 'undefined') {
    return { ...memoryHistory };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...memoryHistory };
    const parsed = JSON.parse(raw) as Record<string, DownloadedAppRecord>;
    if (!parsed || typeof parsed !== 'object') return { ...memoryHistory };
    memoryHistory = { ...parsed };
    return { ...parsed };
  } catch {
    return { ...memoryHistory };
  }
}

function writeRawHistory(nextMap: Record<string, DownloadedAppRecord>): void {
  memoryHistory = { ...nextMap };
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMap));
  } catch {
    // Keep memory copy if storage quota or private mode blocks localStorage
  }
  try {
    window.dispatchEvent(new CustomEvent(INSTALL_HISTORY_EVENT));
  } catch {
    // Ignore CustomEvent issues
  }
}

export function getDownloadedAppsMap(): Record<string, DownloadedAppRecord> {
  return readRawHistory();
}

export function recordAppDownload(app: StoreApp, overrideSha256?: string | null): void {
  const current = readRawHistory();
  current[app.id] = {
    appId: app.id,
    packageName: app.packageName,
    versionName: app.versionName,
    versionCode: app.versionCode,
    apkSha256: overrideSha256 || app.apkSha256,
    apkFilename: app.apkFilename || undefined,
    updatedAt: app.updatedAt,
    downloadedAt: new Date().toISOString(),
  };
  writeRawHistory(current);
}

export function compareVersionStrings(a: string, b: string): number {
  const cleanA = a.replace(/^v/i, '').trim();
  const cleanB = b.replace(/^v/i, '').trim();
  if (cleanA === cleanB) return 0;

  const partsA = cleanA.split(/[.\-_+]/).filter(Boolean);
  const partsB = cleanB.split(/[.\-_+]/).filter(Boolean);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const rawA = partsA[i] ?? '0';
    const rawB = partsB[i] ?? '0';
    const numA = /^\d+$/.test(rawA) ? Number(rawA) : NaN;
    const numB = /^\d+$/.test(rawB) ? Number(rawB) : NaN;

    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      if (numA !== numB) return numA > numB ? 1 : -1;
    } else if (rawA !== rawB) {
      return rawA.localeCompare(rawB);
    }
  }
  return 0;
}

export function getAppDownloadInfo(
  app: StoreApp,
  historyMap: Record<string, DownloadedAppRecord>
): {
  status: AppDownloadStatus;
  previousRecord: DownloadedAppRecord | null;
} {
  const record = historyMap[app.id] || null;
  if (!record) {
    return { status: 'install', previousRecord: null };
  }

  const codeCurrent = /^\d+$/.test(app.versionCode.trim()) ? Number(app.versionCode.trim()) : NaN;
  const codePrev = /^\d+$/.test(record.versionCode.trim()) ? Number(record.versionCode.trim()) : NaN;

  if (!Number.isNaN(codeCurrent) && !Number.isNaN(codePrev) && codeCurrent > codePrev) {
    return { status: 'update', previousRecord: record };
  }

  if (compareVersionStrings(app.versionName, record.versionName) > 0) {
    return { status: 'update', previousRecord: record };
  }

  if (
    app.versionName.trim() !== record.versionName.trim() ||
    app.versionCode.trim() !== record.versionCode.trim()
  ) {
    return { status: 'update', previousRecord: record };
  }

  if (app.apkSha256 && record.apkSha256 && app.apkSha256 !== record.apkSha256) {
    return { status: 'update', previousRecord: record };
  }

  if (
    app.apkFilename &&
    record.apkFilename &&
    app.apkFilename !== record.apkFilename &&
    new Date(app.updatedAt).getTime() > new Date(record.downloadedAt).getTime()
  ) {
    return { status: 'update', previousRecord: record };
  }

  return { status: 'installed', previousRecord: record };
}
