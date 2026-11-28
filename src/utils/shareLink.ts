import type { AppCategory, StoreApp } from '../types.ts';

const VALID_APP_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_SHORT_CODE_RE = /^[a-zA-Z0-9_-]{4,32}$/;

const VALID_CATEGORIES = new Set<AppCategory>([
  'الإنتاجية',
  'الأدوات',
  'الصوتيات',
  'التعليم',
  'الأعمال',
  'التصوير',
  'الألعاب',
]);

export const FALLBACK_APP_IDS = new Set<string>([
  'app-atlas-tasks',
  'app-qalam-docs',
  'app-sada-audio',
  'app-nabd-finance',
  'app-bayan-learn',
  'app-mirat-camera',
]);

export function isValidAppId(id: string): boolean {
  return VALID_APP_ID_RE.test(id);
}

export function isValidShortCode(code: string): boolean {
  return VALID_SHORT_CODE_RE.test(code);
}

/**
 * Deterministic short code derived from app.id so updates preserve the exact same short URL.
 */
export function generateShortCodeForAppId(appId: string): string {
  const clean = appId.trim() || 'app';
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ ch, 0x85ebca6b) + i) >>> 0;
  }
  const part1 = h1.toString(36).padStart(4, '0').slice(0, 4);
  const part2 = h2.toString(36).padStart(3, '0').slice(0, 3);
  return `p${part1}${part2}`.slice(0, 8);
}

function cleanExtractedAppId(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\/+$/, '');
  return isValidAppId(cleaned) ? cleaned : null;
}

function cleanExtractedShortCode(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\/+$/, '');
  return isValidShortCode(cleaned) ? cleaned : null;
}

export function extractAppIdFromLocation(href?: string): string | null {
  try {
    const rawHref = href ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!rawHref) return null;
    const url = new URL(rawHref, 'https://play55.local');

    const queryId = cleanExtractedAppId(url.searchParams.get('app'));
    if (queryId) return queryId;

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    if (!hash) return null;

    if (hash.startsWith('/?')) {
      const hashParams = new URLSearchParams(hash.slice(2));
      const fromHashPath = cleanExtractedAppId(hashParams.get('app'));
      if (fromHashPath) return fromHashPath;
    }

    if (hash.includes('app=') && !hash.startsWith('p55=') && !hash.startsWith('p55z=')) {
      const hashParams = new URLSearchParams(hash.replace(/^\//, ''));
      const fromHash = cleanExtractedAppId(hashParams.get('app'));
      if (fromHash) return fromHash;
    }

    return null;
  } catch {
    return null;
  }
}

export function extractShortCodeFromLocation(href?: string): string | null {
  try {
    const rawHref = href ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!rawHref) return null;
    const url = new URL(rawHref, 'https://play55.local');

    const queryShort = cleanExtractedShortCode(url.searchParams.get('s'));
    if (queryShort) return queryShort;

    const pathMatch = /(?:^|\/)s\/([a-zA-Z0-9_-]{4,32})\/?$/.exec(url.pathname);
    if (pathMatch?.[1] && isValidShortCode(pathMatch[1])) {
      return pathMatch[1];
    }

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    if (hash && !hash.startsWith('p55=') && !hash.startsWith('p55z=')) {
      if (hash.startsWith('/?')) {
        const hp = new URLSearchParams(hash.slice(2));
        const fromHp = cleanExtractedShortCode(hp.get('s'));
        if (fromHp) return fromHp;
      }
      const hashPathMatch = /^\/?s\/([a-zA-Z0-9_-]{4,32})\/?$/.exec(hash);
      if (hashPathMatch?.[1]) return hashPathMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

export function getAppBasePathname(pathname?: string): string {
  const raw = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const stripped = raw.replace(/\/s\/[a-zA-Z0-9_-]+\/?$/, '/');
  return stripped || '/';
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64UrlUtf8(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input));
}

function decodeBase64UrlUtf8(encoded: string): string {
  return new TextDecoder().decode(base64UrlToBytes(encoded));
}

async function deflateStringToBase64Url(input: string): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([new TextEncoder().encode(input)])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const ab = await new Response(stream).arrayBuffer();
    return bytesToBase64Url(new Uint8Array(ab));
  } catch {
    return null;
  }
}

