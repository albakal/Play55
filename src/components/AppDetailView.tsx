import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  Link2,
  QrCode,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Star,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import type { DeveloperSessionUser, ReviewItem, StoreApp } from '../types.ts';
import { resolveAssetUrl } from '../catalog/fallbackStore.ts';
import { auth, cloudDeleteApp, cloudSubmitReview } from '../firebase.ts';
import {
  localBuildOrFetchApkBlob,
  localDeleteApp,
  localHasStoredApkBlob,
  localIncrementInstall,
  localSubmitReview,
  localVerifyApkBlob,
  localVoteHelpful,
} from '../utils/localStoreEngine.ts';
import {
  getAppDownloadInfo,
  getDownloadedAppsMap,
  INSTALL_HISTORY_EVENT,
  recordAppDownload,
} from '../utils/installHistory.ts';
import type { DownloadedAppRecord } from '../utils/installHistory.ts';
import { buildPermanentAppShareUrl } from '../utils/shareLink.ts';
import { AppIcon } from './AppIcon.tsx';
import { StarRating } from './StarRating.tsx';

interface AppDetailViewProps {
  app: StoreApp;
  reviews: ReviewItem[];
  currentUser: DeveloperSessionUser | null;
  getAuthToken: () => Promise<string | null>;
  onBack: () => void;
  onEditApp: (app: StoreApp) => void;
  onAppUpdated: (updatedApp: StoreApp, updatedReviews?: ReviewItem[]) => void;
  onAppDeleted: (appId: string) => void;
}

