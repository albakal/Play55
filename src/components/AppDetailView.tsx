import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  QrCode,
  Share2,
  ShieldCheck,
  Smartphone,
  Star,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import type { DeveloperSessionUser, ReviewItem, StoreApp } from '../types.ts';
import { resolveAssetUrl } from '../data/fallbackStore.ts';
import { AppIcon } from './AppIcon.tsx';
import { StarRating } from './StarRating.tsx';

interface AppDetailViewProps {
  app: StoreApp;
  reviews: ReviewItem[];
  currentUser: DeveloperSessionUser | null;
  getAuthToken: () => Promise<string | null>;
  onBack: () => void;
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
  onAppUpdated,
  onAppDeleted,
}: AppDetailViewProps) {
  const [installPhase, setInstallPhase] = useState<'idle' | 'installing' | 'done'>('idle');
  const [installProgress, setInstallProgress] = useState(0);
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

  useEffect(() => {
    setInstallPhase('idle');
    setInstallProgress(0);
    setShowQrPanel(false);
    setConfirmDelete(false);
    setReviewError(null);
    setReviewSuccess(false);
  }, [app.id]);

  useEffect(() => {
    if (!showQrPanel) return;
    const directUrl = `${window.location.origin}/api/apps/${encodeURIComponent(app.id)}/install-apk`;
    QRCode.toDataURL(directUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#202124', light: '#FFFFFF' },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [showQrPanel, app.id]);

  const handleDirectInstall = async () => {
    if (installPhase === 'installing') return;
    setInstallPhase('installing');
    setInstallProgress(18);

    const timer = window.setInterval(() => {
      setInstallProgress((prev) => (prev < 88 ? prev + 14 : prev));
    }, 120);

    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(app.id)}/install`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = (await res.json()) as { downloads: number };
        onAppUpdated({ ...app, downloads: data.downloads });
      }
    } catch {
      // Continue direct package handoff even if telemetry update fails
    }

    window.setTimeout(() => {
      window.clearInterval(timer);
      setInstallProgress(100);
      setInstallPhase('done');

      // Trigger direct APK package handoff to Android Package Installer
      const installEndpoint = `/api/apps/${encodeURIComponent(app.id)}/install-apk`;
      const link = document.createElement('a');
      link.href = installEndpoint;
      link.setAttribute('download', `${app.packageName}-v${app.versionName}.apk`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // On non-Android desktop browsers, also open QR panel for instant phone handoff
      const isAndroid = /android/i.test(navigator.userAgent);
      if (!isAndroid) {
        setShowQrPanel(true);
      }
    }, 680);
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/?app=${encodeURIComponent(app.id)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
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

    setSubmittingReview(true);
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(app.id)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: authorInput.trim(),
          rating: ratingInput,
          comment: commentInput.trim(),
        }),
      });

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
      setReviewError('تعذر الاتصال بالخادم أثناء إرسال المراجعة.');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleHelpful = async (reviewId: string) => {
    if (helpfulVoted[reviewId]) return;
    setHelpfulVoted((prev) => ({ ...prev, [reviewId]: true }));
    try {
      const res = await fetch(
        `/api/apps/${encodeURIComponent(app.id)}/reviews/${encodeURIComponent(reviewId)}/helpful`,
        { method: 'POST' }
      );
      if (res.ok) {
        const data = (await res.json()) as { helpfulCount: number };
        const updated = reviews.map((r) =>
          r.id === reviewId ? { ...r, helpfulCount: data.helpfulCount } : r
        );
        onAppUpdated(app, updated);
      }
    } catch {
      // Ignore network hiccup
    }
  };

  const handleDeleteApp = async () => {
    if (!currentUser) return;
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch(`./api/apps/${encodeURIComponent(app.id)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        onAppDeleted(app.id);
      }
    } catch {
      // Ignore
    }
  };

  const totalDist = Math.max(app.reviewCount, 1);

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

        {app.hasCustomApk && currentUser && app.ownerUid === currentUser.uid && (
          <div className="flex items-center gap-2">
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
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end gap-3 shrink-0 lg:min-w-[260px]">
          <button
            type="button"
            onClick={handleDirectInstall}
            disabled={installPhase === 'installing'}
            className="w-full inline-flex items-center justify-center gap-2.5 px-7 py-3.5 text-sm font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] disabled:opacity-80 rounded-xl transition-colors shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#01875F]"
          >
            {installPhase === 'installing' ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span className="tabular-nums">جاري التجهيز للتثبيت ({installProgress}%)</span>
              </>
            ) : installPhase === 'done' ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>إعادة إرسال حزمة التثبيت</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>تثبيت مباشر على الهاتف</span>
              </>
            )}
          </button>

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
              <span>{copiedShare ? 'تم النسخ' : 'مشاركة'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Install Progress / QR Phone Handoff Notice */}
      {(installPhase !== 'idle' || showQrPanel) && (
        <section className="p-5 sm:p-6 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#202124]">
              <ShieldCheck className="w-5 h-5 text-[#01875F]" />
              <span>
                {installPhase === 'done'
                  ? 'تم إرسال حزمة APK مباشرة إلى جهازك لبدء التثبيت'
                  : 'التثبيت المباشر على هاتف أندرويد'}
              </span>
            </div>
            <p className="text-sm text-[#5F6368] leading-relaxed">
              {installPhase === 'done'
                ? 'إذا كنت تتصفح من هاتف أندرويد، سيفتح مثبّت النظام تلقائياً لإكمال التثبيت بضغطة واحدة. وإذا كنت تستخدم جهاز كمبيوتر، امسح رمز QR لتثبيت التطبيق فوراً على هاتفك.'
                : 'وجّه كاميرا هاتفك الأندرويد نحو رمز الاستجابة السريعة للانتقال مباشرة إلى تثبيت التطبيق دون الحاجة لنقل الملفات يدوياً.'}
            </p>
            {installPhase === 'installing' && (
              <div className="w-full max-w-md h-2 bg-[#E8EAED] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#01875F] transition-all duration-150"
                  style={{ width: `${installProgress}%` }}
                />
              </div>
            )}
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
                <span>امسح للتثبيت الفوري</span>
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
