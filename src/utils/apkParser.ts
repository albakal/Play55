import JSZip from 'jszip';
import type { ExtractedApkInfo } from '../types.ts';

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_TABLE = 0x0002;
const CHUNK_XML_START_ELEMENT = 0x0102;
const CHUNK_TABLE_PACKAGE = 0x0200;
const CHUNK_TABLE_TYPE = 0x0201;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

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

function parseStringPool(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  chunkHeaderSize: number,
  chunkSize: number
): string[] {
  const strings: string[] = [];
  if (chunkSize < 28 || offset + chunkSize > bytes.byteLength) return strings;

  const stringCount = view.getUint32(offset + 8, true);
  const flags = view.getUint32(offset + 16, true);
  const stringsStart = view.getUint32(offset + 20, true);
  const isUtf8 = (flags & 0x00000100) !== 0;

  const offsetsBase = offset + chunkHeaderSize;
  const poolBase = offset + stringsStart;
  const chunkEnd = offset + chunkSize;

  const safeCount = Math.min(stringCount, 200_000);
  for (let i = 0; i < safeCount; i++) {
    const strOffPos = offsetsBase + i * 4;
    if (strOffPos + 4 > chunkEnd) break;
    const relOffset = view.getUint32(strOffPos, true);
    const pos = poolBase + relOffset;
    if (pos >= chunkEnd) {
      strings.push('');
      continue;
    }

    if (isUtf8) {
      if (pos + 2 > chunkEnd) {
        strings.push('');
        continue;
      }
      const [, afterCharLen] = readLength8(view, pos);
      if (afterCharLen + 1 > chunkEnd) {
        strings.push('');
        continue;
      }
      const [byteLen, dataStart] = readLength8(view, afterCharLen);
      const end = Math.min(dataStart + byteLen, chunkEnd);
      if (dataStart > end) {
        strings.push('');
        continue;
      }
      strings.push(decodeUtf8(bytes.subarray(dataStart, end)));
    } else {
      if (pos + 2 > chunkEnd) {
        strings.push('');
        continue;
      }
      const [charLen, dataStart] = readLength16(view, pos);
      const end = Math.min(dataStart + charLen * 2, chunkEnd);
      if (dataStart > end) {
        strings.push('');
        continue;
      }
      strings.push(decodeUtf16Le(bytes.subarray(dataStart, end)));
    }
  }
  return strings;
}

interface ParsedManifest {
  packageName: string;
  versionName: string;
  versionCode: string;
  appLabel: string;
  minAndroid: string;
  permissionsCount: number;
  iconResIds: number[];
  iconStringHint: string;
}

function parseBinaryAndroidManifest(buffer: ArrayBuffer): ParsedManifest {
  const result: ParsedManifest = {
    packageName: '',
    versionName: '',
    versionCode: '',
    appLabel: '',
    minAndroid: 'Android 8.0+',
    permissionsCount: 0,
    iconResIds: [],
    iconStringHint: '',
  };

  if (buffer.byteLength < 16) return result;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const fileType = view.getUint16(0, true);
  if (fileType !== 0x0003) {
    const text = decodeUtf8(bytes);
    const pkgMatch = text.match(/package=["']([^"']+)["']/);
    const verNameMatch = text.match(/versionName=["']([^"']+)["']/);
    const verCodeMatch = text.match(/versionCode=["']([^"']+)["']/);
    const labelMatch = text.match(/android:label=["']([^"'@]+)["']/);
    const iconMatch = text.match(/android:(?:roundIcon|icon)=["']([^"']+)["']/);
    const minSdkMatch = text.match(/minSdkVersion=["'](\d+)["']/);
    const permMatches = text.match(/uses-permission/g);

    if (pkgMatch) result.packageName = pkgMatch[1];
    if (verNameMatch) result.versionName = verNameMatch[1];
    if (verCodeMatch) result.versionCode = verCodeMatch[1];
    if (labelMatch) result.appLabel = labelMatch[1];
    if (iconMatch) result.iconStringHint = iconMatch[1];
    if (minSdkMatch) result.minAndroid = sdkToAndroidVersion(Number(minSdkMatch[1]));
    if (permMatches) result.permissionsCount = permMatches.length;
    return result;
  }

  const headerSize = view.getUint16(2, true);
  let offset = headerSize;
  let strings: string[] = [];

  while (offset + 8 <= buffer.byteLength) {
    const chunkType = view.getUint16(offset, true);
    const chunkHeaderSize = view.getUint16(offset + 2, true);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkSize < 8 || offset + chunkSize > buffer.byteLength) break;

    if (chunkType === CHUNK_STRING_POOL && chunkSize >= 28) {
      strings = parseStringPool(view, bytes, offset, chunkHeaderSize, chunkSize);
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
        const valueDataUint = view.getUint32(attrOff + 16, true);

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
          } else if (attrName === 'icon' || attrName === 'roundIcon') {
            if (valueType === TYPE_REFERENCE && valueDataUint > 0) {
              if (!result.iconResIds.includes(valueDataUint)) {
                result.iconResIds.push(valueDataUint);
              }
            } else if (attrVal && !result.iconStringHint) {
              result.iconStringHint = attrVal;
            }
          }
        }
      }
    }

    offset += chunkSize;
  }

  return result;
}

