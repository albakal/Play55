import JSZip from 'jszip';
import type {
  AppCategory,
  AppDetailResponse,
  DeveloperSessionUser,
  ReviewItem,
  StoreApp,
} from '../types.ts';
import { FALLBACK_APPS, FALLBACK_REVIEWS } from '../catalog/fallbackStore.ts';

const DB_NAME = 'app_store_plus_db';
const DB_VERSION = 2;
const ACTIVE_SESSION_KEY = 'current';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

interface LocalStoredUser {
  uid: string;
  displayName: string;
  email: string;
  saltHex: string;
  hashHex: string;
  createdAt: string;
}

interface LocalSessionRecord {
  id: string;
  token: string;
  user: DeveloperSessionUser;
  expiresAt: number;
}

interface AppStatsPatch {
  appId: string;
  downloads: number;
}

interface ReviewHelpfulPatch {
  reviewId: string;
  helpfulCount: number;
}

const memoryStores: Record<string, Map<string, unknown>> = {
  developers: new Map(),
  apps: new Map(),
  apkBlobs: new Map(),
  reviews: new Map(),
  appStats: new Map(),
  reviewHelpful: new Map(),
  activeSession: new Map(),
};

const STORE_KEYS: Record<string, string> = {
  developers: 'email',
  apps: 'id',
  apkBlobs: 'appId',
  reviews: 'id',
  appStats: 'appId',
  reviewHelpful: 'reviewId',
  activeSession: 'id',
};