function formatInstalls(count: number): string {
  if (count >= 1_000_000) return `+${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `+${Math.round(count / 1_000)}K`;
  return `${count}`;
}

function formatArabicDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function AppDetailView({
  app,
  reviews,
  currentUser,
  getAuthToken,
  onBack,
  onEditApp,
  onAppUpdated,
  onAppDeleted,
}: AppDetailViewProps) {
  const [installPhase, setInstallPhase] = useState<'idle' | 'verifying' | 'handoff' | 'error'>('idle');
  const [installProgress, setInstallProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);
  const [apkCheckInfo, setApkCheckInfo] = useState<{
    isBinaryManifest: boolean;
    isSignedApk: boolean;
    signatureScheme?: string | null;
    signerCertSha256?: string | null;
    sha256?: string | null;
    externalApkUrl?: string | null;
    viaBlob?: boolean;
  } | null>(null);
  const [downloadHistory, setDownloadHistory] = useState<Record<string, DownloadedAppRecord>>(() =>
    getDownloadedAppsMap()
  );
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedShare, setCopiedShare] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Review form state
  const [ratingInput, setRatingInput] = useState<number>(5);
  const [authorInput, setAuthorInput] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [helpfulVoted, setHelpfulVoted] = useState<Record<string, boolean>>({});

  const permanentAppUrl = buildPermanentAppShareUrl(app);

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
    setInstallPhase('idle');
    setInstallProgress(0);
    setInstallError(null);
    setApkCheckInfo(null);
    setShowQrPanel(false);
    setConfirmDelete(false);
    setReviewError(null);
    setReviewSuccess(false);
  }, [app.id]);

  useEffect(() => {
    if (!showQrPanel) return;
    let cancelled = false;
    (async () => {
      let qrTarget = permanentAppUrl;
      try {
        const res = await fetch('./api/health');
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          qrTarget = `${window.location.origin}/api/apps/${encodeURIComponent(app.id)}/install-apk`;
        }
      } catch {
        // Static fallback URL already selected
      }
      if (cancelled) return;
      QRCode.toDataURL(qrTarget, {
        width: 220,
        margin: 2,
        color: { dark: '#202124', light: '#FFFFFF' },
      })
        .then((url) => {
          if (!cancelled) setQrDataUrl(url);
        })
        .catch(() => {
          if (!cancelled) setQrDataUrl('');
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [showQrPanel, app.id, permanentAppUrl]);

  const handleDirectInstall = async () => {
    if (installPhase === 'verifying') return;
    setInstallPhase('verifying');
    setInstallError(null);
    setInstallProgress(20);

    let backendOnline = false;
    let verified = false;

    let resolvedExternalUrl: string | null = null;
    let resolvedSha256: string | null = app.apkSha256 || null;

    try {
      const verifyRes = await fetch(`./api/apps/${encodeURIComponent(app.id)}/verify-apk`);
      const ct = verifyRes.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        backendOnline = true;
        if (!verifyRes.ok) {
          setInstallPhase('error');
          setInstallError('تعذر العثور على حزمة APK الخاصة بهذا التطبيق.');
          return;
        }
        const vData = (await verifyRes.json()) as {
          valid: boolean;
          isBinaryManifest: boolean;
          isSignedApk: boolean;
          signatureScheme?: string | null;
          signerCertSha256?: string | null;
          sha256?: string | null;
          externalApkUrl?: string | null;
          hasCustomApk?: boolean;
        };
        if (!vData.valid) {
          setInstallPhase('error');
          setInstallError('ملف APK تالف أو غير مكتمل، تم إيقاف التثبيت لحماية جهازك.');
          return;
        }
        resolvedExternalUrl = !vData.hasCustomApk && vData.externalApkUrl ? vData.externalApkUrl : null;
        resolvedSha256 = vData.sha256 || app.apkSha256 || null;
        setApkCheckInfo({
          isBinaryManifest: Boolean(vData.isBinaryManifest),
          isSignedApk: Boolean(vData.isSignedApk),
          signatureScheme: vData.signatureScheme || app.signatureScheme || null,
          signerCertSha256: vData.signerCertSha256 || app.signerCertSha256 || null,
          sha256: resolvedSha256,
          externalApkUrl: vData.externalApkUrl || app.externalApkUrl || null,
          viaBlob: false,
        });
        verified = true;
      }
    } catch {
      backendOnline = false;
    }

    if (!backendOnline) {
      const hasLocalBlob = await localHasStoredApkBlob(app.id);
      const safeExternal =
        app.externalApkUrl && /^https:\/\/[^\s@]+$/.test(app.externalApkUrl)
          ? app.externalApkUrl
          : null;
      if (app.hasCustomApk && !safeExternal && !hasLocalBlob) {
        setInstallPhase('error');
        setInstallError(
          'تعذر العثور على حزمة APK على الخادم؛ هذا التطبيق منشور من جهاز آخر على الاستضافة الثابتة دون رابط HTTPS مباشر. يرجى من المطور إضافة رابط تنزيل APK مباشر (HTTPS) أو النشر عبر خادم Play55 الكامل.'
        );
        return;
      }
      const localCheck = await localVerifyApkBlob(app);
      if (!localCheck.valid) {
        setInstallPhase('error');
        setInstallError('ملف APK تالف أو غير مكتمل، يرجى من المطور إعادة رفع حزمة صالحة.');
        return;
      }
      resolvedExternalUrl = localCheck.externalApkUrl || safeExternal || null;
      resolvedSha256 = localCheck.sha256 || app.apkSha256 || null;
      setApkCheckInfo({
        isBinaryManifest: localCheck.isBinaryManifest,
        isSignedApk: localCheck.isSignedApk,
        signatureScheme: localCheck.signatureScheme || app.signatureScheme || null,
        signerCertSha256: app.signerCertSha256 || null,
        sha256: resolvedSha256,
        externalApkUrl: resolvedExternalUrl,
        viaBlob: !resolvedExternalUrl,
      });
      verified = true;
    }

    if (!verified) {
      setInstallPhase('error');
      setInstallError('تعذر التحقق من سلامة ملف APK.');
      return;
    }

    setInstallProgress(65);

    if (backendOnline) {
      try {
        const res = await fetch(`./api/apps/${encodeURIComponent(app.id)}/install`, {
          method: 'POST',
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = (await res.json()) as { downloads: number };
          onAppUpdated({ ...app, downloads: data.downloads });
        }
      } catch {
        // Non-blocking counter update
      }
    } else {
      const nextDownloads = await localIncrementInstall(app).catch(() => app.downloads + 1);
      onAppUpdated({ ...app, downloads: nextDownloads });
    }

    let localApkBlob: Blob | null = null;
    if (!backendOnline && !resolvedExternalUrl) {
      localApkBlob = await localBuildOrFetchApkBlob(app);
    }

    setInstallProgress(100);
    setInstallPhase('handoff');

    if (resolvedExternalUrl) {
      const link = document.createElement('a');
      link.href = resolvedExternalUrl;
      link.setAttribute('download', `${app.packageName}-v${app.versionName}.apk`);
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (backendOnline) {
      const installEndpoint = `./api/apps/${encodeURIComponent(app.id)}/install-apk`;
      const link = document.createElement('a');
      link.href = installEndpoint;
      link.setAttribute('download', `${app.packageName}-v${app.versionName}.apk`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (localApkBlob) {
      const blobUrl = URL.createObjectURL(localApkBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `${app.packageName}-v${app.versionName}.apk`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    }

    recordAppDownload(app, resolvedSha256);

    const isAndroid = /android/i.test(navigator.userAgent);
    if (!isAndroid) {
      setShowQrPanel(true);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(permanentAppUrl);
      setCopiedShare(true);
      window.setTimeout(() => setCopiedShare(false), 2500);
    } catch {
      setCopiedShare(false);
    }
  };

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setReviewError(null);
    setReviewSuccess(false);

    if (authorInput.trim().length < 2) {
      setReviewError('يرجى كتابة اسمك لعرضه بجانب المراجعة.');
      return;
    }
    if (commentInput.trim().length < 4) {
      setReviewError('يرجى كتابة تعليق لا يقل عن 4 أحرف.');
      return;
    }

    const saveReviewFallback = async () => {
      if (auth.currentUser?.emailVerified) {
        const cloudSaved = await cloudSubmitReview({
          app,
          authorName: authorInput.trim(),
          rating: ratingInput,
          comment: commentInput.trim(),
          existingReviews: reviews,
        }).catch(() => null);
        if (cloudSaved) {
          onAppUpdated(cloudSaved.app, [cloudSaved.review, ...reviews]);
          return;
        }
      }
      const localSaved = await localSubmitReview({
        app,
        authorName: authorInput.trim(),
        rating: ratingInput,
        comment: commentInput.trim(),
      });
      onAppUpdated(localSaved.app, [localSaved.review, ...reviews]);
    };

    setSubmittingReview(true);
    try {
      const res = await fetch(`./api/apps/${encodeURIComponent(app.id)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: authorInput.trim(),
          rating: ratingInput,
          comment: commentInput.trim(),
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json') || res.status === 405) {
        await saveReviewFallback();
        setAuthorInput('');
        setCommentInput('');
        setRatingInput(5);
        setReviewSuccess(true);
        return;
      }

      const payload = (await res.json()) as {
        error?: string;
        review?: ReviewItem;
        app?: StoreApp;
      };

      if (!res.ok || !payload.review || !payload.app) {
        setReviewError(payload.error || 'تعذر حفظ المراجعة، يرجى المحاولة مجدداً.');
        return;
      }

      onAppUpdated(payload.app, [payload.review, ...reviews]);
      setAuthorInput('');
      setCommentInput('');
      setRatingInput(5);
      setReviewSuccess(true);
    } catch {
      try {
        await saveReviewFallback();
        setAuthorInput('');
        setCommentInput('');
        setRatingInput(5);
        setReviewSuccess(true);
      } catch {
        setReviewError('تعذر حفظ المراجعة، يرجى المحاولة مجدداً.');
      }
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleHelpful = async (reviewId: string) => {
    if (helpfulVoted[reviewId]) return;
    setHelpfulVoted((prev) => ({ ...prev, [reviewId]: true }));
    const targetReview = reviews.find((r) => r.id === reviewId);
    try {
      const res = await fetch(
        `./api/apps/${encodeURIComponent(app.id)}/reviews/${encodeURIComponent(reviewId)}/helpful`,
        { method: 'POST' }
      );
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as { helpfulCount: number };
        const updated = reviews.map((r) =>
          r.id === reviewId ? { ...r, helpfulCount: data.helpfulCount } : r
        );
        onAppUpdated(app, updated);
        return;
      }
    } catch {
      // Fallback below
    }
    const nextCount = await localVoteHelpful(reviewId, targetReview?.helpfulCount ?? 0).catch(
      () => (targetReview?.helpfulCount ?? 0) + 1
    );
    const updated = reviews.map((r) =>
      r.id === reviewId ? { ...r, helpfulCount: nextCount } : r
    );
    onAppUpdated(app, updated);
  };

  const handleDeleteApp = async () => {
    if (!currentUser) return;
    let deletedAnywhere = false;
    try {
      const token = await getAuthToken();
      const headers: Record<string, string> = {
        'X-Requested-With': 'Play55',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(`./api/apps/${encodeURIComponent(app.id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        deletedAnywhere = true;
      }
    } catch {
      // Backend unavailable
    }

    const deletedCloud = await cloudDeleteApp(app.id).catch(() => false);
    const deletedLocal = await localDeleteApp(app.id, currentUser.uid).catch(() => false);
    if (deletedAnywhere || deletedCloud || deletedLocal) {
      onAppDeleted(app.id);
    }
  };

  const totalDist = Math.max(app.reviewCount, 1);
  const downloadInfo = getAppDownloadInfo(app, downloadHistory);
  const hasNewUpdate = downloadInfo.status === 'update';
  const alreadyInstalledLatest = downloadInfo.status === 'installed';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      {/* Back navigation */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#5F6368] hover:text-[#202124] transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة إلى واجهة المتجر</span>
        </button>

        {currentUser && app.ownerUid === currentUser.uid && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onEditApp(app)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#01875F] bg-[#E6F4EA] hover:bg-[#D5ECD9] transition-colors px-3 py-1.5 rounded-lg"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>تحديث الإصدار</span>
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5F6368] hover:text-red-600 transition-colors px-3 py-1.5 rounded-lg border border-[#E8EAED]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف التطبيق</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeleteApp}
                  className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg transition-colors"
                >
                  تأكيد الحذف
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs font-medium text-[#5F6368] px-2 py-1.5"
                >
                  إلغاء
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* App Header Module */}
      <section className="flex flex-col lg:flex-row lg:items-start justify-between gap-8 pb-8 border-b border-[#E8EAED]">
        <div className="flex items-start gap-5 sm:gap-7">
          <AppIcon
            src={app.iconUrl}
            alt={app.name}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl"
          />
          <div className="space-y-2 min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#202124] leading-tight">
              {app.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-[#01875F]">{app.developer}</span>
              <span aria-hidden="true" className="text-[#DADCE0]">
                ·
              </span>
              <span className="text-[#5F6368]">{app.category}</span>
              <span aria-hidden="true" className="text-[#DADCE0]">
                ·
              </span>
              <span className="font-mono text-xs text-[#202124] bg-[#F1F3F4] px-2 py-0.5 rounded-md" dir="ltr">
                v{app.versionName}
              </span>
              <span className="font-mono text-xs text-[#5F6368]" dir="ltr">
                {app.packageName}
              </span>
            </div>
            <p className="text-sm text-[#5F6368] max-w-2xl leading-relaxed pt-1">
              {app.shortDescription}
            </p>
          </div>
        </div>

        {/* Direct Install & Share Action Column */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-3 shrink-0 lg:min-w-[270px]">
          <button
            type="button"
            onClick={handleDirectInstall}
            disabled={installPhase === 'verifying'}
            className={`w-full inline-flex items-center justify-center gap-2.5 px-7 py-3.5 text-sm font-semibold rounded-xl transition-colors shadow-xs disabled:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 ${
              hasNewUpdate
                ? 'bg-[#0B57D0] hover:bg-[#0842A0] text-white focus-visible:outline-[#0B57D0]'
                : alreadyInstalledLatest && installPhase !== 'handoff'
                ? 'bg-[#E6F4EA] hover:bg-[#D5ECD9] text-[#01875F] border border-[#01875F]/25 focus-visible:outline-[#01875F]'
                : 'bg-[#01875F] hover:bg-[#016E4D] text-white focus-visible:outline-[#01875F]'
            }`}
          >
            {installPhase === 'verifying' ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span className="tabular-nums">جاري فحص ملف APK ({installProgress}%)</span>
              </>
            ) : installPhase === 'handoff' ? (
              <>
                {hasNewUpdate ? <RefreshCw className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                <span>تنزيل حزمة APK مجدداً</span>
              </>
            ) : hasNewUpdate ? (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>تحديث (v{app.versionName})</span>
              </>
            ) : alreadyInstalledLatest ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>تم التنزيل — إعادة تنزيل</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>تنزيل التطبيق</span>
              </>
            )}
          </button>

          {hasNewUpdate && downloadInfo.previousRecord && (
            <p className="text-[11px] font-medium text-[#0B57D0] bg-[#E8F0FE] border border-[#0B57D0]/20 rounded-lg px-3 py-1.5 w-full text-center">
              يتوفر تحديث جديد منذ آخر تنزيل لك: لديك{' '}
              <span dir="ltr" className="font-mono font-bold">v{downloadInfo.previousRecord.versionName}</span>
              {' ← '}
              <span dir="ltr" className="font-mono font-bold">v{app.versionName}</span>
            </p>
          )}

          <div className="flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={() => setShowQrPanel((prev) => !prev)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-[#202124] bg-[#F8F9FA] hover:bg-[#F1F3F4] border border-[#E8EAED] rounded-xl transition-colors whitespace-nowrap"
            >
              <QrCode className="w-4 h-4 text-[#01875F]" />
              <span>تثبيت على الجوال (QR)</span>
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-[#202124] bg-[#F8F9FA] hover:bg-[#F1F3F4] border border-[#E8EAED] rounded-xl transition-colors whitespace-nowrap"
            >
              <Share2 className="w-4 h-4 text-[#5F6368]" />
              <span>{copiedShare ? 'تم النسخ' : 'نسخ الرابط'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Permanent Independent App Link Bar */}
      <section className="p-4 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link2 className="w-4 h-4 text-[#01875F] shrink-0" />
          <span className="text-xs font-semibold text-[#202124] shrink-0">الرابط المباشر الدائم للتطبيق:</span>
          <code className="text-xs font-mono text-[#5F6368] truncate" dir="ltr">
            {permanentAppUrl}
          </code>
        </div>
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#01875F] bg-white border border-[#DADCE0] hover:bg-[#F1F3F4] rounded-lg transition-colors shrink-0"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>{copiedShare ? 'تم نسخ الرابط الدائم' : 'نسخ الرابط'}</span>
        </button>
      </section>

      {/* Install Error Banner */}
      {installPhase === 'error' && installError && (
        <section className="p-5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-red-800">تعذر متابعة تثبيت الحزمة</h3>
            <p className="text-xs text-red-700 leading-relaxed">{installError}</p>
          </div>
        </section>
      )}

      {/* Install Progress, Android Official Installer Guide & QR Phone Handoff Notice */}
      {(installPhase === 'verifying' || installPhase === 'handoff' || showQrPanel) && (
        <section className="p-5 sm:p-6 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-3 flex-1">
            <div className="flex items-center gap-3">
              <AppIcon
                src={app.iconUrl}
                alt={app.name}
                className="w-10 h-10 rounded-xl shrink-0"
              />
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#202124]">
                  <ShieldCheck className="w-4 h-4 text-[#01875F] shrink-0" />
                  <span>
                    {installPhase === 'handoff'
                      ? `تم فحص ملف APK وتجهيزه لفتح مُثبّت Android الرسمي — ${app.name} (v${app.versionName})`
                      : installPhase === 'verifying'
                      ? `جاري فحص سلامة ملف APK الخاص بتطبيق ${app.name}...`
                      : `التثبيت المباشر لتطبيق ${app.name} (v${app.versionName})`}
                  </span>
                </div>
                {apkCheckInfo && (
                  <div className="space-y-0.5 mt-1">
                    <p className="text-xs text-[#01875F] font-medium">
                      تم التحقق من سلامة بنية APK بنجاح
                      {apkCheckInfo.isSignedApk
                        ? ` · حزمة موقّعة رقمياً (${apkCheckInfo.signatureScheme || 'APK Signature'})`
                        : ' · تنبيه: لم يُرصد توقيع رقمي داخل الحزمة'}
                    </p>
                    {apkCheckInfo.sha256 && (
                      <p className="text-[11px] font-mono text-[#5F6368] break-all" dir="ltr">
                        SHA-256: {apkCheckInfo.sha256}
                      </p>
                    )}
                    {apkCheckInfo.signerCertSha256 && (
                      <p className="text-[11px] font-mono text-[#5F6368] break-all" dir="ltr">
                        Signer Cert SHA-256: {apkCheckInfo.signerCertSha256}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {installPhase === 'verifying' && (
              <div className="w-full max-w-md h-2 bg-[#E8EAED] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#01875F] transition-all duration-150"
                  style={{ width: `${installProgress}%` }}
                />
              </div>
            )}

            <div className="p-3.5 bg-white border border-[#E8EAED] rounded-xl space-y-2 text-xs text-[#3C4043] leading-relaxed">
              <p className="font-semibold text-[#202124]">
                خطوات إكمال التثبيت على هاتف Android بأمان:
              </p>
              <ol className="list-decimal list-inside space-y-1 text-[#5F6368]">
                <li>
                  عند ظهور رسالة متصفح Chrome المعتادة («قد يكون هذا الملف ضارًا»)، فهذا تنبيه أمني عام يظهر تلقائياً لجميع ملفات <span dir="ltr" className="font-mono">.apk</span> المنزّلة من خارج Google Play عندما تكون الحزمة جديدة في قاعدة سمعة Safe Browsing؛ اختر <strong>«التنزيل على أي حال»</strong> للمتابعة إذا كنت تثق بالمطور.
                </li>
                <li>
                  عند اكتمال التنزيل، اضغط على <strong>«فتح»</strong> لتشغيل واجهة مُثبّت حزم Android الرسمية.
                </li>
                <li>
                  إذا طلب النظام إذن التثبيت من مصادر خارجية، اختر <strong>«الإعدادات»</strong> ← فعّل <strong>«السماح من هذا المصدر»</strong> للمتصفح، ثم ارجع واضغط <strong>«تثبيت»</strong>.
                </li>
              </ol>
              {apkCheckInfo?.viaBlob && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  ملاحظة الاستضافة: يتم التنزيل حالياً من ذاكرة المتصفح المحلية على الاستضافة الثابتة؛ للحصول على رابط HTTPS مباشر عابر للأجهزة وتقليل تحذيرات التنزيل، يُنصح برفع التطبيق عبر خادم Play55 الكامل أو إضافة رابط توزيع HTTPS موثوق.
                </p>
              )}
            </div>
          </div>

          {showQrPanel && qrDataUrl && (
            <div className="flex flex-col items-center gap-2 p-3 bg-white border border-[#E8EAED] rounded-xl shrink-0">
              <img
                src={qrDataUrl}
                alt={`رمز QR لتثبيت ${app.name}`}
                className="w-36 h-36"
              />
              <span className="text-xs text-[#5F6368] inline-flex items-center gap-1">
                <Smartphone className="w-3.5 h-3.5 text-[#01875F]" />
                <span>امسح من هاتفك للتثبيت</span>
              </span>
            </div>
          )}
        </section>
      )}

      {/* 4-Column Storefront Metrics Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-4 border border-[#E8EAED] rounded-2xl divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-[#E8EAED] bg-white">
        <div className="p-4 sm:p-5 text-center space-y-1">
          <div className="flex items-center justify-center gap-1 text-lg font-bold text-[#202124] tabular-nums">
            <span>{app.averageRating > 0 ? app.averageRating.toFixed(1) : 'جديد'}</span>
            <Star className="w-4 h-4 fill-[#01875F] text-[#01875F]" />
          </div>
          <p className="text-xs text-[#5F6368] tabular-nums">{app.reviewCount} مراجعة</p>
        </div>

        <div className="p-4 sm:p-5 text-center space-y-1">
          <div className="text-lg font-bold text-[#202124] tabular-nums" dir="ltr">
            {app.sizeMB.toFixed(1)} MB
          </div>
          <p className="text-xs text-[#5F6368]">حجم حزمة APK</p>
        </div>

        <div className="p-4 sm:p-5 text-center space-y-1">
          <div className="text-lg font-bold text-[#202124] tabular-nums" dir="ltr">
            {formatInstalls(app.downloads)}
          </div>
          <p className="text-xs text-[#5F6368]">عملية تثبيت</p>
        </div>

        <div className="p-4 sm:p-5 text-center space-y-1">
          <div className="text-lg font-bold text-[#202124] tabular-nums" dir="ltr">
            {app.ageRating}
          </div>
          <p className="text-xs text-[#5F6368]">التصنيف العمري</p>
        </div>
      </section>

      {/* Promotional Screenshots Gallery */}
      {app.screenshots.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-lg font-bold text-[#202124]">
            الصور الترويجية للتطبيق
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            {app.screenshots.map((shot, idx) => {
              const resolvedShot = resolveAssetUrl(shot);
              return (
                <button
                  key={`${shot}-${idx}`}
                  type="button"
                  onClick={() => setLightboxImage(resolvedShot)}
                  className="group relative shrink-0 w-72 sm:w-96 aspect-video rounded-2xl overflow-hidden border border-[#E8EAED] bg-[#F8F9FA] focus-visible:outline-2 focus-visible:outline-[#01875F]"
                >
                  <img
                    src={resolvedShot}
                    alt={`صورة ترويجية ${idx + 1} لتطبيق ${app.name}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                  />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* About This App & Technical Specs */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-2">
        <div className="lg:col-span-2 space-y-5">
          <h2 className="font-display text-lg font-bold text-[#202124]">حول هذا التطبيق</h2>
          <p className="text-[15px] text-[#3C4043] leading-[1.8] whitespace-pre-line">
            {app.fullDescription}
          </p>

          {app.whatsNew && (
            <div className="p-5 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl space-y-2">
              <h3 className="text-sm font-bold text-[#202124]">ما الجديد في الإصدار {app.versionName}</h3>
              <p className="text-sm text-[#5F6368] leading-relaxed">{app.whatsNew}</p>
            </div>
          )}
        </div>

        <aside className="p-5 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl space-y-4 h-fit">
          <h3 className="font-display text-base font-bold text-[#202124]">المواصفات التقنية للحزمة</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4 py-1.5 border-b border-[#E8EAED]">
              <dt className="text-[#5F6368]">رقم الإصدار</dt>
              <dd className="font-mono text-xs text-[#202124] tabular-nums" dir="ltr">
                {app.versionName} ({app.versionCode})
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-1.5 border-b border-[#E8EAED]">
              <dt className="text-[#5F6368]">يتطلب أندرويد</dt>
              <dd className="font-mono text-xs text-[#202124]" dir="ltr">
                {app.minAndroid}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-1.5 border-b border-[#E8EAED]">
              <dt className="text-[#5F6368]">معرف الحزمة</dt>
              <dd className="font-mono text-xs text-[#202124] truncate max-w-[160px]" dir="ltr">
                {app.packageName}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-1.5 border-b border-[#E8EAED]">
              <dt className="text-[#5F6368]">الأذونات المطلوبة</dt>
              <dd className="text-[#202124] tabular-nums">
                {app.permissionsCount > 0 ? `${app.permissionsCount} أذونات` : 'قياسية'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-1.5 border-b border-[#E8EAED]">
              <dt className="text-[#5F6368]">حالة التوقيع</dt>
              <dd className={app.isSignedApk ? 'text-[#01875F] font-semibold text-xs' : 'text-[#5F6368] text-xs'}>
                {app.isSignedApk
                  ? `موقّعة رقمياً (${app.signatureScheme || 'APK'})`
                  : 'موقّعة عند التنزيل (v1)'}
              </dd>
            </div>
            {app.signerCertSha256 && (
              <div className="py-1.5 border-b border-[#E8EAED] space-y-1">
                <dt className="text-[#5F6368]">بصمة شهادة التوقيع</dt>
                <dd className="font-mono text-[11px] text-[#202124] break-all" dir="ltr">
                  {app.signerCertSha256}
                </dd>
              </div>
            )}
            {app.apkSha256 && (
              <div className="py-1.5 border-b border-[#E8EAED] space-y-1">
                <dt className="text-[#5F6368]">بصمة التحقق (SHA-256)</dt>
                <dd className="font-mono text-[11px] text-[#202124] break-all" dir="ltr">
                  {app.apkSha256}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 py-1.5">
              <dt className="text-[#5F6368]">آخر تحديث</dt>
              <dd className="text-[#202124]">{formatArabicDate(app.updatedAt)}</dd>
            </div>
          </dl>
        </aside>
      </section>

      {/* Ratings & Reviews Section */}
      <section className="pt-8 border-t border-[#E8EAED] space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-[#202124]">التقييمات والمراجعات</h2>
          <span className="text-xs text-[#5F6368]">آراء المستخدمين الموثقة حول التجربة الفعلية</span>
        </div>

        {/* Summary Score + 5-Bar Distribution */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-4 flex flex-col items-start gap-2">
            <div className="text-5xl font-bold text-[#202124] tabular-nums">
              {app.averageRating > 0 ? app.averageRating.toFixed(1) : '0.0'}
            </div>
            <StarRating rating={app.averageRating} size="md" />
            <p className="text-xs text-[#5F6368] tabular-nums">
              بناءً على {app.reviewCount} تقييم ومراجعة
            </p>
          </div>

          <div className="md:col-span-8 space-y-2">
            {([5, 4, 3, 2, 1] as const).map((starLevel) => {
              const count = app.ratingDistribution[starLevel] || 0;
              const pct = app.reviewCount > 0 ? Math.round((count / totalDist) * 100) : 0;
              return (
                <div key={starLevel} className="flex items-center gap-3 text-xs">
                  <span className="w-4 font-semibold text-[#202124] tabular-nums">{starLevel}</span>
                  <div className="flex-1 h-2.5 bg-[#F1F3F4] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#01875F] rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-10 text-left text-[#5F6368] tabular-nums">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Write a Review Card */}
        <form
          onSubmit={handleReviewSubmit}
          className="p-6 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-[#202124]">أضف تقييمك وتعليقك</h3>
              <p className="text-xs text-[#5F6368]">شارك تجربتك مع التطبيق لمساعدة الآخرين</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#5F6368]">تقييمك:</span>
              <StarRating
                rating={ratingInput}
                size="lg"
                interactive
                onChange={setRatingInput}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label htmlFor="reviewer-name" className="block text-xs font-medium text-[#3C4043] mb-1.5">
                الاسم
              </label>
              <input
                id="reviewer-name"
                type="text"
                value={authorInput}
                onChange={(e) => setAuthorInput(e.target.value)}
                placeholder="مثال: محمد العلي"
                maxLength={60}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="reviewer-comment" className="block text-xs font-medium text-[#3C4043] mb-1.5">
                تعليقك على التطبيق
              </label>
              <textarea
                id="reviewer-comment"
                rows={2}
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                placeholder="اكتب رأيك في الأداء، التصميم، وسرعة التثبيت..."
                maxLength={1200}
                className="w-full px-3.5 py-2 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F] resize-none"
              />
            </div>
          </div>

          {reviewError && <p className="text-xs text-red-600 font-medium">{reviewError}</p>}
          {reviewSuccess && (
            <p className="text-xs text-[#01875F] font-medium">
              تم نشر تقييمك ومراجعتك بنجاح!
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submittingReview}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] disabled:opacity-60 rounded-xl transition-colors"
            >
              {submittingReview ? 'جاري النشر...' : 'نشر المراجعة'}
            </button>
          </div>
        </form>

        {/* Reviews Feed */}
        <div className="divide-y divide-[#E8EAED]">
          {reviews.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#5F6368]">
              لا توجد مراجعات حتى الآن. كن أول من يقيّم هذا التطبيق!
            </p>
          ) : (
            reviews.map((review) => (
              <article key={review.id} className="py-6 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#01875F]/10 text-[#01875F] font-bold text-sm flex items-center justify-center shrink-0">
                      {review.authorName.trim().charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[#202124]">
                        {review.authorName}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#5F6368]">
                        <StarRating rating={review.rating} size="sm" />
                        <span aria-hidden="true">·</span>
                        <span>{formatArabicDate(review.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-[#3C4043] leading-relaxed">{review.comment}</p>

                <div className="flex items-center gap-4 pt-1">
                  <button
                    type="button"
                    onClick={() => handleHelpful(review.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      helpfulVoted[review.id]
                        ? 'bg-[#01875F]/10 border-[#01875F]/30 text-[#01875F] font-medium'
                        : 'bg-white border-[#E8EAED] text-[#5F6368] hover:bg-[#F8F9FA]'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span className="tabular-nums">
                      مفيد ({review.helpfulCount})
                    </span>
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* Lightbox Modal for Promotional Images */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="إغلاق الصورة"
              className="absolute top-3 left-3 z-10 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={lightboxImage}
              alt="معاينة الصورة الترويجية"
              referrerPolicy="no-referrer"
              className="w-full max-h-[82vh] object-contain bg-[#111]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