async function inflateBase64UrlToString(encoded: string): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const bytes = base64UrlToBytes(encoded);
    const stream = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

function sanitizeHttpsUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function sanitizeImageRefForHash(url: string, maxDataLen: number): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/^\/Play55(?=\/)/i, '');
  if (trimmed.startsWith('data:')) {
    return trimmed.length <= maxDataLen ? trimmed : '';
  }
  const storeMatch =
    /^\.?\/?(?:src\/assets\/images|media\/store)\/([a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp|svg))$/i.exec(
      trimmed
    );
  if (storeMatch?.[1]) {
    return `./media/store/${storeMatch[1]}`;
  }
  const brandMatch = /^\.?\/?api\/brand-icon\/([a-z0-9_-]+)$/i.exec(trimmed);
  if (brandMatch?.[1]) {
    return `./api/brand-icon/${brandMatch[1].toLowerCase()}`;
  }
  if (trimmed.startsWith('https://')) {
    return trimmed.length <= 500 ? trimmed : '';
  }
  return '';
}

interface CompactShareSnapshot {
  v: 1;
  id: string;
  n: string;
  dev: string;
  cat: AppCategory;
  sd: string;
  fd: string;
  wn: string;
  pkg: string;
  vn: string;
  vc: string;
  ma: string;
  ar: string;
  sz: number;
  ic?: string;
  sc?: string[];
  fn?: string;
  hc?: boolean;
  bm?: boolean;
  sg?: boolean;
  ss?: string;
  cs?: string;
  as?: string;
  ex?: string;
  pc?: number;
  dl?: number;
  ou?: string;
  ca: string;
  ua: string;
}

export interface ShortLinkBuildOptions {
  originOverride?: string;
  pathnameOverride?: string;
  preferPathShortLink?: boolean;
  serverOnline?: boolean;
}

function buildCompactSnapshotPayload(app: StoreApp): CompactShareSnapshot {
  return {
    v: 1,
    id: app.id,
    n: app.name.slice(0, 120),
    dev: app.developer.slice(0, 120),
    cat: app.category,
    sd: app.shortDescription.slice(0, 240),
    fd: app.fullDescription.slice(0, 1400),
    wn: (app.whatsNew || '').slice(0, 400),
    pkg: app.packageName.slice(0, 160),
    vn: app.versionName.slice(0, 64),
    vc: app.versionCode.slice(0, 32),
    ma: app.minAndroid.slice(0, 40),
    ar: app.ageRating.slice(0, 16),
    sz: Number(app.sizeMB.toFixed(2)),
    ic: sanitizeImageRefForHash(app.iconUrl, 12_000) || undefined,
    sc: (app.screenshots || [])
      .map((s) => sanitizeImageRefForHash(s, 9_500))
      .filter(Boolean)
      .slice(0, 2),
    fn: (app.apkFilename || '').slice(0, 180) || undefined,
    hc: app.hasCustomApk,
    bm: app.isBinaryManifest,
    sg: app.isSignedApk,
    ss: app.signatureScheme?.slice(0, 32),
    cs: app.signerCertSha256?.slice(0, 128),
    as: app.apkSha256?.slice(0, 128),
    ex: sanitizeHttpsUrl(app.externalApkUrl),
    pc: app.permissionsCount,
    dl: app.downloads,
    ou: app.ownerUid && isValidAppId(app.ownerUid) ? app.ownerUid : undefined,
    ca: app.createdAt,
    ua: app.updatedAt,
  };
}