function extractRefIdsFromBinaryXml(buffer: ArrayBuffer): number[] {
  const refIds: number[] = [];
  if (buffer.byteLength < 16) return refIds;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.getUint16(0, true) !== 0x0003) return refIds;

  const headerSize = view.getUint16(2, true);
  let offset = headerSize;
  let strings: string[] = [];

  while (offset + 8 <= buffer.byteLength) {
    const chunkType = view.getUint16(offset, true);
    const chunkHeaderSize = view.getUint16(offset + 2, true);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkSize < 8 || offset + chunkSize > buffer.byteLength) break;

    if (chunkType === CHUNK_STRING_POOL && chunkSize >= 28) {
      strings = parseStringPool(view, bytes, offset, chunkHeaderSize, chunkSize);
    } else if (chunkType === CHUNK_XML_START_ELEMENT && chunkSize >= 36) {
      const nameIdx = view.getInt32(offset + 20, true);
      const attrStart = view.getUint16(offset + 24, true);
      const attrSize = view.getUint16(offset + 26, true);
      const attrCount = view.getUint16(offset + 28, true);
      const tagName = nameIdx >= 0 && nameIdx < strings.length ? strings[nameIdx] : '';

      // Prefer <foreground> layer over <background> in adaptive icons
      const isBackground = tagName === 'background';
      const attrsBase = offset + 16 + attrStart;
      for (let a = 0; a < attrCount; a++) {
        const attrOff = attrsBase + a * attrSize;
        if (attrOff + 20 > offset + chunkSize) break;
        const valueType = view.getUint8(attrOff + 15);
        const valueDataUint = view.getUint32(attrOff + 16, true);
        if (valueType === TYPE_REFERENCE && valueDataUint >= 0x01000000 && !isBackground) {
          if (!refIds.includes(valueDataUint)) {
            refIds.push(valueDataUint);
          }
        }
      }
    }

    offset += chunkSize;
  }
  return refIds;
}

