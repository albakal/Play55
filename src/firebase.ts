import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { AppCategory, AppDetailResponse, ReviewItem, StoreApp } from './types.ts';
import { isValidAppId } from './utils/shareLink.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {
  // Keep default persistence if browser restricts IndexedDB
});
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export async function signInWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function signOutDeveloper(): Promise<void> {
  await signOut(auth);
}

export async function syncDeveloperProfile(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;
  const docPath = `developers/${user.uid}`;
  const ref = doc(db, 'developers', user.uid);

  const displayName = (user.displayName || user.email.split('@')[0] || 'Developer').slice(0, 100);
  const email = user.email.slice(0, 200);
  const photoUrl = user.photoURL ? user.photoURL.slice(0, 500) : '';

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await setDoc(
        ref,
        {
          displayName,
          email,
          ...(photoUrl ? { photoUrl } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      await setDoc(ref, {
        uid: user.uid,
        displayName,
        email,
        ...(photoUrl ? { photoUrl } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

function toIsoTimestamp(value: unknown): string {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  return new Date().toISOString();
}

function sanitizeHttpsExternalUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) return undefined;
  if (!/^https:\/\/[^\s@]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function mapFirestoreDocToStoreApp(raw: Record<string, unknown>, docId: string): StoreApp {
  const distRaw = (raw.ratingDistribution as Record<string, unknown> | undefined) || {};
  const ratingDistribution = {
    5: Math.max(0, Math.floor(Number(distRaw['5'] ?? 0) || 0)),
    4: Math.max(0, Math.floor(Number(distRaw['4'] ?? 0) || 0)),
    3: Math.max(0, Math.floor(Number(distRaw['3'] ?? 0) || 0)),
    2: Math.max(0, Math.floor(Number(distRaw['2'] ?? 0) || 0)),
    1: Math.max(0, Math.floor(Number(distRaw['1'] ?? 0) || 0)),
  };

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : docId,
    name: String(raw.name || 'تطبيق'),
    developer: String(raw.developer || 'مطور مستقل'),
    category: (raw.category as AppCategory) || 'الأدوات',
    shortDescription: String(raw.shortDescription || ''),
    fullDescription: String(raw.fullDescription || raw.shortDescription || ''),
    whatsNew: String(raw.whatsNew || ''),
    packageName: String(raw.packageName || 'com.app.android'),
    versionName: String(raw.versionName || '1.0.0'),
    versionCode: String(raw.versionCode || '1'),
    minAndroid: String(raw.minAndroid || 'Android 8.0+'),
    ageRating: String(raw.ageRating || '+3'),
    sizeMB: Math.max(0.01, Number(raw.sizeMB) || 1),
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : '',
    screenshots: Array.isArray(raw.screenshots)
      ? raw.screenshots.filter((s): s is string => typeof s === 'string').slice(0, 4)
      : [],
    apkFilename: typeof raw.apkFilename === 'string' ? raw.apkFilename : '',
    hasCustomApk: Boolean(raw.hasCustomApk),
    isBinaryManifest: typeof raw.isBinaryManifest === 'boolean' ? raw.isBinaryManifest : undefined,
    isSignedApk: typeof raw.isSignedApk === 'boolean' ? raw.isSignedApk : undefined,
    signatureScheme: typeof raw.signatureScheme === 'string' ? raw.signatureScheme : undefined,
    signerCertSha256: typeof raw.signerCertSha256 === 'string' ? raw.signerCertSha256 : undefined,
    apkSha256: typeof raw.apkSha256 === 'string' ? raw.apkSha256 : undefined,
    externalApkUrl: sanitizeHttpsExternalUrl(typeof raw.externalApkUrl === 'string' ? raw.externalApkUrl : undefined),
    permissionsCount: Math.max(0, Math.floor(Number(raw.permissionsCount) || 0)),
    downloads: Math.max(0, Math.floor(Number(raw.downloads) || 0)),
    averageRating: Math.min(5, Math.max(0, Number(raw.averageRating) || 0)),
    reviewCount: Math.max(0, Math.floor(Number(raw.reviewCount) || 0)),
    ratingDistribution,
    featured: false,
    syncedToCloud: true,
    ownerUid: typeof raw.ownerUid === 'string' ? raw.ownerUid : undefined,
    createdAt: toIsoTimestamp(raw.createdAt),
    updatedAt: toIsoTimestamp(raw.updatedAt),
  };
}

function computeStatsFromReviews(reviews: ReviewItem[]) {
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

export function isUnportableMediaRef(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('./uploads/') ||
    trimmed.startsWith('uploads/') ||
    trimmed.startsWith('/src/assets/') ||
    trimmed.startsWith('./src/assets/') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://')
  );
}

export function isPortableMediaRef(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (isUnportableMediaRef(trimmed)) return false;
  return (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('./media/') ||
    trimmed.startsWith('/media/') ||
    trimmed.startsWith('./api/brand-icon/') ||
    trimmed.startsWith('/api/brand-icon/') ||
    trimmed.startsWith('https://')
  );
}

export function needsCloudMediaRepair(appData: StoreApp): boolean {
  if (!appData.iconUrl || !appData.iconUrl.trim() || isUnportableMediaRef(appData.iconUrl)) {
    return true;
  }
  return (appData.screenshots || []).some(
    (s) => !s || !s.trim() || isUnportableMediaRef(s)
  );
}

function normalizeStaticStoreMediaRef(url: string): string | null {
  const trimmed = url.trim().replace(/^\/Play55(?=\/)/i, '');
  const brandMatch = /^\.?\/?api\/brand-icon\/([a-z0-9_-]+)$/i.exec(trimmed);
  if (brandMatch?.[1]) {
    return `./api/brand-icon/${brandMatch[1].toLowerCase()}`;
  }
  const storeMatch =
    /^\.?\/?(?:src\/assets\/images|media\/store)\/([a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp|svg))$/i.exec(
      trimmed
    );
  if (storeMatch?.[1]) {
    return `./media/store/${storeMatch[1]}`;
  }
  return null;
}

async function renderImageSourceToCompressedDataUrl(
  src: string,
  maxChars: number,
  maxDim: number
): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return '';
  }

  return await new Promise<string>((resolve) => {
    const img = new Image();
    // Never set crossOrigin on data: or blob: URLs; some mobile WebViews fail decoding them when crossOrigin is set
    if (/^https?:\/\//i.test(src)) {
      try {
        if (typeof window !== 'undefined' && new URL(src).origin !== window.location.origin) {
          img.crossOrigin = 'anonymous';
        }
      } catch {
        // Ignore URL parsing issues
      }
    }

    img.onload = () => {
      try {
        const naturalW = img.naturalWidth || img.width || maxDim;
        const naturalH = img.naturalHeight || img.height || maxDim;
        const dimFactors = [1, 0.72, 0.5, 0.34];
        const attempts: Array<[string, number]> = [
          ['image/webp', 0.84],
          ['image/webp', 0.68],
          ['image/webp', 0.5],
          ['image/jpeg', 0.78],
          ['image/jpeg', 0.6],
          ['image/jpeg', 0.42],
        ];

        for (const factor of dimFactors) {
          const targetDim = Math.max(64, Math.round(maxDim * factor));
          const ratio = Math.min(1, targetDim / Math.max(naturalW, naturalH, 1));
          const width = Math.max(1, Math.round(naturalW * ratio));
          const height = Math.max(1, Math.round(naturalH * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve('');
            return;
          }
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          for (const [mime, quality] of attempts) {
            const out = canvas.toDataURL(mime, quality);
            if (out.startsWith(`data:${mime}`) && out.length <= maxChars) {
              resolve(out);
              return;
            }
          }
        }

        // Last-resort tiny JPEG/PNG thumbnail so uploaded visuals are never dropped completely
        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.width = 96;
        fallbackCanvas.height = Math.max(48, Math.round((naturalH / Math.max(naturalW, 1)) * 96));
        const fCtx = fallbackCanvas.getContext('2d');
        if (fCtx) {
          fCtx.drawImage(img, 0, 0, fallbackCanvas.width, fallbackCanvas.height);
          const smallJpg = fallbackCanvas.toDataURL('image/jpeg', 0.4);
          if (smallJpg.startsWith('data:image/') && smallJpg.length <= maxChars) {
            resolve(smallJpg);
            return;
          }
        }
        resolve('');
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

export async function compressBlobToDataUrl(
  blob: Blob,
  maxChars = 90_000,
  maxDim = 512
): Promise<string> {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof document !== 'undefined') {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const compressed = await renderImageSourceToCompressedDataUrl(objectUrl, maxChars, maxDim);
      if (compressed) return compressed;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = String(reader.result || '');
        resolve(res.length <= maxChars ? res : '');
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  }
  return '';
}

export async function compressImageDataUrlForCloud(
  url: string,
  maxChars = 95_000,
  maxDim = 256
): Promise<string> {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  const staticRef = normalizeStaticStoreMediaRef(trimmed);
  if (staticRef) return staticRef;

  if (trimmed.startsWith('data:image/svg+xml')) {
    return trimmed.length <= maxChars ? trimmed : '';
  }

  if (trimmed.startsWith('data:image/')) {
    if (trimmed.length <= maxChars) return trimmed;
    return await renderImageSourceToCompressedDataUrl(trimmed, maxChars, maxDim);
  }

  if (trimmed.startsWith('https://')) {
    return trimmed.length <= 500 ? trimmed : '';
  }

  // Relative upload path (./uploads/..., /uploads/...) or blob: URL -> fetch & convert to portable data URL
  const normalizedRel = trimmed.replace(/^\/Play55(?=\/)/i, '');
  const fetchTarget = normalizedRel.startsWith('/uploads/')
    ? `.${normalizedRel}`
    : normalizedRel.startsWith('uploads/')
    ? `./${normalizedRel}`
    : normalizedRel;

  if (typeof fetch !== 'function') {
    return '';
  }

  try {
    const res = await fetch(fetchTarget);
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.startsWith('image/')) {
      return '';
    }
    const blob = await res.blob();
    return await compressBlobToDataUrl(blob, maxChars, maxDim);
  } catch {
    return '';
  }
}

export async function cloudListApps(): Promise<StoreApp[]> {
  try {
    const q = query(collection(db, 'apps'), orderBy('updatedAt', 'desc'), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapFirestoreDocToStoreApp(d.data() as Record<string, unknown>, d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'apps');
  }
}

export async function cloudGetAppDetail(appId: string): Promise<AppDetailResponse | null> {
  if (!isValidAppId(appId)) return null;
  const docPath = `apps/${appId}`;

  let snap;
  try {
    snap = await getDoc(doc(db, 'apps', appId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  if (!snap.exists()) {
    return null;
  }

  const baseApp = mapFirestoreDocToStoreApp(snap.data() as Record<string, unknown>, snap.id);

  let reviews: ReviewItem[] = [];
  try {
    const revSnap = await getDocs(
      query(collection(db, 'apps', appId, 'reviews'), orderBy('createdAt', 'desc'), limit(100))
    );
    reviews = revSnap.docs.map((d) => {
      const r = d.data() as Record<string, unknown>;
      return {
        id: typeof r.id === 'string' && r.id ? r.id : d.id,
        appId,
        authorName: String(r.authorName || 'مستخدم'),
        rating: Math.min(5, Math.max(1, Math.round(Number(r.rating) || 5))),
        comment: String(r.comment || ''),
        createdAt: toIsoTimestamp(r.createdAt),
        helpfulCount: Math.max(0, Math.floor(Number(r.helpfulCount) || 0)),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `apps/${appId}/reviews`);
  }

  if (reviews.length > 0) {
    const stats = computeStatsFromReviews(reviews);
    return {
      app: {
        ...baseApp,
        averageRating: stats.averageRating,
        reviewCount: stats.reviewCount,
        ratingDistribution: stats.ratingDistribution,
      },
      reviews,
    };
  }

  return { app: baseApp, reviews };
}

export async function cloudPublishOrUpdateApp(
  appData: StoreApp,
  isUpdate: boolean,
  fallbackExistingMedia?: { iconUrl?: string; screenshots?: string[] }
): Promise<{ ok: boolean; syncedApp?: StoreApp }> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified || !isValidAppId(appData.id)) {
    return { ok: false };
  }
  if (appData.ownerUid && appData.ownerUid !== fbUser.uid) {
    return { ok: false };
  }

  const docPath = `apps/${appData.id}`;
  const ref = doc(db, 'apps', appData.id);

  let safeIconUrl = await compressImageDataUrlForCloud(appData.iconUrl, 90_000, 256);
  if (!safeIconUrl && fallbackExistingMedia?.iconUrl) {
    safeIconUrl = await compressImageDataUrlForCloud(fallbackExistingMedia.iconUrl, 90_000, 256);
  }
  if (!safeIconUrl) {
    safeIconUrl = './media/store/brand_nabd.svg';
  }

  const rawShots = (appData.screenshots || []).slice(0, 4);
  let safeScreenshots: string[] = [];
  for (let i = 0; i < rawShots.length; i++) {
    let compressed = await compressImageDataUrlForCloud(rawShots[i], 100_000, 720);
    if (!compressed && fallbackExistingMedia?.screenshots?.[i]) {
      compressed = await compressImageDataUrlForCloud(
        fallbackExistingMedia.screenshots[i],
        100_000,
        720
      );
    }
    if (compressed) {
      safeScreenshots.push(compressed);
    }
  }

  // Keep total document size comfortably under Firestore 1 MiB limit
  const totalMediaLen = () =>
    safeIconUrl.length + safeScreenshots.reduce((acc, s) => acc + s.length, 0);
  if (totalMediaLen() > 650_000 && safeScreenshots.length > 0) {
    const recompacted: string[] = [];
    for (const s of safeScreenshots) {
      recompacted.push((await compressImageDataUrlForCloud(s, 70_000, 540)) || s);
    }
    safeScreenshots = recompacted;
  }

  const safeExternalUrl = sanitizeHttpsExternalUrl(appData.externalApkUrl);

  const cleanName = appData.name.trim().slice(0, 120) || 'تطبيق';
  const cleanDeveloper = (appData.developer.trim() || fbUser.displayName || 'مطور مستقل').slice(0, 120);
  const cleanShortDesc = (appData.shortDescription.trim() || cleanName).slice(0, 240);
  const cleanFullDesc = (appData.fullDescription.trim() || cleanShortDesc || cleanName).slice(0, 5000);

  const mutableFields: Record<string, unknown> = {
    name: cleanName,
    developer: cleanDeveloper,
    category: String(appData.category || 'الأدوات').slice(0, 40),
    shortDescription: cleanShortDesc,
    fullDescription: cleanFullDesc,
    whatsNew: (appData.whatsNew || '').trim().slice(0, 1000),
    packageName: (appData.packageName.trim() || 'com.app.android').slice(0, 160),
    versionName: (appData.versionName.trim() || '1.0.0').slice(0, 64),
    versionCode: (appData.versionCode.trim() || '1').slice(0, 32),
    minAndroid: (appData.minAndroid.trim() || 'Android 8.0+').slice(0, 40),
    ageRating: (appData.ageRating.trim() || '+3').slice(0, 16),
    sizeMB: Math.max(0.01, Number(appData.sizeMB) || 1),
    iconUrl: safeIconUrl,
    screenshots: safeScreenshots,
    apkFilename: (appData.apkFilename || '').slice(0, 200),
    hasCustomApk: Boolean(appData.hasCustomApk),
    permissionsCount: Math.max(0, Math.floor(Number(appData.permissionsCount) || 0)),
    updatedAt: serverTimestamp(),
  };

  if (typeof appData.isBinaryManifest === 'boolean') {
    mutableFields.isBinaryManifest = appData.isBinaryManifest;
  }
  if (typeof appData.isSignedApk === 'boolean') {
    mutableFields.isSignedApk = appData.isSignedApk;
  }
  if (typeof appData.signatureScheme === 'string' && appData.signatureScheme) {
    mutableFields.signatureScheme = appData.signatureScheme.slice(0, 32);
  }
  if (typeof appData.signerCertSha256 === 'string' && appData.signerCertSha256) {
    mutableFields.signerCertSha256 = appData.signerCertSha256.slice(0, 128);
  }
  if (typeof appData.apkSha256 === 'string' && appData.apkSha256) {
    mutableFields.apkSha256 = appData.apkSha256.slice(0, 128);
  }

  const syncedAppResult: StoreApp = {
    ...appData,
    name: cleanName,
    developer: cleanDeveloper,
    shortDescription: cleanShortDesc,
    fullDescription: cleanFullDesc,
    iconUrl: safeIconUrl,
    screenshots: safeScreenshots,
    externalApkUrl: safeExternalUrl,
    syncedToCloud: true,
    ownerUid: appData.ownerUid || fbUser.uid,
  };

  try {
    const existingSnap = isUpdate ? await getDoc(ref) : null;

    if (isUpdate && existingSnap?.exists()) {
      const updatePayload: Record<string, unknown> = { ...mutableFields };
      if (safeExternalUrl) {
        updatePayload.externalApkUrl = safeExternalUrl;
      } else if (existingSnap.data()?.externalApkUrl) {
        updatePayload.externalApkUrl = deleteField();
      }
      await updateDoc(ref, updatePayload);
      return { ok: true, syncedApp: syncedAppResult };
    }

    const createPayload: Record<string, unknown> = {
      id: appData.id,
      ...mutableFields,
      ...(safeExternalUrl ? { externalApkUrl: safeExternalUrl } : {}),
      downloads: Math.max(0, Math.floor(Number(appData.downloads) || 1)),
      averageRating: Math.min(5, Math.max(0, Number(appData.averageRating) || 0)),
      reviewCount: Math.max(0, Math.floor(Number(appData.reviewCount) || 0)),
      ratingDistribution: {
        '5': Math.max(0, Math.floor(Number(appData.ratingDistribution?.[5] ?? 0) || 0)),
        '4': Math.max(0, Math.floor(Number(appData.ratingDistribution?.[4] ?? 0) || 0)),
        '3': Math.max(0, Math.floor(Number(appData.ratingDistribution?.[3] ?? 0) || 0)),
        '2': Math.max(0, Math.floor(Number(appData.ratingDistribution?.[2] ?? 0) || 0)),
        '1': Math.max(0, Math.floor(Number(appData.ratingDistribution?.[1] ?? 0) || 0)),
      },
      ownerUid: fbUser.uid,
      createdAt: serverTimestamp(),
    };

    await setDoc(ref, createPayload);
    return { ok: true, syncedApp: syncedAppResult };
  } catch (error) {
    handleFirestoreError(error, isUpdate ? OperationType.UPDATE : OperationType.CREATE, docPath);
  }
}

export async function cloudDeleteApp(appId: string): Promise<boolean> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified || !isValidAppId(appId)) {
    return false;
  }
  const docPath = `apps/${appId}`;
  const ref = doc(db, 'apps', appId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    if (snap.data()?.ownerUid !== fbUser.uid) return false;
    await deleteDoc(ref);
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function cloudSubmitReview(params: {
  app: StoreApp;
  authorName: string;
  rating: number;
  comment: string;
  existingReviews: ReviewItem[];
}): Promise<{ review: ReviewItem; app: StoreApp } | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified || !isValidAppId(params.app.id)) {
    return null;
  }

  const parentRef = doc(db, 'apps', params.app.id);
  let parentSnap;
  try {
    parentSnap = await getDoc(parentRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `apps/${params.app.id}`);
  }
  if (!parentSnap.exists()) return null;

  const reviewId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reviewPath = `apps/${params.app.id}/reviews/${reviewId}`;
  const cleanAuthor = params.authorName.trim().slice(0, 60);
  const cleanComment = params.comment.trim().slice(0, 1200);
  const cleanRating = Math.min(5, Math.max(1, Math.round(params.rating)));

  try {
    await setDoc(doc(db, 'apps', params.app.id, 'reviews', reviewId), {
      id: reviewId,
      appId: params.app.id,
      authorUid: fbUser.uid,
      authorName: cleanAuthor,
      rating: cleanRating,
      comment: cleanComment,
      helpfulCount: 0,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, reviewPath);
  }

  const review: ReviewItem = {
    id: reviewId,
    appId: params.app.id,
    authorName: cleanAuthor,
    rating: cleanRating,
    comment: cleanComment,
    createdAt: new Date().toISOString(),
    helpfulCount: 0,
  };

  const nextReviews = [review, ...params.existingReviews];
  const stats = computeStatsFromReviews(nextReviews);
  return {
    review,
    app: {
      ...params.app,
      averageRating: stats.averageRating,
      reviewCount: stats.reviewCount,
      ratingDistribution: stats.ratingDistribution,
    },
  };
}
