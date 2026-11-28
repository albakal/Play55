import type { AppCategory, StoreApp } from '../types.ts';

const VALID_APP_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
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

function cleanExtractedAppId(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\/+$/, '');
  return isValidAppId(cleaned) ? cleaned : null;
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

    if (hash.includes('app=') && !hash.startsWith('p55=')) {
      const hashParams = new URLSearchParams(hash.replace(/^\//, ''));
      const fromHash = cleanExtractedAppId(hashParams.get('app'));
      if (fromHash) return fromHash;
    }

    return null;
  } catch {
    return null;
  }
}

function encodeBase64UrlUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlUtf8(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
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
    /^\.?\/?(?:src\/assets\/images|media\/store)\/([a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp))$/i.exec(
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

export function buildPermanentAppShareUrl(
  app: StoreApp,
  originOverride?: string,
  pathnameOverride?: string
): string {
  const origin =
    originOverride ?? (typeof window !== 'undefined' ? window.location.origin : 'https://play55.local');
  const pathname =
    pathnameOverride ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const baseUrl = `${origin}${pathname}?app=${encodeURIComponent(app.id)}`;

  if (app.syncedToCloud || FALLBACK_APP_IDS.has(app.id)) {
    return baseUrl;
  }

  const compact: CompactShareSnapshot = {
    v: 1,
    id: app.id,
    n: app.name.slice(0, 120),
    dev: app.developer.slice(0, 120),
    cat: app.category,
    sd: app.shortDescription.slice(0, 240),
    fd: app.fullDescription.slice(0, 1800),
    wn: (app.whatsNew || '').slice(0, 500),
    pkg: app.packageName.slice(0, 160),
    vn: app.versionName.slice(0, 64),
    vc: app.versionCode.slice(0, 32),
    ma: app.minAndroid.slice(0, 40),
    ar: app.ageRating.slice(0, 16),
    sz: Number(app.sizeMB.toFixed(2)),
    ic: sanitizeImageRefForHash(app.iconUrl, 10_000) || undefined,
    sc: (app.screenshots || [])
      .map((s) => sanitizeImageRefForHash(s, 2000))
      .filter(Boolean)
      .slice(0, 4),
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

  try {
    const encoded = encodeBase64UrlUtf8(JSON.stringify(compact));
    if (encoded.length > 14_000) {
      delete compact.ic;
      compact.sc = [];
      return `${baseUrl}#p55=${encodeBase64UrlUtf8(JSON.stringify(compact))}`;
    }
    return `${baseUrl}#p55=${encoded}`;
  } catch {
    return baseUrl;
  }
}

export function decodeSharedAppSnapshot(
  expectedAppId: string,
  href?: string
): StoreApp | null {
  try {
    const rawHref = href ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!rawHref || !isValidAppId(expectedAppId)) return null;
    const url = new URL(rawHref, 'https://play55.local');
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    if (!hash) return null;

    const match = /(?:^|&)p55=([A-Za-z0-9_-]+)/.exec(hash);
    if (!match?.[1]) return null;

    const parsed = JSON.parse(decodeBase64UrlUtf8(match[1])) as Partial<CompactShareSnapshot>;
    if (!parsed || parsed.v !== 1 || parsed.id !== expectedAppId) {
      return null;
    }
    if (typeof parsed.n !== 'string' || !parsed.n.trim() || typeof parsed.pkg !== 'string') {
      return null;
    }

    const category: AppCategory =
      parsed.cat && VALID_CATEGORIES.has(parsed.cat) ? parsed.cat : 'الأدوات';

    return {
      id: parsed.id,
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
  } catch {
    return null;
  }
}
