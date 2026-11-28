import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  ArrowUpLeft,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  Star,
  Upload,
} from 'lucide-react';
import type {
  AppCategory,
  AppDetailResponse,
  DeveloperSessionUser,
  ReviewItem,
  StoreApp,
} from './types.ts';
import {
  auth,
  cloudGetAppDetail,
  cloudListApps,
  cloudPublishOrUpdateApp,
  signInWithGoogle,
  signOutDeveloper,
  syncDeveloperProfile,
} from './firebase.ts';
import {
  BUNDLED_HERO_BANNER,
  FALLBACK_APPS,
} from './catalog/fallbackStore.ts';
import {
  localBuildOrFetchApkBlob,
  localClearSession,
  localGetAppDetail,
  localGetSession,
  localHasStoredApkBlob,
  localIncrementInstall,
  localListApps,
  localLoginDeveloper,
  localMarkAppSynced,
  localRegisterDeveloper,
  localSaveSession,
  localVerifyApkBlob,
} from './utils/localStoreEngine.ts';
import {
  getAppDownloadInfo,
  getDownloadedAppsMap,
  INSTALL_HISTORY_EVENT,
  recordAppDownload,
} from './utils/installHistory.ts';
import type { DownloadedAppRecord } from './utils/installHistory.ts';
import {
  decodeSharedAppSnapshot,
  extractAppIdFromLocation,
  FALLBACK_APP_IDS,
} from './utils/shareLink.ts';
import { StoreHeader } from './components/StoreHeader.tsx';
import type { NavTab } from './components/StoreHeader.tsx';
import { AppIcon } from './components/AppIcon.tsx';
import { AppDetailView } from './components/AppDetailView.tsx';
import { UploadStudioView } from './components/UploadStudioView.tsx';

const CATEGORIES: Array<'الكل' | AppCategory> = [
  'الكل',
  'الإنتاجية',
  'الأدوات',
  'الصوتيات',
  'التعليم',
  'الأعمال',
  'التصوير',
  'الألعاب',
];

