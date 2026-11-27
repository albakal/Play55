import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowRight,
  CheckCircle2,
  FileArchive,
  ImagePlus,
  LogOut,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { AppCategory, ExtractedApkInfo, StoreApp } from '../types.ts';
import { parseApkFile } from '../utils/apkParser.ts';

interface UploadStudioViewProps {
  user: User | null;
  authLoading: boolean;
  authError: string | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  onPublished: (newApp: StoreApp) => void;
}

const CATEGORIES: AppCategory[] = [
  'الإنتاجية',
  'الأدوات',
  'الصوتيات',
  'التعليم',
  'الأعمال',
  'التصوير',
  'الألعاب',
];

interface PromoPreview {
  id: string;
  file: File;
  url: string;
}

export function UploadStudioView({
  user,
  authLoading,
  authError,
  onSignIn,
  onSignOut,
  onBack,
  onPublished,
}: UploadStudioViewProps) {
  const apkInputRef = useRef<HTMLInputElement>(null);
  const customIconInputRef = useRef<HTMLInputElement>(null);
  const screenshotsInputRef = useRef<HTMLInputElement>(null);

  const [apkFile, setApkFile] = useState<File | null>(null);
  const [parsingApk, setParsingApk] = useState(false);
  const [apkDragging, setApkDragging] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedApkInfo | null>(null);

  const [customIconFile, setCustomIconFile] = useState<File | null>(null);
  const [customIconPreview, setCustomIconPreview] = useState<string | null>(null);

  const [screenshots, setScreenshots] = useState<PromoPreview[]>([]);

  // Form fields
  const [name, setName] = useState('');
  const [developer, setDeveloper] = useState(user?.displayName || '');
  const [category, setCategory] = useState<AppCategory>('الإنتاجية');
  const [shortDescription, setShortDescription] = useState('');
  const [fullDescription, setFullDescription] = useState('');
  const [whatsNew, setWhatsNew] = useState('');
  const [packageName, setPackageName] = useState('');

  useEffect(() => {
    if (user?.displayName && !developer.trim()) {
      setDeveloper(user.displayName);
    }
  }, [user, developer]);
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [minAndroid, setMinAndroid] = useState('Android 8.0+');
  const [ageRating, setAgeRating] = useState('+3');

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const processApkFile = async (file: File) => {
    setError(null);
    setApkFile(file);
    setParsingApk(true);

    try {
      const info = await parseApkFile(file);
      setExtracted(info);
      setPackageName(info.packageName);
      setVersionName(info.versionName);
      setVersionCode(info.versionCode);
      setMinAndroid(info.minAndroid);
      if (!name.trim() && info.appLabel) {
        setName(info.appLabel);
      }
      if (customIconPreview) {
        URL.revokeObjectURL(customIconPreview);
        setCustomIconPreview(null);
        setCustomIconFile(null);
      }
    } catch {
      setError('تعذر قراءة ملف APK. تأكد من أن الملف صالح بصيغة أندرويد.');
    } finally {
      setParsingApk(false);
    }
  };

  const handleLoadSampleApk = async () => {
    setError(null);
    setParsingApk(true);
    try {
      const res = await fetch('/api/sample-apk');
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const sampleFile = new File([blob], 'noor-smartnotes-v2.4.0.apk', {
        type: 'application/vnd.android.package-archive',
      });
      await processApkFile(sampleFile);
      if (!developer.trim()) setDeveloper('مختبرات نور الرقمية');
      if (!shortDescription.trim()) {
        setShortDescription('مفكرة ذكية لتدوين الملاحظات الصوتية والنصية وتنظيم الأفكار بسرعة فائقة.');
      }
      if (!fullDescription.trim()) {
        setFullDescription(
          'تطبيق مفكرة نور الذكية يجمع بين بساطة التدوين السريع وقوة التنظيم عبر الوسوم والمجلدات المشفرة.\n\n• حفظ تلقائي فوري دون اتصال بالإنترنت.\n• بحث شامل داخل جميع الملاحظات باللغة العربية.\n• تصدير أنيق بصيغة PDF ومشاركة مباشرة.'
        );
      }
    } catch {
      setError('تعذر تحميل ملف APK النموذجي، يمكنك اختيار ملف APK من جهازك مباشرة.');
      setParsingApk(false);
    }
  };

  const handleApkDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setApkDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processApkFile(file);
    }
  };

  const handleCustomIconSelect = (file: File | undefined) => {
    if (!file) return;
    if (customIconPreview) URL.revokeObjectURL(customIconPreview);
    setCustomIconFile(file);
    setCustomIconPreview(URL.createObjectURL(file));
  };

  const handleScreenshotsAdd = (files: FileList | null) => {
    if (!files) return;
    const incoming: PromoPreview[] = [];
    for (let i = 0; i < files.length; i++) {
      if (screenshots.length + incoming.length >= 8) break;
      const f = files[i];
      if (!f.type.startsWith('image/')) continue;
      incoming.push({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        url: URL.createObjectURL(f),
      });
    }
    setScreenshots((prev) => [...prev, ...incoming]);
  };

  const removeScreenshot = (id: string) => {
    setScreenshots((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError('يجب تسجيل الدخول بحساب جوجل قبل رفع التطبيق.');
      return;
    }

    if (!apkFile) {
      setError('يرجى رفع ملف التطبيق بصيغة APK أولاً.');
      return;
    }
    if (!name.trim()) {
      setError('يرجى إدخال اسم التطبيق.');
      return;
    }
    if (!shortDescription.trim()) {
      setError('يرجى كتابة وصف مختصر للتطبيق.');
      return;
    }

    let idToken = '';
    try {
      idToken = await user.getIdToken();
    } catch {
      setError('انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول بحساب جوجل.');
      return;
    }

    const formData = new FormData();
    formData.append('apk', apkFile);

    if (customIconFile) {
      formData.append('icon', customIconFile);
    } else if (extracted?.iconBlob && extracted.iconFilename) {
      formData.append('icon', extracted.iconBlob, extracted.iconFilename);
    }

    for (const item of screenshots) {
      formData.append('screenshots', item.file);
    }

    formData.append('name', name.trim());
    formData.append('developer', developer.trim() || user.displayName || 'مطور مستقل');
    formData.append('category', category);
    formData.append('shortDescription', shortDescription.trim());
    formData.append('fullDescription', fullDescription.trim() || shortDescription.trim());
    formData.append('whatsNew', whatsNew.trim());
    formData.append('packageName', packageName.trim() || extracted?.packageName || 'com.app.android');
    formData.append('versionName', versionName.trim() || extracted?.versionName || '1.0.0');
    formData.append('versionCode', versionCode.trim() || extracted?.versionCode || '1');
    formData.append('minAndroid', minAndroid.trim() || 'Android 8.0+');
    formData.append('ageRating', ageRating);
    formData.append('sizeMB', String(extracted?.sizeMB || 1));
    formData.append('permissionsCount', String(extracted?.permissionsCount || 0));

    setUploading(true);
    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/apps');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as { app: StoreApp };
          onPublished(parsed.app);
        } catch {
          setError('تم الرفع ولكن تعذر قراءة استجابة الخادم.');
        }
      } else {
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          setError(parsed.error || 'فشل رفع التطبيق، تأكد من حجم الملفات وحاول مجدداً.');
        } catch {
          setError('حدث خطأ غير متوقع أثناء نشر التطبيق.');
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError('تعذر الاتصال بالخادم أثناء رفع ملف APK.');
    };

    xhr.send(formData);
  };

  const activeIconPreview = customIconPreview || extracted?.iconDataUrl || null;

  if (authLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-[#01875F]/30 border-t-[#01875F] rounded-full animate-spin" />
        <p className="text-sm text-[#5F6368]">جاري التحقق من حالة حساب المطور...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5F6368] hover:text-[#202124]"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          <span>العودة إلى المتجر</span>
        </button>

        <div className="p-8 sm:p-10 bg-[#F8F9FA] border border-[#E8EAED] rounded-3xl text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#01875F]/10 text-[#01875F] flex items-center justify-center">
            <ShieldCheck className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-[#202124]">
              تسجيل دخول المطور بحساب جوجل
            </h1>
            <p className="text-sm text-[#5F6368] max-w-md mx-auto leading-relaxed">
              لضمان موثوقية التطبيقات وحماية المستخدمين، يجب تسجيل الدخول بحساب جوجل الخاص بك قبل رفع ملفات APK ونشرها في المتجر.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
              {authError}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={() => void onSignIn()}
              className="inline-flex items-center justify-center gap-3 px-7 py-3.5 text-sm font-semibold text-[#202124] bg-white hover:bg-[#F1F3F4] border border-[#DADCE0] rounded-xl transition-colors shadow-xs"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              <span>تسجيل الدخول بحساب جوجل</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Authenticated Developer Identity Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl">
        <div className="flex items-center gap-3 min-w-0">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || 'حساب المطور'}
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-full object-cover border border-[#E8EAED]"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#01875F]/15 text-[#01875F] font-bold text-sm flex items-center justify-center">
              {(user.displayName || user.email || 'م').charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#202124] truncate">
              {user.displayName || 'مطور موثّق'}
            </p>
            <p className="text-xs text-[#5F6368] truncate" dir="ltr">
              {user.email}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#5F6368] hover:text-[#202124] bg-white border border-[#DADCE0] rounded-xl transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>تسجيل الخروج</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E8EAED]">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5F6368] hover:text-[#202124] mb-1"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>العودة إلى المتجر</span>
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#202124]">
            استوديو نشر التطبيقات (APK)
          </h1>
          <p className="text-sm text-[#5F6368]">
            ارفع ملف APK لاستخراج الأيقونة وبيانات الحزمة تلقائياً، ثم أضف الصور الترويجية والوصف للنشر الفوري.
          </p>
        </div>

        <button
          type="button"
          onClick={handleLoadSampleApk}
          disabled={parsingApk || uploading}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#01875F] bg-[#01875F]/8 hover:bg-[#01875F]/15 rounded-xl transition-colors whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-4 h-4" />
          <span>تجربة بملف APK نموذجي</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Step 1: APK Upload & Automatic Icon/Metadata Extraction */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-[#202124]">
              1. حزمة التطبيق (APK) واستخراج الأيقونة
            </h2>
            {apkFile && (
              <button
                type="button"
                onClick={() => apkInputRef.current?.click()}
                className="text-xs font-semibold text-[#01875F] hover:underline"
              >
                تغيير ملف APK
              </button>
            )}
          </div>

          <input
            ref={apkInputRef}
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void processApkFile(file);
            }}
          />

          {!apkFile ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setApkDragging(true);
              }}
              onDragLeave={() => setApkDragging(false)}
              onDrop={handleApkDrop}
              onClick={() => apkInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') apkInputRef.current?.click();
              }}
              className={`cursor-pointer border-2 border-dashed rounded-2xl p-10 text-center transition-colors ${
                apkDragging
                  ? 'border-[#01875F] bg-[#01875F]/5'
                  : 'border-[#DADCE0] bg-[#F8F9FA] hover:border-[#01875F]/60'
              }`}
            >
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#01875F]/10 text-[#01875F] flex items-center justify-center">
                <FileArchive className="w-7 h-7" />
              </div>
              <p className="font-display text-base font-bold text-[#202124] mb-1">
                اسحب ملف APK وأفلته هنا، أو اضغط للاختيار من جهازك
              </p>
              <p className="text-xs text-[#5F6368]">
                يدعم استخراج أيقونة التطبيق، اسم الحزمة، رقم الإصدار، والحد الأدنى لنظام أندرويد تلقائياً (حتى 150 MB)
              </p>
            </div>
          ) : (
            <div className="p-5 sm:p-6 bg-[#F8F9FA] border border-[#E8EAED] rounded-2xl space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {/* Extracted / Custom Icon Preview */}
                  <div className="relative shrink-0">
                    {activeIconPreview ? (
                      <img
                        src={activeIconPreview}
                        alt="أيقونة التطبيق المستخرجة"
                        className="w-20 h-20 rounded-2xl object-cover border border-black/10 bg-white shadow-xs"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-2xl bg-[#E8EAED] text-[#5F6368] flex items-center justify-center">
                        <Package className="w-8 h-8" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => customIconInputRef.current?.click()}
                      title="استبدال الأيقونة"
                      className="absolute -bottom-1.5 -left-1.5 p-1.5 bg-white border border-[#DADCE0] rounded-full text-[#202124] hover:text-[#01875F] shadow-xs"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <input
                      ref={customIconInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => handleCustomIconSelect(e.target.files?.[0])}
                    />
                  </div>

                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-bold text-[#202124]">
                      <CheckCircle2 className="w-4 h-4 text-[#01875F] shrink-0" />
                      <span className="truncate" dir="ltr">
                        {apkFile.name}
                      </span>
                    </div>

                    {parsingApk ? (
                      <p className="text-xs text-[#01875F] font-medium">
                        جاري فحص محتويات الحزمة واستخراج الأيقونة والبيانات...
                      </p>
                    ) : (
                      <div className="text-xs text-[#5F6368] space-y-0.5">
                        <p>
                          {extracted?.iconDataUrl
                            ? `تم استخراج الأيقونة تلقائياً من (${extracted.iconSourcePath})`
                            : 'لم تحتوي الحزمة على أيقونة نقطية؛ يمكنك رفع أيقونة مخصصة بالضغط على زر التحديث.'}
                        </p>
                        <p className="font-mono tabular-nums" dir="ltr">
                          {extracted?.packageName} · v{extracted?.versionName} · {extracted?.sizeMB} MB ·{' '}
                          {extracted?.minAndroid}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Step 2: Promotional Screenshots */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#202124]">
                2. الصور الترويجية للتطبيق
              </h2>
              <p className="text-xs text-[#5F6368]">
                أضف لقطات شاشة أو صوراً ترويجية عالية الجودة (حتى 8 صور) لعرضها في صفحة التطبيق.
              </p>
            </div>
            <button
              type="button"
              onClick={() => screenshotsInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#202124] bg-[#F8F9FA] hover:bg-[#F1F3F4] border border-[#DADCE0] rounded-xl transition-colors whitespace-nowrap"
            >
              <ImagePlus className="w-4 h-4 text-[#01875F]" />
              <span>إضافة صور ترويجية</span>
            </button>
            <input
              ref={screenshotsInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleScreenshotsAdd(e.target.files)}
            />
          </div>

          {screenshots.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {screenshots.map((shot) => (
                <div
                  key={shot.id}
                  className="relative group aspect-video rounded-xl overflow-hidden border border-[#E8EAED] bg-[#F8F9FA]"
                >
                  <img
                    src={shot.url}
                    alt="صورة ترويجية مرفوعة"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(shot.id)}
                    aria-label="إزالة الصورة"
                    className="absolute top-2 left-2 p-1 bg-black/65 hover:bg-red-600 text-white rounded-full transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => screenshotsInputRef.current?.click()}
              className="w-full py-8 border border-dashed border-[#DADCE0] rounded-2xl text-xs text-[#5F6368] hover:border-[#01875F]/60 hover:bg-[#F8F9FA] transition-colors"
            >
              اضغط هنا لاختيار صور ترويجية من جهازك
            </button>
          )}
        </section>

        {/* Step 3: App Metadata & Description */}
        <section className="space-y-5">
          <h2 className="font-display text-lg font-bold text-[#202124]">
            3. تفاصيل ووصف التطبيق
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="app-name" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                اسم التطبيق في المتجر *
              </label>
              <input
                id="app-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: مفكرة نور الذكية"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
              />
            </div>

            <div>
              <label htmlFor="app-dev" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                اسم المطور أو الشركة
              </label>
              <input
                id="app-dev"
                type="text"
                value={developer}
                onChange={(e) => setDeveloper(e.target.value)}
                placeholder="مثال: مختبرات نور الرقمية"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
              />
            </div>

            <div>
              <label htmlFor="app-cat" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                التصنيف
              </label>
              <select
                id="app-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as AppCategory)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="app-pkg" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                معرف الحزمة (Package ID)
              </label>
              <input
                id="app-pkg"
                type="text"
                dir="ltr"
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
                placeholder="com.example.app"
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
              />
            </div>

            <div>
              <label htmlFor="app-ver" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                رقم الإصدار
              </label>
              <input
                id="app-ver"
                type="text"
                dir="ltr"
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                placeholder="1.0.0"
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
              />
            </div>

            <div>
              <label htmlFor="app-age" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                التصنيف العمري
              </label>
              <select
                id="app-age"
                value={ageRating}
                onChange={(e) => setAgeRating(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
              >
                <option value="+3">مناسب للجميع (+3)</option>
                <option value="+7">للفئة (+7)</option>
                <option value="+12">للفئة (+12)</option>
                <option value="+16">للفئة (+16)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="app-short" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
              وصف مختصر *
            </label>
            <input
              id="app-short"
              type="text"
              required
              maxLength={180}
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="جملة تعريفية سريعة تظهر أسفل اسم التطبيق في واجهة المتجر..."
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
            />
          </div>

          <div>
            <label htmlFor="app-full" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
              الوصف الكامل ومميزات التطبيق
            </label>
            <textarea
              id="app-full"
              rows={5}
              value={fullDescription}
              onChange={(e) => setFullDescription(e.target.value)}
              placeholder="اكتب شرحاً وافياً لمميزات التطبيق وكيفية استفادة المستخدمين منه..."
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
            />
          </div>

          <div>
            <label htmlFor="app-whatsnew" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
              ما الجديد في هذا الإصدار
            </label>
            <input
              id="app-whatsnew"
              type="text"
              value={whatsNew}
              onChange={(e) => setWhatsNew(e.target.value)}
              placeholder="مثال: تحسين سرعة الإقلاع وإصلاح بعض الأخطاء..."
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
            />
          </div>
        </section>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            {error}
          </div>
        )}

        {uploading && (
          <div className="p-4 bg-[#F8F9FA] border border-[#E8EAED] rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#202124]">
              <span>جاري رفع ملف APK والصور الترويجية إلى المتجر...</span>
              <span className="tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 bg-[#E8EAED] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#01875F] transition-all duration-150"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#E8EAED]">
          <button
            type="button"
            onClick={onBack}
            disabled={uploading}
            className="px-5 py-2.5 text-sm font-medium text-[#5F6368] hover:text-[#202124] rounded-xl transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={uploading || parsingApk}
            className="inline-flex items-center gap-2 px-7 py-3 text-sm font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] disabled:opacity-60 rounded-xl transition-colors shadow-xs"
          >
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'جاري النشر...' : 'نشر التطبيق في المتجر'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