async function openLocalDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('developers')) {
          db.createObjectStore('developers', { keyPath: 'email' });
        }
        if (!db.objectStoreNames.contains('apps')) {
          db.createObjectStore('apps', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('apkBlobs')) {
          db.createObjectStore('apkBlobs', { keyPath: 'appId' });
        }
        if (!db.objectStoreNames.contains('reviews')) {
          db.createObjectStore('reviews', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('appStats')) {
          db.createObjectStore('appStats', { keyPath: 'appId' });
        }
        if (!db.objectStoreNames.contains('reviewHelpful')) {
          db.createObjectStore('reviewHelpful', { keyPath: 'reviewId' });
        }
        if (!db.objectStoreNames.contains('activeSession')) {
          db.createObjectStore('activeSession', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  } catch {
    return null;
  }
}

function idbGet<T>(db: IDBDatabase | null, storeName: string, key: string): Promise<T | undefined> {
  if (!db) {
    return Promise.resolve(memoryStores[storeName]?.get(key) as T | undefined);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase | null, storeName: string): Promise<T[]> {
  if (!db) {
    return Promise.resolve(Array.from((memoryStores[storeName] || new Map()).values()) as T[]);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

function idbPut<T>(db: IDBDatabase | null, storeName: string, value: T): Promise<void> {
  if (!db) {
    const keyProp = STORE_KEYS[storeName] || 'id';
    const keyVal = String((value as Record<string, unknown>)[keyProp] || '');
    memoryStores[storeName]?.set(keyVal, value);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase | null, storeName: string, key: string): Promise<void> {
  if (!db) {
    memoryStores[storeName]?.delete(key);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

async function derivePasswordHashHex(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  if (typeof globalThis.crypto?.subtle?.importKey === 'function') {
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const saltBuffer = new Uint8Array(salt).buffer;
    const bits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 100_000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  // Fallback key-stretching mixer if Web Crypto SubtleCrypto is restricted
  const input = new Uint8Array([...salt, ...enc.encode(password)]);
  let state = 0x811c9dc5;
  const out = new Uint8Array(32);
  for (let round = 0; round < 512; round++) {
    for (let i = 0; i < input.length; i++) {
      state ^= input[i] ^ (round & 0xff);
      state = Math.imul(state, 0x01000193) >>> 0;
    }
    out[round % 32] ^= state & 0xff;
  }
  return bytesToHex(out);
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function randomId(prefix: string): string {
  const bytes = getRandomBytes(6);
  return `${prefix}-${bytesToHex(bytes)}`;
}

function computeStats(reviews: ReviewItem[]) {
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  if (reviews.length === 0) {
    return { averageRating: 0, reviewCount: 0, ratingDistribution: dist };
  }
  let sum = 0;
  for (const r of reviews) {
    const clamped = Math.min(5, Math.max(1, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    dist[clamped] += 1;
    sum += r.rating;
  }
  return {
    averageRating: Number((sum / reviews.length).toFixed(1)),
    reviewCount: reviews.length,
    ratingDistribution: dist,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed reading file'));
    reader.readAsDataURL(blob);
  });
}

export async function localRegisterDeveloper(params: {
  name: string;
  email: string;
  password: string;
}): Promise<{ token: string; user: DeveloperSessionUser }> {
  const displayName = params.name.trim();
  const email = params.email.trim().toLowerCase();
  const password = params.password;

  if (displayName.length < 2 || displayName.length > 80) {
    throw new Error('يرجى إدخال الاسم الكامل (حرفان على الأقل)');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new Error('يرجى إدخال بريد إلكتروني صحيح');
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('يجب أن تتكون كلمة المرور من 8 أحرف على الأقل');
  }

  const db = await openLocalDb();
  const existing = await idbGet<LocalStoredUser>(db, 'developers', email);
  if (existing) {
    throw new Error('هذا البريد الإلكتروني مسجل مسبقاً، يرجى تسجيل الدخول');
  }

  const salt = getRandomBytes(16);
  const hashHex = await derivePasswordHashHex(password, salt);
  const newUser: LocalStoredUser = {
    uid: randomId('local'),
    displayName,
    email,
    saltHex: bytesToHex(salt),
    hashHex,
    createdAt: new Date().toISOString(),
  };

  await idbPut(db, 'developers', newUser);

  return {
    token: `local-session-${newUser.uid}`,
    user: {
      uid: newUser.uid,
      displayName: newUser.displayName,
      email: newUser.email,
      photoURL: null,
      provider: 'manual',
    },
  };
}

export async function localLoginDeveloper(params: {
  email: string;
  password: string;
}): Promise<{ token: string; user: DeveloperSessionUser }> {
  const email = params.email.trim().toLowerCase();
  const password = params.password;

  if (!email || !password) {
    throw new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور');
  }

  const db = await openLocalDb();
  const found = await idbGet<LocalStoredUser>(db, 'developers', email);
  if (!found) {
    throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  }

  const derivedHex = await derivePasswordHashHex(password, hexToBytes(found.saltHex));
  if (!constantTimeEqualHex(derivedHex, found.hashHex)) {
    throw new Error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  }

  return {
    token: `local-session-${found.uid}`,
    user: {
      uid: found.uid,
      displayName: found.displayName,
      email: found.email,
      photoURL: null,
      provider: 'manual',
    },
  };
}

async function buildMergedCatalog(): Promise<{ apps: StoreApp[]; reviewsByApp: Record<string, ReviewItem[]> }> {
  const db = await openLocalDb();
  const [customApps, localReviews, statPatches, helpfulPatches] = await Promise.all([
    idbGetAll<StoreApp>(db, 'apps'),
    idbGetAll<ReviewItem>(db, 'reviews'),
    idbGetAll<AppStatsPatch>(db, 'appStats'),
    idbGetAll<ReviewHelpfulPatch>(db, 'reviewHelpful'),
  ]);

  const statMap = new Map(statPatches.map((s) => [s.appId, s.downloads]));
  const helpfulMap = new Map(helpfulPatches.map((h) => [h.reviewId, h.helpfulCount]));

  const mergedAppsMap = new Map<string, StoreApp>();
  for (const app of FALLBACK_APPS) {
    mergedAppsMap.set(app.id, { ...app });
  }
  for (const app of customApps) {
    mergedAppsMap.set(app.id, { ...app });
  }

  const reviewsByApp: Record<string, ReviewItem[]> = {};
  for (const [appId, baseList] of Object.entries(FALLBACK_REVIEWS)) {
    reviewsByApp[appId] = baseList.map((r) => ({
      ...r,
      helpfulCount: helpfulMap.get(r.id) ?? r.helpfulCount,
    }));
  }

  for (const rev of localReviews) {
    if (!reviewsByApp[rev.appId]) reviewsByApp[rev.appId] = [];
    reviewsByApp[rev.appId].unshift({
      ...rev,
      helpfulCount: helpfulMap.get(rev.id) ?? rev.helpfulCount,
    });
  }

  const apps = Array.from(mergedAppsMap.values()).map((app) => {
    const appReviews = (reviewsByApp[app.id] || []).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    reviewsByApp[app.id] = appReviews;

    const downloads = statMap.get(app.id) ?? app.downloads;
    if (appReviews.length > 0) {
      const stats = computeStats(appReviews);
      return {
        ...app,
        downloads,
        averageRating: stats.averageRating,
        reviewCount: stats.reviewCount,
        ratingDistribution: stats.ratingDistribution,
      };
    }
    return { ...app, downloads };
  });

  return { apps, reviewsByApp };
}

export async function localListApps(sort: 'popular' | 'rating' | 'newest'): Promise<StoreApp[]> {
  const { apps } = await buildMergedCatalog();
  if (sort === 'rating') {
    apps.sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount);
  } else if (sort === 'newest') {
    apps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    apps.sort((a, b) => b.downloads - a.downloads);
  }
  return apps;
}

export async function localGetAppDetail(appId: string): Promise<AppDetailResponse | null> {
  const { apps, reviewsByApp } = await buildMergedCatalog();
  const app = apps.find((a) => a.id === appId);
  if (!app) return null;
  return {
    app,
    reviews: reviewsByApp[app.id] || [],
  };
}

export async function localSaveSession(
  user: DeveloperSessionUser,
  token: string
): Promise<void> {
  const db = await openLocalDb();
  const record: LocalSessionRecord = {
    id: ACTIVE_SESSION_KEY,
    token,
    user,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  await idbPut(db, 'activeSession', record);
}

export async function localGetSession(): Promise<{
  user: DeveloperSessionUser;
  token: string;
} | null> {
  try {
    const db = await openLocalDb();
    const record = await idbGet<LocalSessionRecord>(db, 'activeSession', ACTIVE_SESSION_KEY);
    if (!record || !record.user || !record.token) return null;
    if (typeof record.expiresAt === 'number' && record.expiresAt < Date.now()) {
      await idbDelete(db, 'activeSession', ACTIVE_SESSION_KEY);
      return null;
    }
    return { user: record.user, token: record.token };
  } catch {
    return null;
  }
}

export async function localClearSession(): Promise<void> {
  try {
    const db = await openLocalDb();
    await idbDelete(db, 'activeSession', ACTIVE_SESSION_KEY);
  } catch {
    // Ignore storage clear errors
  }
}

function sanitizeHttpsApkUrlClient(raw?: string): string | undefined {
  if (!raw) return undefined;
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

export async function localPublishApp(params: {
  apkFile: File;
  iconSource: Blob | null;
  screenshots: File[];
  name: string;
  developer: string;
  category: AppCategory;
  shortDescription: string;
  fullDescription: string;
  whatsNew: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  minAndroid: string;
  ageRating: string;
  sizeMB: number;
  isBinaryManifest?: boolean;
  isSignedApk?: boolean;
  apkSha256?: string;
  externalApkUrl?: string;
  permissionsCount: number;
  owner: DeveloperSessionUser;
}): Promise<StoreApp> {
  const db = await openLocalDb();
  const appId = randomId('app');

  let iconUrl = FALLBACK_APPS[0].iconUrl;
  if (params.iconSource) {
    iconUrl = await blobToDataUrl(params.iconSource);
  }

  const screenshotUrls: string[] = [];
  for (const file of params.screenshots.slice(0, 8)) {
    screenshotUrls.push(await blobToDataUrl(file));
  }

  const now = new Date().toISOString();
  const newApp: StoreApp = {
    id: appId,
    name: params.name.trim(),
    developer: params.developer.trim() || params.owner.displayName || 'مطور مستقل',
    category: params.category,
    shortDescription: params.shortDescription.trim(),
    fullDescription: params.fullDescription.trim() || params.shortDescription.trim(),
    whatsNew: params.whatsNew.trim() || 'الإصدار الأولي على منصة Play55.',
    packageName: params.packageName.trim() || 'com.app.android',
    versionName: params.versionName.trim() || '1.0.0',
    versionCode: params.versionCode.trim() || '1',
    minAndroid: params.minAndroid.trim() || 'Android 8.0+',
    ageRating: params.ageRating.trim() || '+3',
    sizeMB: Math.max(params.sizeMB, 0.01),
    iconUrl,
    screenshots: screenshotUrls,
    apkFilename: params.apkFile.name,
    hasCustomApk: true,
    isBinaryManifest: params.isBinaryManifest,
    isSignedApk: params.isSignedApk,
    apkSha256: params.apkSha256,
    externalApkUrl: sanitizeHttpsApkUrlClient(params.externalApkUrl),
    permissionsCount: params.permissionsCount,
    downloads: 1,
    averageRating: 0,
    reviewCount: 0,
    ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    featured: false,
    ownerUid: params.owner.uid,
    ownerEmail: params.owner.email,
    createdAt: now,
    updatedAt: now,
  };

  await idbPut(db, 'apkBlobs', { appId, blob: params.apkFile });
  await idbPut(db, 'apps', newApp);
  return newApp;
}

export async function localUpdateApp(params: {
  existingApp: StoreApp;
  apkFile: File | null;
  iconSource: Blob | null;
  screenshots: File[];
  name: string;
  developer: string;
  category: AppCategory;
  shortDescription: string;
  fullDescription: string;
  whatsNew: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  minAndroid: string;
  ageRating: string;
  sizeMB?: number;
  isBinaryManifest?: boolean;
  isSignedApk?: boolean;
  apkSha256?: string;
  externalApkUrl?: string;
  permissionsCount?: number;
  owner: DeveloperSessionUser;
}): Promise<StoreApp> {
  if (params.existingApp.ownerUid && params.existingApp.ownerUid !== params.owner.uid) {
    throw new Error('لا تملك صلاحية تحديث هذا التطبيق');
  }
  const db = await openLocalDb();

  let iconUrl = params.existingApp.iconUrl;
  if (params.iconSource) {
    iconUrl = await blobToDataUrl(params.iconSource);
  }

  let screenshotUrls = params.existingApp.screenshots;
  if (params.screenshots.length > 0) {
    screenshotUrls = [];
    for (const file of params.screenshots.slice(0, 8)) {
      screenshotUrls.push(await blobToDataUrl(file));
    }
  }

  if (params.apkFile) {
    await idbPut(db, 'apkBlobs', { appId: params.existingApp.id, blob: params.apkFile });
  }

  const nextExternalUrl =
    typeof params.externalApkUrl === 'string'
      ? params.externalApkUrl.trim() === ''
        ? undefined
        : sanitizeHttpsApkUrlClient(params.externalApkUrl) ?? params.existingApp.externalApkUrl
      : params.existingApp.externalApkUrl;

  const updatedApp: StoreApp = {
    ...params.existingApp,
    name: params.name.trim() || params.existingApp.name,
    developer: params.developer.trim() || params.existingApp.developer,
    category: params.category,
    shortDescription: params.shortDescription.trim() || params.existingApp.shortDescription,
    fullDescription: params.fullDescription.trim() || params.existingApp.fullDescription,
    whatsNew: params.whatsNew.trim() || params.existingApp.whatsNew,
    packageName: params.packageName.trim() || params.existingApp.packageName,
    versionName: params.versionName.trim() || params.existingApp.versionName,
    versionCode: params.versionCode.trim() || params.existingApp.versionCode,
    minAndroid: params.minAndroid.trim() || params.existingApp.minAndroid,
    ageRating: params.ageRating.trim() || params.existingApp.ageRating,
    sizeMB: Math.max(params.sizeMB ?? params.existingApp.sizeMB, 0.01),
    iconUrl,
    screenshots: screenshotUrls,
    apkFilename: params.apkFile ? params.apkFile.name : params.existingApp.apkFilename,
    hasCustomApk: params.existingApp.hasCustomApk || Boolean(params.apkFile),
    isBinaryManifest: params.isBinaryManifest ?? params.existingApp.isBinaryManifest,
    isSignedApk: params.isSignedApk ?? params.existingApp.isSignedApk,
    apkSha256: params.apkSha256 ?? params.existingApp.apkSha256,
    externalApkUrl: nextExternalUrl,
    permissionsCount: params.permissionsCount ?? params.existingApp.permissionsCount,
    updatedAt: new Date().toISOString(),
  };

  await idbPut(db, 'apps', updatedApp);
  return updatedApp;
}

export async function localVerifyApkBlob(app: StoreApp): Promise<{
  valid: boolean;
  isBinaryManifest: boolean;
  isSignedApk: boolean;
  sha256?: string;
  externalApkUrl?: string;
  hasCustomApk: boolean;
}> {
  const safeExternalUrl = sanitizeHttpsApkUrlClient(app.externalApkUrl);
  if (safeExternalUrl && !app.apkFilename) {
    return {
      valid: true,
      isBinaryManifest: Boolean(app.isBinaryManifest),
      isSignedApk: Boolean(app.isSignedApk),
      sha256: app.apkSha256,
      externalApkUrl: safeExternalUrl,
      hasCustomApk: app.hasCustomApk,
    };
  }
  const blob = await localBuildOrFetchApkBlob(app);
  try {
    const buf = await blob.arrayBuffer();
    const header = new Uint8Array(buf.slice(0, 4));
    const hasZipMagic =
      header.length === 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07);
    if (!hasZipMagic) {
      return { valid: false, isBinaryManifest: false, isSignedApk: false, hasCustomApk: app.hasCustomApk };
    }
    const zip = await JSZip.loadAsync(buf);
    const manifest = zip.file('AndroidManifest.xml');
    if (!manifest) {
      return { valid: false, isBinaryManifest: false, isSignedApk: false, hasCustomApk: app.hasCustomApk };
    }
    const mBuf = await manifest.async('arraybuffer');
    const isBinaryManifest = mBuf.byteLength >= 4 && new DataView(mBuf).getUint16(0, true) === 0x0003;
    const hasCert = Object.keys(zip.files).some((n) => /^META-INF\/.+\.(RSA|DSA|EC|SF)$/i.test(n));
    let sha256 = app.apkSha256;
    if (!sha256 && typeof globalThis.crypto?.subtle?.digest === 'function') {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
      sha256 = bytesToHex(new Uint8Array(digest));
    }
    return {
      valid: true,
      isBinaryManifest,
      isSignedApk: hasCert || Boolean(app.isSignedApk),
      sha256,
      externalApkUrl: safeExternalUrl,
      hasCustomApk: app.hasCustomApk,
    };
  } catch {
    return { valid: false, isBinaryManifest: false, isSignedApk: false, hasCustomApk: app.hasCustomApk };
  }
}

export async function localIncrementInstall(app: StoreApp): Promise<number> {
  const db = await openLocalDb();
  const currentPatch = await idbGet<AppStatsPatch>(db, 'appStats', app.id);
  const nextDownloads = (currentPatch?.downloads ?? app.downloads) + 1;
  await idbPut(db, 'appStats', { appId: app.id, downloads: nextDownloads });
  return nextDownloads;
}

export async function localBuildOrFetchApkBlob(app: StoreApp): Promise<Blob> {
  const db = await openLocalDb();
  const saved = await idbGet<{ appId: string; blob: Blob }>(db, 'apkBlobs', app.id);
  if (saved?.blob) {
    return saved.blob;
  }

  const zip = new JSZip();
  const manifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="${app.packageName}"
  android:versionCode="${app.versionCode || '1'}"
  android:versionName="${app.versionName || '1.0.0'}">
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="34" />
  <application android:label="${app.name}" android:icon="@mipmap/ic_launcher" />
</manifest>`;
  zip.file('AndroidManifest.xml', manifestXml);
  zip.file(
    'META-INF/MANIFEST.MF',
    `Manifest-Version: 1.0\r\nCreated-By: AppStorePlus\r\nPackage: ${app.packageName}\r\nVersion: ${app.versionName}\r\n`
  );
  zip.file(
    'assets/app-info.json',
    JSON.stringify({
      name: app.name,
      packageName: app.packageName,
      versionName: app.versionName,
      developer: app.developer,
    })
  );
  const rawBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return new Blob([rawBlob], { type: 'application/vnd.android.package-archive' });
}

export async function buildSampleApkFileClient(): Promise<File> {
  const zip = new JSZip();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="com.noor.smartnotes.apk"
  android:versionCode="24"
  android:versionName="2.4.0">
  <uses-sdk android:minSdkVersion="26" />
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <application android:label="مفكرة نور الذكية" android:icon="@mipmap/ic_launcher" />
</manifest>`;
  zip.file('AndroidManifest.xml', xml);

  try {
    const iconResp = await fetch(FALLBACK_APPS[0].iconUrl);
    if (iconResp.ok) {
      const iconBuf = await iconResp.arrayBuffer();
      zip.file('res/mipmap-xxxhdpi-v4/ic_launcher.png', iconBuf);
    }
  } catch {
    // Proceed even without icon asset
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'noor-smartnotes-v2.4.0.apk', {
    type: 'application/vnd.android.package-archive',
  });
}

export async function localSubmitReview(params: {
  app: StoreApp;
  authorName: string;
  rating: number;
  comment: string;
}): Promise<{ review: ReviewItem; app: StoreApp }> {
  const db = await openLocalDb();
  const review: ReviewItem = {
    id: randomId('rev'),
    appId: params.app.id,
    authorName: params.authorName.trim().slice(0, 60),
    rating: Math.min(5, Math.max(1, Math.round(params.rating))),
    comment: params.comment.trim().slice(0, 1200),
    createdAt: new Date().toISOString(),
    helpfulCount: 0,
  };

  await idbPut(db, 'reviews', review);
  const detail = await localGetAppDetail(params.app.id);
  return {
    review,
    app: detail?.app ?? params.app,
  };
}

export async function localVoteHelpful(
  reviewId: string,
  currentCount: number
): Promise<number> {
  const db = await openLocalDb();
  const existing = await idbGet<ReviewHelpfulPatch>(db, 'reviewHelpful', reviewId);
  const nextCount = (existing?.helpfulCount ?? currentCount) + 1;
  await idbPut(db, 'reviewHelpful', { reviewId, helpfulCount: nextCount });
  return nextCount;
}

export async function localDeleteApp(appId: string, ownerUid: string): Promise<boolean> {
  const db = await openLocalDb();
  const app = await idbGet<StoreApp>(db, 'apps', appId);
  if (!app || app.ownerUid !== ownerUid) {
    return false;
  }
  await idbDelete(db, 'apps', appId);
  await idbDelete(db, 'apkBlobs', appId);
  return true;
}