function buildArscResourcePathMap(arscBuffer: ArrayBuffer): Map<number, string[]> {
  const resMap = new Map<number, string[]>();
  if (arscBuffer.byteLength < 12) return resMap;

  const view = new DataView(arscBuffer);
  const bytes = new Uint8Array(arscBuffer);
  if (view.getUint16(0, true) !== CHUNK_TABLE) return resMap;

  const tableHeaderSize = view.getUint16(2, true);
  const tableSize = Math.min(view.getUint32(4, true), arscBuffer.byteLength);
  let offset = tableHeaderSize;
  let globalStrings: string[] = [];

  while (offset + 8 <= tableSize) {
    const chunkType = view.getUint16(offset, true);
    const chunkHeaderSize = view.getUint16(offset + 2, true);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkSize < 8 || offset + chunkSize > tableSize) break;

    if (chunkType === CHUNK_STRING_POOL && globalStrings.length === 0) {
      globalStrings = parseStringPool(view, bytes, offset, chunkHeaderSize, chunkSize);
    } else if (chunkType === CHUNK_TABLE_PACKAGE && chunkSize >= 288) {
      const packageId = view.getUint32(offset + 8, true) & 0xff;
      let innerOffset = offset + chunkHeaderSize;
      const pkgEnd = offset + chunkSize;

      while (innerOffset + 8 <= pkgEnd) {
        const innerType = view.getUint16(innerOffset, true);
        const innerHeaderSize = view.getUint16(innerOffset + 2, true);
        const innerSize = view.getUint32(innerOffset + 4, true);
        if (innerSize < 8 || innerOffset + innerSize > pkgEnd) break;

        if (innerType === CHUNK_TABLE_TYPE && innerHeaderSize >= 20) {
          const typeId = view.getUint8(innerOffset + 8);
          const entryCount = view.getUint32(innerOffset + 12, true);
          const entriesStart = view.getUint32(innerOffset + 16, true);
          const offsetsBase = innerOffset + innerHeaderSize;
          const entriesBase = innerOffset + entriesStart;
          const typeEnd = innerOffset + innerSize;

          const safeEntries = Math.min(entryCount, 65_536);
          for (let eIdx = 0; eIdx < safeEntries; eIdx++) {
            const offPos = offsetsBase + eIdx * 4;
            if (offPos + 4 > typeEnd) break;
            const entryRelOffset = view.getUint32(offPos, true);
            if (entryRelOffset === 0xffffffff) continue;

            const entryPos = entriesBase + entryRelOffset;
            if (entryPos + 8 > typeEnd) continue;
            const entryFlags = view.getUint16(entryPos + 2, true);
            // Only non-bag simple values have Res_value right after 8-byte ResTable_entry
            if ((entryFlags & 0x0001) !== 0) continue;

            const valPos = entryPos + 8;
            if (valPos + 8 > typeEnd) continue;
            const valType = view.getUint8(valPos + 3);
            const valData = view.getUint32(valPos + 4, true);

            if (valType === TYPE_STRING && valData < globalStrings.length) {
              const strVal = globalStrings[valData];
              if (
                strVal &&
                /\.(png|webp|jpg|jpeg|xml)$/i.test(strVal) &&
                !strVal.toLowerCase().endsWith('.9.png')
              ) {
                const resId = ((packageId << 24) | (typeId << 16) | (eIdx & 0xffff)) >>> 0;
                const list = resMap.get(resId);
                if (list) {
                  if (!list.includes(strVal)) list.push(strVal);
                } else {
                  resMap.set(resId, [strVal]);
                }
              }
            }
          }
        }

        innerOffset += innerSize;
      }
    }

    offset += chunkSize;
  }

  return resMap;
}

function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    // PNG IHDR
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width > 0 && height > 0) return { width, height };
    }
    // WebP RIFF
    if (
      bytes.length >= 30 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      const chunkTag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (chunkTag === 'VP8X' && bytes.length >= 30) {
        const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width: w, height: h };
      }
      if (chunkTag === 'VP8 ' && bytes.length >= 30) {
        const w = view.getUint16(26, true) & 0x3fff;
        const h = view.getUint16(28, true) & 0x3fff;
        if (w > 0 && h > 0) return { width: w, height: h };
      }
      if (chunkTag === 'VP8L' && bytes.length >= 25) {
        const b0 = bytes[21];
        const b1 = bytes[22];
        const b2 = bytes[23];
        const b3 = bytes[24];
        const w = 1 + (b0 | ((b1 & 0x3f) << 8));
        const h = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
        return { width: w, height: h };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function scoreDensityAndSize(path: string, sizeBytes: number): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (lower.includes('xxxhdpi')) score += 60;
  else if (lower.includes('xxhdpi')) score += 50;
  else if (lower.includes('xhdpi')) score += 40;
  else if (lower.includes('hdpi')) score += 30;
  else if (lower.includes('mdpi')) score += 20;
  else if (lower.includes('nodpi') || lower.includes('anydpi')) score += 15;

  if (lower.endsWith('.png')) score += 10;
  else if (lower.endsWith('.webp')) score += 8;

  score += Math.min(sizeBytes / 1024, 40);
  return score;
}

