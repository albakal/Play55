import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  ArrowUpLeft,
  CheckCircle2,
  Download,
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
  localGetAppDetail,
  localIncrementInstall,
  localListApps,
  localLoginDeveloper,
  localRegisterDeveloper,
} from './utils/localStoreEngine.ts';
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

  const [selectedAppId, setSelectedAppId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('app');
  });
  const [detailData, setDetailData] = useState<AppDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [quickInstallingId, setQuickInstallingId] = useState<string | null>(null);
  const [quickInstalledId, setQuickInstalledId] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<DeveloperSessionUser | null>(null);
  const [manualToken, setManualToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
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
      } else {
        setCurrentUser((prev) => (prev?.provider === 'manual' ? prev : null));
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: params.name,
          email: params.email,
          password: params.password,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json') || res.status === 405) {
        // Static hosting fallback (e.g. GitHub Pages): use client-side Web Crypto + IndexedDB
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
        setManualToken(localResult.token);
        setCurrentUser(localResult.user);
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
    } catch (err) {
      if (err instanceof Error && err.message && !err.message.includes('Failed to fetch')) {
        setAuthError(err.message);
        return;
      }
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
        setManualToken(localResult.token);
        setCurrentUser(localResult.user);
      } catch (localErr) {
        setAuthError(
          localErr instanceof Error
            ? localErr.message
            : 'تعذر إنشاء الحساب أو تسجيل الدخول، يرجى المحاولة مرة أخرى.'
        );
      }
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

  const fetchApps = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const sort: 'popular' | 'rating' | 'newest' =
      activeTab === 'top-rated' ? 'rating' : activeTab === 'newest' ? 'newest' : 'popular';
    try {
      const res = await fetch(`./api/apps?sort=${encodeURIComponent(sort)}`);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error('Static fallback');
      }
      const data = (await res.json()) as { apps: StoreApp[] };
      setApps(data.apps);
    } catch {
      try {
        const localApps = await localListApps(sort);
        setApps(localApps);
      } catch {
        const sorted = [...FALLBACK_APPS];
        if (sort === 'rating') {
          sorted.sort((a, b) => b.averageRating - a.averageRating);
        } else if (sort === 'newest') {
          sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else {
          sorted.sort((a, b) => b.downloads - a.downloads);
        }
        setApps(sorted);
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'upload') {
      void fetchApps();
    }
  }, [activeTab, fetchApps]);

  const openAppDetail = useCallback(async (appId: string) => {
    setSelectedAppId(appId);
    setLoadingDetail(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const res = await fetch(`./api/apps/${encodeURIComponent(appId)}`);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        const localDetail = await localGetAppDetail(appId);
        if (localDetail) {
          setDetailData(localDetail);
          return;
        }
        setSelectedAppId(null);
        setDetailData(null);
        return;
      }
      const data = (await res.json()) as AppDetailResponse;
      setDetailData(data);
    } catch {
      const localDetail = await localGetAppDetail(appId);
      if (localDetail) {
        setDetailData(localDetail);
      } else {
        setDetailData(null);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAppId && !detailData) {
      void openAppDetail(selectedAppId);
    }
  }, [selectedAppId, detailData, openAppDetail]);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setSelectedAppId(null);
    setDetailData(null);
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
    let backendOnline = false;
    try {
      const res = await fetch(`./api/apps/${encodeURIComponent(app.id)}/install`, {
        method: 'POST',
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        backendOnline = true;
        const data = (await res.json()) as { downloads: number };
        setApps((prev) =>
          prev.map((a) => (a.id === app.id ? { ...a, downloads: data.downloads } : a))
        );
      }
    } catch {
      backendOnline = false;
    }

    if (backendOnline) {
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

    window.setTimeout(() => {
      setQuickInstallingId(null);
      setQuickInstalledId(app.id);
      window.setTimeout(() => setQuickInstalledId(null), 3000);
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
  };

  const handlePublished = (newApp: StoreApp) => {
    setApps((prev) => [newApp, ...prev]);
    setActiveTab('apps');
    void openAppDetail(newApp.id);
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
            authLoading={authLoading}
            authError={authError}
            onManualAuth={handleManualAuth}
            onGoogleSignIn={handleGoogleSignIn}
            onSignOut={handleSignOut}
            getAuthToken={getAuthToken}
            onBack={() => handleSelectTab('apps')}
            onPublished={handlePublished}
          />
        ) : selectedAppId ? (
          loadingDetail || !detailData ? (
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
              }}
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
                      <button
                        type="button"
                        onClick={() => handleQuickInstall(featuredApp)}
                        className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] rounded-xl transition-colors whitespace-nowrap"
                      >
                        <Download className="w-4 h-4" />
                        <span>
                          {quickInstalledId === featuredApp.id
                            ? 'تم إرسال الحزمة للتثبيت'
                            : 'تثبيت مباشر'}
                        </span>
                      </button>

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
                    const isInstalled = quickInstalledId === app.id;

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
                              <h3 className="font-display text-base font-bold text-[#202124] truncate group-hover:text-[#01875F] transition-colors">
                                {app.name}
                              </h3>
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
                              isInstalled
                                ? 'bg-[#E6F4EA] text-[#01875F]'
                                : 'bg-[#01875F] hover:bg-[#016E4D] text-white'
                            }`}
                          >
                            {isInstalled ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>تم الإرسال</span>
                              </>
                            ) : isInstalling ? (
                              <span>جاري التثبيت...</span>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                <span>تثبيت</span>
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
          <span>متجر تطبيقات بلس — منصة تثبيت ومراجعة تطبيقات أندرويد</span>
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