function hydrateSnapshotPayload(
  parsed: Partial<CompactShareSnapshot>,
  expectedAppId?: string
): StoreApp | null {
  if (!parsed || parsed.v !== 1 || !parsed.id || !isValidAppId(parsed.id)) {
    return null;
  }
  if (expectedAppId && parsed.id !== expectedAppId) {
    return null;
  }
  if (typeof parsed.n !== 'string' || !parsed.n.trim() || typeof parsed.pkg !== 'string') {
    return null;
  }

  const category: AppCategory =
    parsed.cat && VALID_CATEGORIES.has(parsed.cat) ? parsed.cat : 'الأدوات';

  return {
    id: parsed.id,
    shortCode: generateShortCodeForAppId(parsed.id),
    name: parsed.n.slice(0, 120),
    developer: (typeof parsed.dev === 'string' && parsed.dev.trim() ? parsed.dev : 'مطور مستقل').slice(0, 120),
    category,
    shortDescription: (typeof parsed.sd === 'string' && parsed.sd.trim() ? parsed.sd : parsed.n).slice(0, 240),
    fullDescription: (typeof parsed.fd === 'string' && parsed.fd.trim() ? parsed.fd : parsed.sd || parsed.n).slice(0, 5000),
    whatsNew: (typeof parsed.wn === 'string' ? parsed.wn : '').slice(0, 1000),
    packageName: parsed.pkg.slice(0, 160),
    versionName: (typeof parsed.vn === 'string' && parsed.vn.trim() ? parsed.vn : '1.0.0').slice(0, 64),
    versionCode: (typeof parsed.vc === 'string' && parsed.vc.trim() ? parsed.vc : '1').slice(0, 32),
    minAndroid: (typeof parsed.ma === 'string' && parsed.ma.trim() ? parsed.ma : 'Android 8.0+').slice(0, 40),
    ageRating: (typeof parsed.ar === 'string' && parsed.ar.trim() ? parsed.ar : '+3').slice(0, 16),
    sizeMB: typeof parsed.sz === 'number' && parsed.sz > 0 ? parsed.sz : 1,
    iconUrl: typeof parsed.ic === 'string' ? sanitizeImageRefForHash(parsed.ic, 120_000) : '',
    screenshots: Array.isArray(parsed.sc)
      ? parsed.sc
          .filter((s): s is string => typeof s === 'string')
          .map((s) => sanitizeImageRefForHash(s, 120_000))
          .filter(Boolean)
          .slice(0, 4)
      : [],
    apkFilename: typeof parsed.fn === 'string' ? parsed.fn.slice(0, 200) : '',
    hasCustomApk: Boolean(parsed.hc),
    isBinaryManifest: typeof parsed.bm === 'boolean' ? parsed.bm : undefined,
    isSignedApk: typeof parsed.sg === 'boolean' ? parsed.sg : undefined,
    signatureScheme: typeof parsed.ss === 'string' ? parsed.ss.slice(0, 32) : undefined,
    signerCertSha256: typeof parsed.cs === 'string' ? parsed.cs.slice(0, 128) : undefined,
    apkSha256: typeof parsed.as === 'string' ? parsed.as.slice(0, 128) : undefined,
    externalApkUrl: sanitizeHttpsUrl(parsed.ex),
    permissionsCount: typeof parsed.pc === 'number' && parsed.pc >= 0 ? Math.floor(parsed.pc) : 0,
    downloads: typeof parsed.dl === 'number' && parsed.dl >= 0 ? Math.floor(parsed.dl) : 1,
    averageRating: 0,
    reviewCount: 0,
    ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    featured: false,
    syncedToCloud: false,
    ownerUid: typeof parsed.ou === 'string' && isValidAppId(parsed.ou) ? parsed.ou : undefined,
    createdAt: typeof parsed.ca === 'string' && parsed.ca ? parsed.ca : new Date().toISOString(),
    updatedAt: typeof parsed.ua === 'string' && parsed.ua ? parsed.ua : new Date().toISOString(),
  };
}

/**
 * Builds the shortest possible direct share URL for an app:
 * - Full-stack server: https://host/s/CODE (embeds OpenGraph app image on the server)
 * - Cloud-synced (Firestore): https://host/path/?s=CODE (resolves /shortLinks/CODE with app image)
 * - Offline-only fallback: compact compressed #p55z= snapshot carrying the app icon inside
 */