function isExcludedIconPath(lower: string): boolean {
  return (
    lower.endsWith('.9.png') ||
    lower.includes('abc_') ||
    lower.includes('notification') ||
    lower.includes('ic_stat') ||
    lower.includes('ic_menu') ||
    lower.includes('btn_') ||
    lower.includes('common_google') ||
    lower.includes('design_') ||
    lower.includes('mtrl_') ||
    lower.includes('tooltip') ||
    lower.includes('ic_launcher_background')
  );
}

function scoreIconCandidate(path: string, sizeBytes: number): number {
  const lower = path.toLowerCase();
  if (isExcludedIconPath(lower)) return -1;

  let score = 0;
  if (lower.includes('ic_launcher.png') || lower.includes('ic_launcher.webp')) score += 150;
  else if (lower.includes('ic_launcher_round')) score += 125;
  else if (lower.includes('ic_launcher_foreground')) score += 118;
  else if (lower.includes('ic_launcher')) score += 105;
  else if (lower.includes('launcher_icon') || lower.includes('launcher_foreground')) score += 98;
  else if (lower.includes('app_icon') || lower.includes('appicon')) score += 95;
  else if (/\/(icon|ic_app|logo|app_logo|launcher)\.(png|webp|jpg|jpeg)$/.test(lower)) score += 85;
  else if (lower.includes('mipmap') && (lower.includes('icon') || lower.includes('launcher'))) score += 75;
  else if (lower.includes('mipmap')) score += 50;
  else if (lower.includes('icon') || lower.includes('logo')) score += 35;
  else return -1;

  return score + scoreDensityAndSize(path, sizeBytes);
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

function hasAsciiBytes(haystack: Uint8Array, needle: string): boolean {
  const nLen = needle.length;
  if (nLen === 0 || haystack.length < nLen) return false;
  const target = new Uint8Array(nLen);
  for (let i = 0; i < nLen; i++) {
    target[i] = needle.charCodeAt(i);
  }
  const first = target[0];
  outer: for (let i = 0; i <= haystack.length - nLen; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < nLen; j++) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

async function computeSha256Hex(buffer: ArrayBuffer): Promise<string | undefined> {
  try {
    if (typeof globalThis.crypto?.subtle?.digest !== 'function') return undefined;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return undefined;
  }
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
    const hasMetaInfCert = fileNames.some((n) => /^META-INF\/.+\.(RSA|DSA|EC|SF)$/i.test(n));
    const hasV2SigBlock = hasAsciiBytes(new Uint8Array(arrayBuffer), 'APK Sig Block 42');
    defaults.isSignedApk = hasMetaInfCert || hasV2SigBlock;
    defaults.signatureScheme =
      hasMetaInfCert && hasV2SigBlock
        ? 'v1+v2'
        : hasV2SigBlock
        ? 'v2/v3'
        : hasMetaInfCert
        ? 'v1'
        : 'unsigned';
    defaults.apkSha256 = await computeSha256Hex(arrayBuffer);

    const parsed = parseBinaryAndroidManifest(manifestBuffer);
    if (parsed.packageName) defaults.packageName = parsed.packageName;
    if (parsed.versionName) defaults.versionName = parsed.versionName;
    if (parsed.versionCode) defaults.versionCode = parsed.versionCode;
    if (parsed.appLabel) defaults.appLabel = parsed.appLabel;
    if (parsed.minAndroid) defaults.minAndroid = parsed.minAndroid;
    defaults.permissionsCount = parsed.permissionsCount;

    // Normalize lookup map of all ZIP entries by lowercase normalized path
    const zipByLowerPath = new Map<string, JSZip.JSZipObject>();
    for (const entry of Object.values(zip.files)) {
      if (!entry.dir) {
        zipByLowerPath.set(entry.name.replace(/^\/+/, '').toLowerCase(), entry);
      }
    }

    let bestPath: string | null = null;
    let bestScore = -1;
    let bestBytes: Uint8Array | null = null;

    // Strategy 1: Resolve exact android:icon / android:roundIcon via resources.arsc
    const arscEntry = zip.file('resources.arsc');
    if (arscEntry && parsed.iconResIds.length > 0) {
      try {
        const arscBuf = await arscEntry.async('arraybuffer');
        const resMap = buildArscResourcePathMap(arscBuf);
        const candidatePaths = new Set<string>();

        for (const resId of parsed.iconResIds) {
          for (const rawPath of resMap.get(resId) || []) {
            if (/\.xml$/i.test(rawPath)) {
              const xmlEntry = zipByLowerPath.get(rawPath.replace(/^\/+/, '').toLowerCase());
              if (xmlEntry) {
                const xmlBuf = await xmlEntry.async('arraybuffer');
                for (const innerId of extractRefIdsFromBinaryXml(xmlBuf)) {
                  for (const innerPath of resMap.get(innerId) || []) {
                    if (/\.(png|webp|jpg|jpeg)$/i.test(innerPath)) {
                      candidatePaths.add(innerPath);
                    }
                  }
                }
              }
            } else if (/\.(png|webp|jpg|jpeg)$/i.test(rawPath)) {
              candidatePaths.add(rawPath);
            }
          }
        }

        for (const candPath of candidatePaths) {
          const entry = zipByLowerPath.get(candPath.replace(/^\/+/, '').toLowerCase());
          if (!entry) continue;
          const bytes = await entry.async('uint8array');
          if (bytes.byteLength <= 80) continue;
          const dims = readImageDimensions(bytes);
          const squareBonus = dims && dims.width === dims.height && dims.width >= 48 ? 60 : 0;
          const score = 200 + squareBonus + scoreDensityAndSize(entry.name, bytes.byteLength);
          if (score > bestScore) {
            bestScore = score;
            bestPath = entry.name;
            bestBytes = bytes;
          }
        }
      } catch {
        // Non-fatal: continue with filename heuristics
      }
    }

    // Strategy 2: Resource path heuristic scan (supports standard and custom layouts)
    if (!bestBytes) {
      const imageEntries = Object.values(zip.files).filter(
        (entry) =>
          !entry.dir &&
          /\.(png|webp|jpg|jpeg)$/i.test(entry.name) &&
          (entry.name.startsWith('res/') ||
            entry.name.startsWith('r/') ||
            entry.name.startsWith('assets/') ||
            !entry.name.includes('/'))
      );

      for (const entry of imageEntries) {
        const quickScore = scoreIconCandidate(entry.name, 4096);
        if (quickScore < 0) continue;

        const bytes = await entry.async('uint8array');
        const finalScore = scoreIconCandidate(entry.name, bytes.byteLength);
        if (finalScore > bestScore && bytes.byteLength > 80) {
          bestScore = finalScore;
          bestPath = entry.name;
          bestBytes = bytes;
        }
      }

      // Strategy 3: Obfuscated AAPT2 fallback — scan square PNG/WebP icons inside res/
      if (!bestBytes) {
        for (const entry of imageEntries) {
          const lower = entry.name.toLowerCase();
          if (isExcludedIconPath(lower)) continue;
          if (!lower.startsWith('res/') && !lower.startsWith('r/')) continue;
          const bytes = await entry.async('uint8array');
          if (bytes.byteLength < 512 || bytes.byteLength > 512 * 1024) continue;
          const dims = readImageDimensions(bytes);
          if (!dims) continue;
          if (dims.width === dims.height && dims.width >= 72 && dims.width <= 1024) {
            const squareScore = dims.width + (bytes.byteLength / 1024);
            if (squareScore > bestScore) {
              bestScore = squareScore;
              bestPath = entry.name;
              bestBytes = bytes;
            }
          }
        }
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