function formatInstalls(count: number): string {
  if (count >= 1_000_000) return `+${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `+${Math.round(count / 1_000)}K`;
  return `${count}`;
}

export default function App() {
  const [apps, setApps] = useState<StoreApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('apps');
  const [selectedCategory, setSelectedCategory] = useState<'الكل' | AppCategory>('الكل');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedAppId, setSelectedAppId] = useState<string | null>(() =>
    extractAppIdFromLocation()
  );
  const [detailData, setDetailData] = useState<AppDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [quickInstallingId, setQuickInstallingId] = useState<string | null>(null);
  const [quickInstalledId, setQuickInstalledId] = useState<string | null>(null);
  const [quickInstallError, setQuickInstallError] = useState<string | null>(null);
  const [downloadHistory, setDownloadHistory] = useState<Record<string, DownloadedAppRecord>>(() =>
    getDownloadedAppsMap()
  );

  const [editingApp, setEditingApp] = useState<StoreApp | null>(null);

  const [currentUser, setCurrentUser] = useState<DeveloperSessionUser | null>(null);
  const [manualToken, setManualToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const refreshHistory = () => setDownloadHistory(getDownloadedAppsMap());
    window.addEventListener(INSTALL_HISTORY_EVENT, refreshHistory);
    window.addEventListener('storage', refreshHistory);
    return () => {
      window.removeEventListener(INSTALL_HISTORY_EVENT, refreshHistory);
      window.removeEventListener('storage', refreshHistory);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setAuthLoading(false);
    }, 2500);

    const restoreManualOrLocalSession = async () => {
      try {
        const res = await fetch('./api/auth/me', {
          credentials: 'include',
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = (await res.json()) as { user?: DeveloperSessionUser };
          if (active && data.user) {
            setCurrentUser((prev) => prev || data.user || null);
            setAuthLoading(false);
            return;
          }
        } else if (!contentType.includes('application/json') || res.status === 404 || res.status === 405) {
          const localSess = await localGetSession();
          if (active && localSess) {
            setManualToken(localSess.token);
            setCurrentUser((prev) => prev || localSess.user);
            setAuthLoading(false);
            return;
          }
        }
      } catch {
        const localSess = await localGetSession().catch(() => null);
        if (active && localSess) {
          setManualToken(localSess.token);
          setCurrentUser((prev) => prev || localSess.user);
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    };

    void restoreManualOrLocalSession();

    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      window.clearTimeout(timer);
      if (!active) return;
      if (fbUser) {
        setManualToken(null);
        setCurrentUser({
          uid: fbUser.uid,
          displayName: fbUser.displayName || fbUser.email || 'مطور جوجل',
          email: fbUser.email || '',
          photoURL: fbUser.photoURL,
          provider: 'google',
        });
        void syncDeveloperProfile(fbUser).catch(() => {
          // Handled inside syncDeveloperProfile error logging
        });
        setAuthLoading(false);
      } else {
        setCurrentUser((prev) => (prev?.provider === 'manual' ? prev : null));
      }
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const runLocalManualAuth = async (params: {
    mode: 'login' | 'register';
    name?: string;
    email: string;
    password: string;
  }) => {
    try {
      const localResult =
        params.mode === 'register'
          ? await localRegisterDeveloper({
              name: params.name || '',
              email: params.email,
              password: params.password,
            })
          : await localLoginDeveloper({
              email: params.email,
              password: params.password,
            });
      await localSaveSession(localResult.user, localResult.token).catch(() => {});
      setManualToken(localResult.token);
      setCurrentUser(localResult.user);
    } catch (localErr) {
      setAuthError(
        localErr instanceof Error
          ? localErr.message
          : 'تعذر إنشاء الحساب أو تسجيل الدخول، يرجى المحاولة مرة أخرى.'
      );
    }
  };

  const handleManualAuth = async (params: {
    mode: 'login' | 'register';
    name?: string;
    email: string;
    password: string;
  }) => {
    setAuthError(null);
    const endpoint =
      params.mode === 'register' ? './api/auth/register' : './api/auth/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'Play55',
        },
        body: JSON.stringify({
          name: params.name,
          email: params.email,
          password: params.password,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json') || res.status === 405) {
        await runLocalManualAuth(params);
        return;
      }
      const data = (await res.json()) as {
        error?: string;
        token?: string;
        user?: DeveloperSessionUser;
      };
      if (!res.ok || !data.token || !data.user) {
        setAuthError(data.error || 'تعذر إتمام العملية، يرجى التحقق من البيانات.');
        return;
      }
      setManualToken(data.token);
      setCurrentUser(data.user);
    } catch {
      await runLocalManualAuth(params);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
        setAuthError('تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.');
      } else if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        setAuthError(
          `النطاق (${window.location.hostname}) غير مضاف في النطاقات المصرح بها لحساب جوجل. يمكنك التسجيل أو الدخول يدوياً بالأعلى عبر الاسم والبريد وكلمة المرور مباشرة.`
        );
      } else if (code === 'auth/popup-blocked' || msg.includes('popup-blocked')) {
        setAuthError('حظر المتصفح نافذة تسجيل الدخول المنبثقة. يمكنك التسجيل يدوياً بالأعلى أو السماح بالنوافذ المنبثقة.');
      } else {
        setAuthError(
          `تعذر تسجيل الدخول بحساب جوجل (${code || 'خطأ غير معروف'})، يمكنك استخدام التسجيل اليدوي بالأعلى مباشرة.`
        );
      }
    }
  };

  const handleSignOut = async () => {
    setAuthError(null);
    setManualToken(null);
    setCurrentUser(null);
    setEditingApp(null);
    await fetch('./api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'Play55' },
    }).catch(() => {});
    await localClearSession().catch(() => {});
    await signOutDeveloper().catch(() => {});
  };

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    if (manualToken) return manualToken;
    if (auth.currentUser) {
      try {
        return await auth.currentUser.getIdToken();
      } catch {
        return null;
      }
    }
    return null;
  }, [manualToken]);

  const autoSyncedIdsRef = useRef<Set<string>>(new Set());

  const sortCatalogApps = useCallback(
    (list: StoreApp[], sort: 'popular' | 'rating' | 'newest'): StoreApp[] => {
      const next = [...list];
      if (sort === 'rating') {
        next.sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount);
      } else if (sort === 'newest') {
        next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      } else {
        next.sort((a, b) => b.downloads - a.downloads);
      }
      return next;
    },
    []
  );

  const mergeAppLists = useCallback((primary: StoreApp[], secondary: StoreApp[]): StoreApp[] => {
    const merged = new Map<string, StoreApp>();
    for (const item of primary) {
      merged.set(item.id, item);
    }
    for (const item of secondary) {
      const existing = merged.get(item.id);
      if (!existing) {
        merged.set(item.id, item);
      } else {
        const existingTime = new Date(existing.updatedAt).getTime() || 0;
        const incomingTime = new Date(item.updatedAt).getTime() || 0;
        if (incomingTime > existingTime) {
          merged.set(item.id, {
            ...item,
            syncedToCloud: existing.syncedToCloud || item.syncedToCloud,
          });
        } else if (item.syncedToCloud && !existing.syncedToCloud) {
          merged.set(item.id, { ...existing, syncedToCloud: true });
        }
      }
    }
    return Array.from(merged.values());
  }, []);

  const fetchApps = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const sort: 'popular' | 'rating' | 'newest' =
      activeTab === 'top-rated' ? 'rating' : activeTab === 'newest' ? 'newest' : 'popular';

    const cloudPromise = cloudListApps().catch(() => [] as StoreApp[]);

    try {
      const res = await fetch(`./api/apps?sort=${encodeURIComponent(sort)}`);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error('Static fallback');
      }
      const data = (await res.json()) as { apps: StoreApp[] };
      const backendApps = data.apps.map((a) => ({ ...a, syncedToCloud: true }));
      const cloudApps = await cloudPromise;
      setApps(sortCatalogApps(mergeAppLists(backendApps, cloudApps), sort));
    } catch {
      try {
        const [localApps, cloudApps] = await Promise.all([
          localListApps(sort),
          cloudPromise,
        ]);
        setApps(sortCatalogApps(mergeAppLists(localApps, cloudApps), sort));
      } catch {
        const cloudApps = await cloudPromise;
        setApps(sortCatalogApps(mergeAppLists(FALLBACK_APPS, cloudApps), sort));
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, mergeAppLists, sortCatalogApps]);

  useEffect(() => {
    if (activeTab !== 'upload') {
      void fetchApps();
    }
  }, [activeTab, fetchApps]);

  useEffect(() => {
    if (
      !currentUser ||
      currentUser.provider !== 'google' ||
      !auth.currentUser?.emailVerified ||
      apps.length === 0
    ) {
      return;
    }

    const candidates = apps.filter(
      (a) =>
        a.ownerUid === currentUser.uid &&
        !a.syncedToCloud &&
        !FALLBACK_APP_IDS.has(a.id) &&
        !autoSyncedIdsRef.current.has(a.id)
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const item of candidates) {
        autoSyncedIdsRef.current.add(item.id);
        try {
          const synced = await cloudPublishOrUpdateApp(item, false);
          if (synced && !cancelled) {
            await localMarkAppSynced(item.id, true);
            setApps((prev) =>
              prev.map((a) => (a.id === item.id ? { ...a, syncedToCloud: true } : a))
            );
          }
        } catch {
          // Non-fatal auto-sync attempt
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apps, currentUser]);

  const syncAppQueryUrl = useCallback((appId: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (appId) {
        url.searchParams.set('app', appId);
        url.hash = '';
      } else {
        url.searchParams.delete('app');
        if (url.hash.startsWith('#p55=') || url.hash.includes('app=')) {
          url.hash = '';
        }
      }
      window.history.pushState({ appId }, '', url.toString());
    } catch {
      // Ignore history API issues
    }
  }, []);

  const openAppDetail = useCallback(
    async (appId: string, pushHistory = true) => {
      setSelectedAppId(appId);
      setDetailError(null);
      setLoadingDetail(true);
      if (pushHistory) {
        const currentParam = extractAppIdFromLocation();
        if (currentParam !== appId) {
          syncAppQueryUrl(appId);
        }
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });

      try {
        try {
          const res = await fetch(`./api/apps/${encodeURIComponent(appId)}`);
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            const data = (await res.json()) as AppDetailResponse;
            setDetailData({
              app: { ...data.app, syncedToCloud: true },
              reviews: data.reviews,
            });
            return;
          }
        } catch {
          // Backend unavailable, continue to Firestore / IndexedDB / URL snapshot
        }

        try {
          const cloudDetail = await cloudGetAppDetail(appId);
          if (cloudDetail) {
            setDetailData(cloudDetail);
            return;
          }
        } catch {
          // Continue to local store & URL snapshot fallback
        }

        const localDetail = await localGetAppDetail(appId).catch(() => null);
        if (localDetail) {
          setDetailData(localDetail);
          return;
        }

        const snapshotApp = decodeSharedAppSnapshot(appId);
        if (snapshotApp) {
          setDetailData({ app: snapshotApp, reviews: [] });
          return;
        }

        setDetailData(null);
        setDetailError('التطبيق المطلوب غير موجود أو تم حذفه.');
      } finally {
        setLoadingDetail(false);
      }
    },
    [syncAppQueryUrl]
  );

  useEffect(() => {
    if (selectedAppId && !detailData && !detailError) {
      void openAppDetail(selectedAppId, false);
    }
  }, [selectedAppId, detailData, detailError, openAppDetail]);

  useEffect(() => {
    const onPopState = () => {
      const appParam = extractAppIdFromLocation();
      if (appParam) {
        setActiveTab('apps');
        void openAppDetail(appParam, false);
      } else {
        setSelectedAppId(null);
        setDetailData(null);
        setDetailError(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [openAppDetail]);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    if (tab !== 'upload') {
      setEditingApp(null);
    }
    setSelectedAppId(null);
    setDetailData(null);
    setDetailError(null);
    if (extractAppIdFromLocation()) {
      syncAppQueryUrl(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return apps.filter((item) => {
      if (selectedCategory !== 'الكل' && item.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.developer.toLowerCase().includes(q) ||
        item.packageName.toLowerCase().includes(q) ||
        item.shortDescription.toLowerCase().includes(q)
      );
    });
  }, [apps, selectedCategory, searchQuery]);

  const featuredApp = useMemo(() => {
    return apps.find((a) => a.featured) || apps[0] || null;
  }, [apps]);

  const handleQuickInstall = async (app: StoreApp) => {
    setQuickInstallingId(app.id);
    setQuickInstallError(null);

    let backendOnline = false;
    let verified = false;
    let resolvedSha256: string | null = app.apkSha256 || null;

    try {
      const vRes = await fetch(`./api/apps/${encodeURIComponent(app.id)}/verify-apk`);
      const vCt = vRes.headers.get('content-type') || '';
      if (vCt.includes('application/json')) {
        backendOnline = true;
        const vData = (await vRes.json()) as { valid?: boolean; sha256?: string | null };
        if (!vRes.ok || !vData.valid) {
          setQuickInstallingId(null);
          setQuickInstallError(`تعذر تثبيت «${app.name}»: ملف APK تالف أو غير مكتمل.`);
          return;
        }
        resolvedSha256 = vData.sha256 || resolvedSha256;
        verified = true;
      }
    } catch {
      backendOnline = false;
    }

    let resolvedExternalUrl: string | null = null;
    if (!backendOnline) {
      const hasLocalBlob = await localHasStoredApkBlob(app.id);
      const safeExternal =
        app.externalApkUrl && /^https:\/\/[^\s@]+$/.test(app.externalApkUrl)
          ? app.externalApkUrl
          : null;
      if (app.hasCustomApk && !safeExternal && !hasLocalBlob) {
        setQuickInstallingId(null);
        setQuickInstallError(
          `«${app.name}» منشور على استضافة ثابتة بدون رابط HTTPS مباشر لملف APK؛ يرجى من المطور إضافة رابط التوزيع في صفحة التحديث أو النشر من خادم Play55 الكامل.`
        );
        return;
      }
      const localCheck = await localVerifyApkBlob(app);
      if (!localCheck.valid) {
        setQuickInstallingId(null);
        setQuickInstallError(`تعذر تثبيت «${app.name}»: ملف APK تالف أو غير مكتمل.`);
        return;
      }
      resolvedSha256 = localCheck.sha256 || resolvedSha256;
      resolvedExternalUrl = localCheck.externalApkUrl || safeExternal || null;
      verified = true;
    }

    if (!verified) {
      setQuickInstallingId(null);
      setQuickInstallError('تعذر التحقق من سلامة ملف APK قبل التثبيت.');
      return;
    }

    if (resolvedExternalUrl) {
      const link = document.createElement('a');
      link.href = resolvedExternalUrl;
      link.setAttribute('download', `${app.packageName}-v${app.versionName}.apk`);
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (backendOnline) {
      try {
        const res = await fetch(`./api/apps/${encodeURIComponent(app.id)}/install`, {
          method: 'POST',
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = (await res.json()) as { downloads: number };
          setApps((prev) =>
            prev.map((a) => (a.id === app.id ? { ...a, downloads: data.downloads } : a))
          );
        }
      } catch {
        // Ignore non-critical counter failure
      }

      const link = document.createElement('a');
      link.href = `./api/apps/${encodeURIComponent(app.id)}/install-apk`;
      link.setAttribute('download', `${app.packageName}-v${app.versionName}.apk`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const nextDownloads = await localIncrementInstall(app).catch(() => app.downloads + 1);
      setApps((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, downloads: nextDownloads } : a))
      );
      const apkBlob = await localBuildOrFetchApkBlob(app);
      const blobUrl = URL.createObjectURL(apkBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `${app.packageName}-v${app.versionName}.apk`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    }

    recordAppDownload(app, resolvedSha256);

    window.setTimeout(() => {
      setQuickInstallingId(null);
      setQuickInstalledId(app.id);
      window.setTimeout(() => setQuickInstalledId(null), 2500);
    }, 450);
  };

  const handleAppUpdated = (updatedApp: StoreApp, updatedReviews?: ReviewItem[]) => {
    setApps((prev) => prev.map((a) => (a.id === updatedApp.id ? updatedApp : a)));
    setDetailData((prev) =>
      prev
        ? {
            app: updatedApp,
            reviews: updatedReviews ?? prev.reviews,
          }
        : null
    );
  };

  const handleAppDeleted = (appId: string) => {
    setApps((prev) => prev.filter((a) => a.id !== appId));
    setSelectedAppId(null);
    setDetailData(null);
    setDetailError(null);
    syncAppQueryUrl(null);
  };

  const handleStartEdit = (app: StoreApp) => {
    setEditingApp(app);
    setSelectedAppId(null);
    setDetailData(null);
    setDetailError(null);
    if (new URLSearchParams(window.location.search).has('app')) {
      syncAppQueryUrl(null);
    }
    setActiveTab('upload');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAppSaved = (savedApp: StoreApp, isUpdate: boolean) => {
    if (isUpdate) {
      setApps((prev) => prev.map((a) => (a.id === savedApp.id ? savedApp : a)));
      setDetailData((prev) =>
        prev && prev.app.id === savedApp.id ? { ...prev, app: savedApp } : prev
      );
      setEditingApp(null);
    } else {
      setApps((prev) => [savedApp, ...prev.filter((a) => a.id !== savedApp.id)]);
    }
  };

  const handleOpenAppFromStudio = (appId: string) => {
    setActiveTab('apps');
    setEditingApp(null);
    void openAppDetail(appId);
  };

  const showHero =
    activeTab === 'apps' &&
    selectedCategory === 'الكل' &&
    searchQuery.trim() === '' &&
    featuredApp !== null &&
    !selectedAppId;

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#202124]">
      <StoreHeader activeTab={activeTab} onSelectTab={handleSelectTab} />

      <main className="flex-1">
        {activeTab === 'upload' ? (
          <UploadStudioView
            user={currentUser}
            apps={apps}
            editingApp={editingApp}
            authLoading={authLoading}
            authError={authError}
            onManualAuth={handleManualAuth}
            onGoogleSignIn={handleGoogleSignIn}
            onSignOut={handleSignOut}
            getAuthToken={getAuthToken}
            onBack={() => handleSelectTab('apps')}
            onOpenApp={handleOpenAppFromStudio}
            onStartEdit={handleStartEdit}
            onCancelEdit={() => setEditingApp(null)}
            onAppSaved={handleAppSaved}
          />
        ) : selectedAppId ? (
          detailError ? (
            <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center space-y-4">
              <p className="text-base font-bold text-[#202124]">{detailError}</p>
              <button
                type="button"
                onClick={() => handleSelectTab('apps')}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] rounded-xl transition-colors"
              >
                العودة إلى المتجر
              </button>
            </div>
          ) : loadingDetail || !detailData ? (
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center space-y-3">
              <div className="w-8 h-8 mx-auto border-2 border-[#01875F]/30 border-t-[#01875F] rounded-full animate-spin" />
              <p className="text-sm text-[#5F6368]">جاري تحميل صفحة التطبيق والمراجعات...</p>
            </div>
          ) : (
            <AppDetailView
              app={detailData.app}
              reviews={detailData.reviews}
              currentUser={currentUser}
              getAuthToken={getAuthToken}
              onBack={() => {
                setSelectedAppId(null);
                setDetailData(null);
                setDetailError(null);
                syncAppQueryUrl(null);
              }}
              onEditApp={handleStartEdit}
              onAppUpdated={handleAppUpdated}
              onAppDeleted={handleAppDeleted}
            />
          )
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
            {/* Search & Category Filter Toolbar */}
            <section className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-xl">
                  <Search className="w-4 h-4 text-[#5F6368] absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث عن تطبيق، اسم مطور، أو معرف الحزمة..."
                    className="w-full pr-11 pl-4 py-2.5 text-sm bg-[#F1F3F4] focus:bg-white border border-transparent focus:border-[#01875F] rounded-full transition-colors focus:outline-none"
                  />
                </div>

                {/* Mobile Navigation Quick Switch */}
                <div className="flex md:hidden items-center gap-2 overflow-x-auto no-scrollbar">
                  <button
                    type="button"
                    onClick={() => handleSelectTab('apps')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                      activeTab === 'apps'
                        ? 'bg-[#01875F] text-white'
                        : 'bg-[#F1F3F4] text-[#5F6368]'
                    }`}
                  >
                    التطبيقات
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTab('top-rated')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                      activeTab === 'top-rated'
                        ? 'bg-[#01875F] text-white'
                        : 'bg-[#F1F3F4] text-[#5F6368]'
                    }`}
                  >
                    الأعلى تقييماً
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTab('newest')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 ${
                      activeTab === 'newest'
                        ? 'bg-[#01875F] text-white'
                        : 'bg-[#F1F3F4] text-[#5F6368]'
                    }`}
                  >
                    الأحدث
                  </button>
                </div>
              </div>

              {/* Category Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                {CATEGORIES.map((cat) => {
                  const active = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-[#E6F4EA] border-[#01875F]/30 text-[#01875F] font-semibold'
                          : 'bg-white border-[#E8EAED] text-[#5F6368] hover:bg-[#F8F9FA] hover:text-[#202124]'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Featured Hero Spotlight */}
            {showHero && featuredApp && (
              <section className="grid grid-cols-1 lg:grid-cols-12 items-stretch border border-[#E8EAED] rounded-3xl overflow-hidden bg-[#F8F9FA]">
                <div className="lg:col-span-6 p-6 sm:p-8 lg:p-10 flex flex-col justify-between gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#01875F]">
                      <span>اختيار المحررين</span>
                      <span aria-hidden="true">·</span>
                      <span>تثبيت مباشر بصيغة APK</span>
                    </div>

                    <div className="flex items-center gap-4">
                      <AppIcon
                        src={featuredApp.iconUrl}
                        alt={featuredApp.name}
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl"
                      />
                      <div className="min-w-0">
                        <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#202124] leading-snug text-balance">
                          {featuredApp.name}
                        </h1>
                        <p className="text-sm text-[#5F6368]">{featuredApp.developer}</p>
                      </div>
                    </div>

                    <p className="text-sm sm:text-base text-[#3C4043] leading-relaxed max-w-xl">
                      {featuredApp.shortDescription}
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-4 text-xs text-[#5F6368] tabular-nums">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#202124]">
                        {featuredApp.averageRating.toFixed(1)}
                        <Star className="w-3.5 h-3.5 fill-[#01875F] text-[#01875F]" />
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatInstalls(featuredApp.downloads)} تثبيت</span>
                      <span aria-hidden="true">·</span>
                      <span dir="ltr">{featuredApp.sizeMB.toFixed(1)} MB</span>
                      <span aria-hidden="true">·</span>
                      <span>{featuredApp.category}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {(() => {
                        const heroDl = getAppDownloadInfo(featuredApp, downloadHistory);
                        const isHeroUpdate = heroDl.status === 'update';
                        const isHeroInstalled = heroDl.status === 'installed';
                        return (
                          <button
                            type="button"
                            onClick={() => void handleQuickInstall(featuredApp)}
                            disabled={quickInstallingId === featuredApp.id}
                            className={`inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold rounded-xl transition-colors whitespace-nowrap disabled:opacity-75 ${
                              isHeroUpdate
                                ? 'bg-[#0B57D0] hover:bg-[#0842A0] text-white'
                                : isHeroInstalled && quickInstalledId !== featuredApp.id
                                ? 'bg-[#E6F4EA] hover:bg-[#D5ECD9] text-[#01875F]'
                                : 'bg-[#01875F] hover:bg-[#016E4D] text-white'
                            }`}
                          >
                            {isHeroUpdate ? (
                              <RefreshCw className="w-4 h-4" />
                            ) : isHeroInstalled && quickInstalledId !== featuredApp.id ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                            <span>
                              {quickInstallingId === featuredApp.id
                                ? 'جاري تجهيز APK...'
                                : quickInstalledId === featuredApp.id
                                ? 'تم بدء التنزيل لنظام Android'
                                : isHeroUpdate
                                ? `تحديث (v${featuredApp.versionName})`
                                : isHeroInstalled
                                ? 'إعادة تنزيل'
                                : 'تنزيل التطبيق'}
                            </span>
                          </button>
                        );
                      })()}

                      <button
                        type="button"
                        onClick={() => openAppDetail(featuredApp.id)}
                        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-medium text-[#202124] bg-white hover:bg-[#F1F3F4] border border-[#DADCE0] rounded-xl transition-colors whitespace-nowrap"
                      >
                        <span>التفاصيل والتقييمات</span>
                        <ArrowUpLeft className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-6 relative min-h-[240px] lg:min-h-full bg-[#E8EAED]">
                  <img
                    src={BUNDLED_HERO_BANNER}
                    alt="استعراض تطبيقات أندرويد المميزة"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover lg:h-full"
                  />
                </div>
              </section>
            )}

            {/* Quick Install Validation Error */}
            {quickInstallError && (
              <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center justify-between gap-3">
                <span>{quickInstallError}</span>
                <button
                  type="button"
                  onClick={() => setQuickInstallError(null)}
                  className="font-semibold underline shrink-0"
                >
                  إغلاق
                </button>
              </div>
            )}

            {/* Catalog Section */}
            <section className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-display text-xl font-bold text-[#202124]">
                  {activeTab === 'top-rated'
                    ? 'التطبيقات الأعلى تقييماً'
                    : activeTab === 'newest'
                    ? 'أحدث التطبيقات المضافة'
                    : selectedCategory === 'الكل'
                    ? 'التطبيقات المقترحة لك'
                    : `تطبيقات ${selectedCategory}`}
                </h2>
                <span className="text-xs text-[#5F6368] tabular-nums">
                  {filteredApps.length} تطبيق
                </span>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="h-44 rounded-2xl bg-[#F8F9FA] border border-[#E8EAED] animate-pulse"
                    />
                  ))}
                </div>
              ) : loadError ? (
                <div className="p-8 text-center border border-[#E8EAED] rounded-2xl space-y-3">
                  <p className="text-sm text-red-600">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchApps()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#01875F] rounded-lg"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : filteredApps.length === 0 ? (
                <div className="p-12 text-center border border-[#E8EAED] rounded-2xl space-y-3">
                  <p className="text-base font-semibold text-[#202124]">
                    لا توجد تطبيقات مطابقة لبحثك
                  </p>
                  <p className="text-sm text-[#5F6368]">
                    جرّب البحث بكلمة أخرى أو ارفع تطبيقك الخاص بصيغة APK الآن.
                  </p>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedCategory('الكل');
                      }}
                      className="px-4 py-2 text-xs font-semibold text-[#01875F] bg-[#E6F4EA] rounded-lg"
                    >
                      عرض جميع التطبيقات
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredApps.map((app) => {
                    const isInstalling = quickInstallingId === app.id;
                    const isInstalledNow = quickInstalledId === app.id;
                    const dlInfo = getAppDownloadInfo(app, downloadHistory);
                    const hasUpdate = dlInfo.status === 'update';
                    const alreadyDownloaded = dlInfo.status === 'installed';

                    return (
                      <article
                        key={app.id}
                        className="group flex flex-col justify-between p-5 bg-white hover:bg-[#F8F9FA] border border-[#E8EAED] hover:border-[#DADCE0] rounded-2xl transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"
                      >
                        <div
                          onClick={() => void openAppDetail(app.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              void openAppDetail(app.id);
                            }
                          }}
                          className="cursor-pointer space-y-4 focus-visible:outline-none"
                        >
                          <div className="flex items-start gap-4">
                            <AppIcon
                              src={app.iconUrl}
                              alt={app.name}
                              className="w-16 h-16 rounded-2xl"
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <h3 className="font-display text-base font-bold text-[#202124] truncate group-hover:text-[#01875F] transition-colors">
                                  {app.name}
                                </h3>
                                {hasUpdate && (
                                  <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#E8F0FE] text-[#0B57D0]">
                                    تحديث متاح
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-[#5F6368] truncate">
                                <span className="truncate">{app.developer}</span>
                                <span aria-hidden="true">·</span>
                                <span className="shrink-0">{app.category}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-[#5F6368] tabular-nums pt-0.5">
                                <span className="inline-flex items-center gap-0.5 font-semibold text-[#202124]">
                                  {app.averageRating > 0 ? app.averageRating.toFixed(1) : 'جديد'}
                                  <Star className="w-3 h-3 fill-[#01875F] text-[#01875F]" />
                                </span>
                                <span aria-hidden="true">·</span>
                                <span dir="ltr">{app.sizeMB.toFixed(1)} MB</span>
                                <span aria-hidden="true">·</span>
                                <span dir="ltr">{formatInstalls(app.downloads)}</span>
                              </div>
                            </div>
                          </div>

                          <p className="text-xs text-[#5F6368] line-clamp-2 leading-relaxed">
                            {app.shortDescription}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t border-[#F1F3F4]">
                          <button
                            type="button"
                            onClick={() => void openAppDetail(app.id)}
                            className="text-xs font-medium text-[#5F6368] hover:text-[#202124] transition-colors"
                          >
                            عرض الصور والمراجعات ({app.reviewCount})
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleQuickInstall(app)}
                            disabled={isInstalling}
                            className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                              isInstalledNow
                                ? 'bg-[#E6F4EA] text-[#01875F]'
                                : hasUpdate
                                ? 'bg-[#0B57D0] hover:bg-[#0842A0] text-white'
                                : alreadyDownloaded
                                ? 'bg-[#E6F4EA] hover:bg-[#D5ECD9] text-[#01875F]'
                                : 'bg-[#01875F] hover:bg-[#016E4D] text-white'
                            }`}
                          >
                            {isInstalledNow ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>تم التنزيل</span>
                              </>
                            ) : isInstalling ? (
                              <span>جاري التجهيز...</span>
                            ) : hasUpdate ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>تحديث</span>
                              </>
                            ) : alreadyDownloaded ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>إعادة تنزيل</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                <span>تنزيل</span>
                              </>
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <footer className="border-t border-[#E8EAED] bg-[#F8F9FA] mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#5F6368]">
          <span>Play55 | متجر تطبيقات بلس — منصة تثبيت ومراجعة تطبيقات أندرويد</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => handleSelectTab('apps')}
              className="hover:text-[#202124] transition-colors"
            >
              تصفح التطبيقات
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab('upload')}
              className="inline-flex items-center gap-1 text-[#01875F] font-semibold hover:underline"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>رفع حزمة APK</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
