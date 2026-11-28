import JSZip from 'jszip';
import type { ExtractedApkInfo } from '../types.ts';

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_XML_START_ELEMENT = 0x0102;

const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_STRING = 0x03;

function sdkToAndroidVersion(sdk: number): string {
  if (sdk >= 35) return 'Android 15+';
  if (sdk === 34) return 'Android 14+';
  if (sdk === 33) return 'Android 13+';
  if (sdk >= 31) return 'Android 12+';
  if (sdk === 30) return 'Android 11+';
  if (sdk === 29) return 'Android 10+';
  if (sdk === 28) return 'Android 9.0+';
  if (sdk >= 26) return 'Android 8.0+';
  if (sdk >= 24) return 'Android 7.0+';
  if (sdk >= 23) return 'Android 6.0+';
  if (sdk >= 21) return 'Android 5.0+';
  if (sdk > 0) return `Android SDK ${sdk}+`;
  return 'Android 8.0+';
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function decodeUtf16Le(bytes: Uint8Array): string {
  return new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
}

function readLength8(view: DataView, offset: number): [number, number] {
  const first = view.getUint8(offset);
  if ((first & 0x80) !== 0) {
    const second = view.getUint8(offset + 1);
    return [((first & 0x7f) << 8) | second, offset + 2];
  }
  return [first, offset + 1];
}

function readLength16(view: DataView, offset: number): [number, number] {
  const first = view.getUint16(offset, true);
  if ((first & 0x8000) !== 0) {
    const second = view.getUint16(offset + 2, true);
    return [((first & 0x7fff) << 16) | second, offset + 4];
  }
  return [first, offset + 2];
}

interface ParsedManifest {
  packageName: string;
  versionName: string;
  versionCode: string;
  appLabel: string;
  minAndroid: string;
  permissionsCount: number;
}

function parseBinaryAndroidManifest(buffer: ArrayBuffer): ParsedManifest {
  const result: ParsedManifest = {
    packageName: '',
    versionName: '',
    versionCode: '',
    appLabel: '',
    minAndroid: 'Android 8.0+',
    permissionsCount: 0,
  };

  if (buffer.byteLength < 16) return result;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const fileType = view.getUint16(0, true);
  if (fileType !== 0x0003) {
    // Fallback: maybe plain text XML (e.g. demo or custom package)
    const text = decodeUtf8(bytes);
    const pkgMatch = text.match(/package=["']([^"']+)["']/);
    const verNameMatch = text.match(/versionName=["']([^"']+)["']/);
    const verCodeMatch = text.match(/versionCode=["']([^"']+)["']/);
    const labelMatch = text.match(/android:label=["']([^"'@]+)["']/);
    const minSdkMatch = text.match(/minSdkVersion=["'](\d+)["']/);
    const permMatches = text.match(/uses-permission/g);

    if (pkgMatch) result.packageName = pkgMatch[1];
    if (verNameMatch) result.versionName = verNameMatch[1];
    if (verCodeMatch) result.versionCode = verCodeMatch[1];
    if (labelMatch) result.appLabel = labelMatch[1];
    if (minSdkMatch) result.minAndroid = sdkToAndroidVersion(Number(minSdkMatch[1]));
    if (permMatches) result.permissionsCount = permMatches.length;
    return result;
  }

  const headerSize = view.getUint16(2, true);
  let offset = headerSize;
  const strings: string[] = [];

  while (offset + 8 <= buffer.byteLength) {
    const chunkType = view.getUint16(offset, true);
    const chunkHeaderSize = view.getUint16(offset + 2, true);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkSize < 8 || offset + chunkSize > buffer.byteLength) break;

    if (chunkType === CHUNK_STRING_POOL && chunkSize >= 28) {
      const stringCount = view.getUint32(offset + 8, true);
      const flags = view.getUint32(offset + 16, true);
      const stringsStart = view.getUint32(offset + 20, true);
      const isUtf8 = (flags & 0x00000100) !== 0;

      const offsetsBase = offset + chunkHeaderSize;
      const poolBase = offset + stringsStart;

      for (let i = 0; i < stringCount; i++) {
        const strOffPos = offsetsBase + i * 4;
        if (strOffPos + 4 > offset + chunkSize) break;
        const relOffset = view.getUint32(strOffPos, true);
        let pos = poolBase + relOffset;
        if (pos >= offset + chunkSize) {
          strings.push('');
          continue;
        }

        if (isUtf8) {
          const [, afterCharLen] = readLength8(view, pos);
          const [byteLen, dataStart] = readLength8(view, afterCharLen);
          const end = Math.min(dataStart + byteLen, offset + chunkSize);
          strings.push(decodeUtf8(bytes.subarray(dataStart, end)));
        } else {
          const [charLen, dataStart] = readLength16(view, pos);
          const end = Math.min(dataStart + charLen * 2, offset + chunkSize);
          strings.push(decodeUtf16Le(bytes.subarray(dataStart, end)));
        }
      }
    } else if (chunkType === CHUNK_XML_START_ELEMENT && chunkSize >= 36) {
      const nameIdx = view.getInt32(offset + 20, true);
      const attrStart = view.getUint16(offset + 24, true);
      const attrSize = view.getUint16(offset + 26, true);
      const attrCount = view.getUint16(offset + 28, true);
      const tagName = nameIdx >= 0 && nameIdx < strings.length ? strings[nameIdx] : '';

      if (tagName === 'uses-permission') {
        result.permissionsCount += 1;
      }

      const attrsBase = offset + 16 + attrStart;
      for (let a = 0; a < attrCount; a++) {
        const attrOff = attrsBase + a * attrSize;
        if (attrOff + 20 > offset + chunkSize) break;

        const attrNameIdx = view.getInt32(attrOff + 4, true);
        const rawValueIdx = view.getInt32(attrOff + 8, true);
        const valueType = view.getUint8(attrOff + 15);
        const valueData = view.getInt32(attrOff + 16, true);

        const attrName = attrNameIdx >= 0 && attrNameIdx < strings.length ? strings[attrNameIdx] : '';
        let attrVal = '';

        if (rawValueIdx >= 0 && rawValueIdx < strings.length) {
          attrVal = strings[rawValueIdx];
        } else if (valueType === TYPE_STRING && valueData >= 0 && valueData < strings.length) {
          attrVal = strings[valueData];
        } else if (valueType === TYPE_INT_DEC || valueType === TYPE_INT_HEX) {
          attrVal = String(valueData);
        }

        if (tagName === 'manifest') {
          if (attrName === 'package' && attrVal) result.packageName = attrVal;
          if (attrName === 'versionName' && attrVal) result.versionName = attrVal;
          if (attrName === 'versionCode' && attrVal) result.versionCode = attrVal;
        } else if (tagName === 'uses-sdk') {
          if (attrName === 'minSdkVersion') {
            const sdkNum = Number(attrVal || valueData);
            if (!Number.isNaN(sdkNum) && sdkNum > 0) {
              result.minAndroid = sdkToAndroidVersion(sdkNum);
            }
          }
        } else if (tagName === 'application') {
          if (attrName === 'label' && attrVal && !attrVal.startsWith('@')) {
            result.appLabel = attrVal;
          }
        }
      }
    }

    offset += chunkSize;
  }

  return result;
}

function scoreIconCandidate(path: string, sizeBytes: number): number {
  const lower = path.toLowerCase();
  if (lower.endsWith('.9.png')) return -1;
  if (
    lower.includes('abc_') ||
    lower.includes('notification') ||
    lower.includes('ic_stat') ||
    lower.includes('ic_menu') ||
    lower.includes('btn_') ||
    lower.includes('common_google') ||
    lower.includes('design_')
  ) {
    return -1;
  }

  let score = 0;
  if (lower.includes('ic_launcher.png') || lower.includes('ic_launcher.webp')) score += 140;
  else if (lower.includes('ic_launcher_foreground')) score += 110;
  else if (lower.includes('ic_launcher_round')) score += 105;
  else if (lower.includes('ic_launcher')) score += 95;
  else if (lower.includes('app_icon') || lower.includes('appicon')) score += 90;
  else if (/\/(icon|ic_app|logo)\.(png|webp|jpg|jpeg)$/.test(lower)) score += 80;
  else if (lower.includes('mipmap') && lower.includes('icon')) score += 65;
  else if (lower.includes('mipmap')) score += 45;
  else if (lower.includes('icon')) score += 30;
  else return -1;

  if (lower.includes('xxxhdpi')) score += 60;
  else if (lower.includes('xxhdpi')) score += 50;
  else if (lower.includes('xhdpi')) score += 40;
  else if (lower.includes('hdpi')) score += 30;
  else if (lower.includes('mdpi')) score += 20;
  else if (lower.includes('nodpi') || lower.includes('anydpi')) score += 15;

  if (lower.endsWith('.png')) score += 10;
  else if (lower.endsWith('.webp')) score += 8;

  // Prefer larger sharp icons (capped at 40 bonus points)
  score += Math.min(sizeBytes / 1024, 40);
  return score;
}

function getMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/png';
}

function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function parseApkFile(file: File): Promise<ExtractedApkInfo> {
  const sizeMB = Number((file.size / (1024 * 1024)).toFixed(2));
  const fallbackName = file.name.replace(/\.apk$/i, '').replace(/[-_]+/g, ' ').trim();

  const defaults: ExtractedApkInfo = {
    packageName: `com.appstore.${fallbackName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'package'}`,
    versionName: '1.0.0',
    versionCode: '1',
    appLabel: fallbackName || 'تطبيق أندرويد',
    minAndroid: 'Android 8.0+',
    permissionsCount: 0,
    sizeMB: Math.max(sizeMB, 0.01),
    isValidZipApk: false,
    isBinaryManifest: false,
    isSignedApk: false,
    iconDataUrl: null,
    iconBlob: null,
    iconFilename: null,
    iconSourcePath: null,
  };

  try {
    const arrayBuffer = await file.arrayBuffer();
    const header = new Uint8Array(arrayBuffer.slice(0, 4));
    const hasZipMagic =
      header.length === 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07);
    if (!hasZipMagic) {
      defaults.validationError = 'الملف المحدد ليس حزمة APK صالحة (ترويسة ZIP غير مطابقة).';
      return defaults;
    }

    const zip = await JSZip.loadAsync(arrayBuffer);

    const manifestEntry = zip.file('AndroidManifest.xml');
    if (!manifestEntry) {
      defaults.validationError = 'الملف مضغوط لكنه لا يحتوي على ملف AndroidManifest.xml.';
      return defaults;
    }

    defaults.isValidZipApk = true;
    const manifestBuffer = await manifestEntry.async('arraybuffer');
    if (manifestBuffer.byteLength >= 4) {
      const mView = new DataView(manifestBuffer);
      defaults.isBinaryManifest = mView.getUint16(0, true) === 0x0003;
    }

    const fileNames = Object.keys(zip.files);
    const hasMetaInfCert = fileNames.some((n) =>
      /^META-INF\/.+\.(RSA|DSA|EC|SF)$/i.test(n)
    );
    const hasV2SigBlock = decodeUtf8(new Uint8Array(arrayBuffer)).includes('APK Sig Block 42');
    defaults.isSignedApk = hasMetaInfCert || hasV2SigBlock;

    const parsed = parseBinaryAndroidManifest(manifestBuffer);
    if (parsed.packageName) defaults.packageName = parsed.packageName;
    if (parsed.versionName) defaults.versionName = parsed.versionName;
    if (parsed.versionCode) defaults.versionCode = parsed.versionCode;
    if (parsed.appLabel) defaults.appLabel = parsed.appLabel;
    if (parsed.minAndroid) defaults.minAndroid = parsed.minAndroid;
    defaults.permissionsCount = parsed.permissionsCount;

    // Find best icon inside the APK archive
    let bestPath: string | null = null;
    let bestScore = -1;
    let bestBytes: Uint8Array | null = null;

    const imageEntries = Object.values(zip.files).filter(
      (entry) =>
        !entry.dir &&
        /\.(png|webp|jpg|jpeg)$/i.test(entry.name) &&
        (entry.name.startsWith('res/') || entry.name.startsWith('assets/') || !entry.name.includes('/'))
    );

    for (const entry of imageEntries) {
      const quickScore = scoreIconCandidate(entry.name, 4096);
      if (quickScore < 0) continue;

      const bytes = await entry.async('uint8array');
      const finalScore = scoreIconCandidate(entry.name, bytes.byteLength);
      if (finalScore > bestScore && bytes.byteLength > 100) {
        bestScore = finalScore;
        bestPath = entry.name;
        bestBytes = bytes;
      }
    }

    if (bestPath && bestBytes) {
      const mimeType = getMimeType(bestPath);
      const ext = mimeType === 'image/webp' ? 'webp' : mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const base64 = arrayBufferToBase64(bestBytes);
      const safeBytes = new Uint8Array(bestBytes);
      defaults.iconDataUrl = `data:${mimeType};base64,${base64}`;
      defaults.iconBlob = new Blob([safeBytes], { type: mimeType });
      defaults.iconFilename = `extracted-icon.${ext}`;
      defaults.iconSourcePath = bestPath;
    }
  } catch {
    defaults.validationError = 'تعذر فحص حزمة APK؛ قد يكون الملف تالفاً أو غير مكتمل.';
  }

  return defaults;
}
