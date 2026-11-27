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
const DB_VERSION = 1;

interface LocalStoredUser {
  uid: string;
  displayName: string;
  email: string;
  saltHex: string;
  hashHex: string;
  createdAt: string;
}

interface AppStatsPatch {
  appId: string;
  downloads: number;
}

interface ReviewHelpfulPatch {
  reviewId: string;
  helpfulCount: number;
}

function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

function idbPut<T>(db: IDBDatabase, storeName: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
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

async function derivePasswordHashHex(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const saltBuffer = new Uint8Array(salt).buffer;
  const bits = await crypto.subtle.deriveBits(
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

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function randomId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
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

  const salt = crypto.getRandomValues(new Uint8Array(16));
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
    whatsNew: params.whatsNew.trim() || 'الإصدار الأولي على متجر تطبيقات بلس.',
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