export function buildPermanentAppShareUrl(
  app: StoreApp,
  originOverrideOrOpts?: string | ShortLinkBuildOptions,
  pathnameOverride?: string
): string {
  const opts: ShortLinkBuildOptions =
    typeof originOverrideOrOpts === 'object' && originOverrideOrOpts !== null
      ? originOverrideOrOpts
      : { originOverride: originOverrideOrOpts, pathnameOverride };

  const origin =
    opts.originOverride ??
    (typeof window !== 'undefined' ? window.location.origin : 'https://play55.local');
  const rawPath =
    opts.pathnameOverride ??
    (typeof window !== 'undefined' ? getAppBasePathname(window.location.pathname) : '/');
  const pathname = rawPath.endsWith('/') ? rawPath : `${rawPath}/`;
  const code = app.shortCode && isValidShortCode(app.shortCode)
    ? app.shortCode
    : generateShortCodeForAppId(app.id);

  if (app.syncedToCloud || app.serverSynced || opts.serverOnline || FALLBACK_APP_IDS.has(app.id)) {
    if (opts.preferPathShortLink) {
      const cleanBase = pathname === '/' ? '' : pathname.replace(/\/$/, '');
      return `${origin}${cleanBase}/s/${code}`;
    }
    return `${origin}${pathname}?s=${code}`;
  }

  const baseUrl = `${origin}${pathname}?s=${code}`;
  const compact = buildCompactSnapshotPayload(app);

  try {
    let encoded = encodeBase64UrlUtf8(JSON.stringify(compact));
    while (encoded.length > 36_000 && compact.sc && compact.sc.length > 0) {
      compact.sc.pop();
      encoded = encodeBase64UrlUtf8(JSON.stringify(compact));
    }
    if (encoded.length > 36_000) {
      delete compact.ic;
      compact.sc = [];
      encoded = encodeBase64UrlUtf8(JSON.stringify(compact));
    }
    return `${baseUrl}#p55=${encoded}`;
  } catch {
    return baseUrl;
  }
}

export async function buildCompressedShortShareUrl(
  app: StoreApp,
  opts?: ShortLinkBuildOptions
): Promise<string> {
  const syncUrl = buildPermanentAppShareUrl(app, opts);
  if (!syncUrl.includes('#p55=')) {
    return syncUrl;
  }
  const compact = buildCompactSnapshotPayload(app);
  const rawJson = JSON.stringify(compact);
  const compressed = await deflateStringToBase64Url(rawJson);
  if (!compressed) return syncUrl;

  const basePart = syncUrl.split('#')[0];
  const candidate = `${basePart}#p55z=${compressed}`;
  return candidate.length < syncUrl.length ? candidate : syncUrl;
}

export function decodeSharedAppSnapshot(
  expectedAppId?: string,
  href?: string
): StoreApp | null {
  try {
    const rawHref = href ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!rawHref) return null;
    const url = new URL(rawHref, 'https://play55.local');
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    if (!hash) return null;

    const match = /(?:^|&)p55=([A-Za-z0-9_-]+)/.exec(hash);
    if (!match?.[1]) return null;

    const parsed = JSON.parse(decodeBase64UrlUtf8(match[1])) as Partial<CompactShareSnapshot>;
    return hydrateSnapshotPayload(parsed, expectedAppId);
  } catch {
    return null;
  }
}

export async function decodeSharedAppSnapshotAsync(
  expectedAppId?: string,
  href?: string
): Promise<StoreApp | null> {
  const syncResult = decodeSharedAppSnapshot(expectedAppId, href);
  if (syncResult) return syncResult;
  try {
    const rawHref = href ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!rawHref) return null;
    const url = new URL(rawHref, 'https://play55.local');
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    if (!hash) return null;

    const match = /(?:^|&)p55z=([A-Za-z0-9_-]+)/.exec(hash);
    if (!match?.[1]) return null;

    const jsonText = await inflateBase64UrlToString(match[1]);
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText) as Partial<CompactShareSnapshot>;
    return hydrateSnapshotPayload(parsed, expectedAppId);
  } catch {
    return null;
  }
}
