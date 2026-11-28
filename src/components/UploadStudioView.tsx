import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  FileArchive,
  ImagePlus,
  Link2,
  Lock,
  LogOut,
  Mail,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  User as UserIcon,
  X,
} from 'lucide-react';
import type {
  AppCategory,
  DeveloperSessionUser,
  ExtractedApkInfo,
  StoreApp,
} from '../types.ts';
import { resolveAssetUrl } from '../catalog/fallbackStore.ts';
import { auth, cloudPublishOrUpdateApp } from '../firebase.ts';
import { parseApkFile } from '../utils/apkParser.ts';
import {
  buildSampleApkFileClient,
  localMarkAppSynced,
  localPublishApp,
  localUpdateApp,
} from '../utils/localStoreEngine.ts';
import { buildPermanentAppShareUrl } from '../utils/shareLink.ts';
import { AppIcon } from './AppIcon.tsx';

interface UploadStudioViewProps {
  user: DeveloperSessionUser | null;
  apps: StoreApp[];
  editingApp: StoreApp | null;
  authLoading: boolean;
  authError: string | null;
  onManualAuth: (params: {
    mode: 'login' | 'register';
    name?: string;
    email: string;
    password: string;
  }) => Promise<void>;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  onBack: () => void;
  onOpenApp: (appId: string) => void;
  onStartEdit: (app: StoreApp) => void;
  onCancelEdit: () => void;
  onAppSaved: (savedApp: StoreApp, isUpdate: boolean) => void;
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

function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed reading image'));
    reader.readAsDataURL(blob);
  });
}

export function UploadStudioView({
  user,
  apps,
  editingApp,
  authLoading,
  authError,
  onManualAuth,
  onGoogleSignIn,
  onSignOut,
  getAuthToken,
  onBack,
  onOpenApp,
  onStartEdit,
  onCancelEdit,
  onAppSaved,
}: UploadStudioViewProps) {
  const apkInputRef = useRef<HTMLInputElement>(null);
  const customIconInputRef = useRef<HTMLInputElement>(null);
  const screenshotsInputRef = useRef<HTMLInputElement>(null);

  // Manual Auth form state
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

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
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [minAndroid, setMinAndroid] = useState('Android 8.0+');
  const [ageRating, setAgeRating] = useState('+3');
  const [externalApkUrl, setExternalApkUrl] = useState('');
  const [autoSignUnsigned, setAutoSignUnsigned] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedBanner, setLastSavedBanner] = useState<{
    app: StoreApp;
    isUpdate: boolean;
  } | null>(null);
  const [copiedAppId, setCopiedAppId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.displayName && !developer.trim() && !editingApp) {
      setDeveloper(user.displayName);
    }
  }, [user, developer, editingApp]);

  useEffect(() => {
    if (editingApp) {
      setError(null);
      setApkFile(null);
      setExtracted(null);
      setCustomIconFile(null);
      setCustomIconPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setScreenshots([]);
      setName(editingApp.name);
      setDeveloper(editingApp.developer);
      setCategory(editingApp.category);
      setShortDescription(editingApp.shortDescription);
      setFullDescription(editingApp.fullDescription);
      setWhatsNew(editingApp.whatsNew);
      setPackageName(editingApp.packageName);
      setVersionName(editingApp.versionName);
      setVersionCode(editingApp.versionCode);
      setMinAndroid(editingApp.minAndroid);
      setAgeRating(editingApp.ageRating);
      setExternalApkUrl(editingApp.externalApkUrl || '');
    }
  }, [editingApp]);

  const handleCopyAppLink = async (targetApp: StoreApp) => {
    try {
      await navigator.clipboard.writeText(buildPermanentAppShareUrl(targetApp));
      setCopiedAppId(targetApp.id);
      window.setTimeout(() => {
        setCopiedAppId((prev) => (prev === targetApp.id ? null : prev));
      }, 2500);
    } catch {
      setCopiedAppId(null);
    }
  };

  const resetFormFields = () => {
    setApkFile(null);
    setExtracted(null);
    setCustomIconFile(null);
    if (customIconPreview) URL.revokeObjectURL(customIconPreview);
    setCustomIconPreview(null);
    setScreenshots([]);
    setName('');
    setDeveloper(user?.displayName || '');
    setCategory('الإنتاجية');
    setShortDescription('');
    setFullDescription('');
    setWhatsNew('');
    setPackageName('');
    setVersionName('');
    setVersionCode('');
    setMinAndroid('Android 8.0+');
    setAgeRating('+3');
    setExternalApkUrl('');
  };

  const processApkFile = async (file: File) => {
    setError(null);
    setParsingApk(true);

    try {
      const info = await parseApkFile(file);
      if (!info.isValidZipApk) {
        setApkFile(null);
        setExtracted(null);
        setError(
          info.validationError ||
            'الملف المحدد ليس حزمة APK صالحة، يرجى اختيار ملف Android APK سليم.'
        );
        return;
      }
      setApkFile(file);
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
      setApkFile(null);
      setExtracted(null);
      setError('تعذر قراءة ملف APK. تأكد من أن الملف صالح بصيغة أندرويد.');
    } finally {
      setParsingApk(false);
    }
  };

  const handleLoadSampleApk = async () => {
    setError(null);
    setParsingApk(true);
    try {
      let sampleFile: File | null = null;
      try {
        const res = await fetch('./api/sample-apk');
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && !contentType.includes('text/html')) {
          const blob = await res.blob();
          sampleFile = new File([blob], 'noor-smartnotes-v2.4.0.apk', {
            type: 'application/vnd.android.package-archive',
          });
        }
      } catch {
        sampleFile = null;
      }

      if (!sampleFile) {
        sampleFile = await buildSampleApkFileClient();
      }

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
      setError('تعذر تجهيز ملف APK النموذجي، يمكنك اختيار ملف APK من جهازك مباشرة.');
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
      setError('يجب تسجيل الدخول بحساب المطور قبل رفع التطبيق.');
      return;
    }

    const isUpdate = Boolean(editingApp);

    if (!isUpdate && !apkFile) {
      setError('يرجى رفع ملف التطبيق بصيغة APK أولاً.');
      return;
    }
    if (apkFile && extracted && !extracted.isValidZipApk) {
      setError(extracted.validationError || 'ملف APK المرفوع غير صالح.');
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

    const trimmedExternalUrl = externalApkUrl.trim();
    if (trimmedExternalUrl) {
      try {
        const parsed = new URL(trimmedExternalUrl);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
          setError('رابط التوزيع الخارجي يجب أن يبدأ ببروتوكول HTTPS الآمن فقط.');
          return;
        }
      } catch {
        setError('يرجى إدخال رابط HTTPS صحيح لملف APK الخارجي أو تركه فارغاً.');
        return;
      }
    }

    let idToken: string | null = null;
    try {
      idToken = await getAuthToken();
    } catch {
      idToken = null;
    }

    const formData = new FormData();
    if (apkFile) {
      formData.append('apk', apkFile);
    }

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
    formData.append(
      'packageName',
      packageName.trim() || extracted?.packageName || editingApp?.packageName || 'com.app.android'
    );
    formData.append(
      'versionName',
      versionName.trim() || extracted?.versionName || editingApp?.versionName || '1.0.0'
    );
    formData.append(
      'versionCode',
      versionCode.trim() || extracted?.versionCode || editingApp?.versionCode || '1'
    );
    formData.append('minAndroid', minAndroid.trim() || editingApp?.minAndroid || 'Android 8.0+');
    formData.append('ageRating', ageRating);
    formData.append('externalApkUrl', trimmedExternalUrl);
    formData.append('autoSignUnsigned', autoSignUnsigned ? 'true' : 'false');
    if (extracted) {
      formData.append('sizeMB', String(extracted.sizeMB || 1));
      formData.append('permissionsCount', String(extracted.permissionsCount || 0));
    }

    setUploading(true);
    setUploadProgress(0);

    const finalizeSave = async (savedApp: StoreApp, fromServer: boolean) => {
      let syncedToCloud = fromServer || Boolean(savedApp.syncedToCloud);

      if (user.provider === 'google' && auth.currentUser?.emailVerified) {
        try {
          let cloudIconUrl = savedApp.iconUrl;
          if (customIconFile) {
            cloudIconUrl = await fileToDataUrl(customIconFile).catch(() => savedApp.iconUrl);
          } else if (extracted?.iconDataUrl) {
            cloudIconUrl = extracted.iconDataUrl;
          } else if (extracted?.iconBlob) {
            cloudIconUrl = await fileToDataUrl(extracted.iconBlob).catch(() => savedApp.iconUrl);
          }

          let cloudScreenshots = savedApp.screenshots;
          if (screenshots.length > 0) {
            const convertedShots: string[] = [];
            for (const item of screenshots.slice(0, 4)) {
              const dataUrl = await fileToDataUrl(item.file).catch(() => '');
              if (dataUrl) convertedShots.push(dataUrl);
            }
            if (convertedShots.length > 0) {
              cloudScreenshots = convertedShots;
            }
          }

          const cloudCandidate: StoreApp = {
            ...savedApp,
            iconUrl: cloudIconUrl,
            screenshots: cloudScreenshots,
          };

          const cloudOk = await cloudPublishOrUpdateApp(cloudCandidate, isUpdate);
          if (cloudOk) {
            syncedToCloud = true;
            await localMarkAppSynced(savedApp.id, true);
          }
        } catch {
          // Keep saved locally / server-side and rely on snapshot URL if needed
        }
      }

      const finalApp: StoreApp = {
        ...savedApp,
        syncedToCloud,
      };

      setUploadProgress(100);
      setUploading(false);
      setLastSavedBanner({ app: finalApp, isUpdate });
      resetFormFields();
      onAppSaved(finalApp, isUpdate);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const saveLocally = async () => {
      try {
        setUploadProgress(60);
        const iconBlob = customIconFile || extracted?.iconBlob || null;
        const savedApp = editingApp
          ? await localUpdateApp({
              existingApp: editingApp,
              apkFile,
              iconSource: iconBlob,
              screenshots: screenshots.map((s) => s.file),
              name: name.trim(),
              developer: developer.trim() || user.displayName || 'مطور مستقل',
              category,
              shortDescription: shortDescription.trim(),
              fullDescription: fullDescription.trim() || shortDescription.trim(),
              whatsNew: whatsNew.trim(),
              packageName: packageName.trim() || extracted?.packageName || editingApp.packageName,
              versionName: versionName.trim() || extracted?.versionName || editingApp.versionName,
              versionCode: versionCode.trim() || extracted?.versionCode || editingApp.versionCode,
              minAndroid: minAndroid.trim() || editingApp.minAndroid,
              ageRating,
              sizeMB: extracted?.sizeMB,
              isBinaryManifest: extracted?.isBinaryManifest,
              isSignedApk: extracted?.isSignedApk,
              signatureScheme: extracted?.signatureScheme,
              apkSha256: extracted?.apkSha256,
              externalApkUrl: trimmedExternalUrl,
              permissionsCount: extracted?.permissionsCount,
              owner: user,
            })
          : await localPublishApp({
              apkFile: apkFile!,
              iconSource: iconBlob,
              screenshots: screenshots.map((s) => s.file),
              name: name.trim(),
              developer: developer.trim() || user.displayName || 'مطور مستقل',
              category,
              shortDescription: shortDescription.trim(),
              fullDescription: fullDescription.trim() || shortDescription.trim(),
              whatsNew: whatsNew.trim(),
              packageName: packageName.trim() || extracted?.packageName || 'com.app.android',
              versionName: versionName.trim() || extracted?.versionName || '1.0.0',
              versionCode: versionCode.trim() || extracted?.versionCode || '1',
              minAndroid: minAndroid.trim() || 'Android 8.0+',
              ageRating,
              sizeMB: extracted?.sizeMB || 1,
              isBinaryManifest: extracted?.isBinaryManifest,
              isSignedApk: extracted?.isSignedApk,
              signatureScheme: extracted?.signatureScheme,
              apkSha256: extracted?.apkSha256,
              externalApkUrl: trimmedExternalUrl || undefined,
              permissionsCount: extracted?.permissionsCount || 0,
              owner: user,
            });
        await finalizeSave(savedApp, false);
      } catch (localErr) {
        setUploading(false);
        setError(
          localErr instanceof Error
            ? localErr.message
            : 'حدث خطأ أثناء حفظ بيانات التطبيق محلياً.'
        );
      }
    };

    const xhr = new XMLHttpRequest();
    xhr.open(
      editingApp ? 'PUT' : 'POST',
      editingApp ? `./api/apps/${encodeURIComponent(editingApp.id)}` : './api/apps'
    );
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'Play55');
    if (idToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (xhr.status >= 200 && xhr.status < 300 && contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(xhr.responseText) as { app: StoreApp };
          void finalizeSave(parsed.app, true);
        } catch {
          setUploading(false);
          setError('تم الرفع ولكن تعذر قراءة استجابة الخادم.');
        }
      } else if (
        (!editingApp && xhr.status === 404) ||
        xhr.status === 405 ||
        !contentType.includes('application/json')
      ) {
        void saveLocally();
      } else {
        setUploading(false);
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          setError(parsed.error || 'فشل حفظ التطبيق، تأكد من حجم الملفات وحاول مجدداً.');
        } catch {
          setError('حدث خطأ غير متوقع أثناء نشر التطبيق.');
        }
      }
    };

    xhr.onerror = () => {
      void saveLocally();
    };

    xhr.send(formData);
  };

  const activeIconPreview =
    customIconPreview ||
    extracted?.iconDataUrl ||
    (editingApp ? resolveAssetUrl(editingApp.iconUrl) : null);

  if (authLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-[#01875F]/30 border-t-[#01875F] rounded-full animate-spin" />
        <p className="text-sm text-[#5F6368]">جاري التحقق من حالة حساب المطور...</p>
      </div>
    );
  }

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    try {
      await onManualAuth({
        mode: authMode,
        name: authMode === 'register' ? authName : undefined,
        email: authEmail,
        password: authPassword,
      });
    } finally {
      setAuthSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5F6368] hover:text-[#202124]"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          <span>العودة إلى المتجر</span>
        </button>

        <div className="p-6 sm:p-8 bg-[#F8F9FA] border border-[#E8EAED] rounded-3xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#01875F]/10 text-[#01875F] flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1 className="font-display text-2xl font-bold text-[#202124]">
              حساب المطور
            </h1>
            <p className="text-sm text-[#5F6368] leading-relaxed">
              سجّل دخولك أو أنشئ حساب مطور بالاسم والبريد الإلكتروني وكلمة المرور لرفع ملفات APK وإدارة تطبيقاتك.
            </p>
          </div>

          {/* Segmented Tabs: Register vs Login */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#E8EAED]/70 rounded-xl">
            <button
              type="button"
              onClick={() => setAuthMode('register')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                authMode === 'register'
                  ? 'bg-white text-[#202124] shadow-xs'
                  : 'text-[#5F6368] hover:text-[#202124]'
              }`}
            >
              إنشاء حساب جديد
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                authMode === 'login'
                  ? 'bg-white text-[#202124] shadow-xs'
                  : 'text-[#5F6368] hover:text-[#202124]'
              }`}
            >
              تسجيل الدخول
            </button>
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label htmlFor="dev-auth-name" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                  الاسم الكامل للمطور
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-[#5F6368] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="dev-auth-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder="مثال: أحمد السالم"
                    className="w-full pr-10 pl-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="dev-auth-email" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#5F6368] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="dev-auth-email"
                  type="email"
                  dir="ltr"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="developer@example.com"
                  className="w-full pr-10 pl-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="dev-auth-password" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#5F6368] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="dev-auth-password"
                  type="password"
                  dir="ltr"
                  required
                  minLength={8}
                  maxLength={128}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="8 أحرف على الأقل"
                  className="w-full pr-10 pl-3.5 py-2.5 text-sm bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
                />
              </div>
            </div>

            {authError && (
              <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl leading-relaxed">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full py-3 text-sm font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] disabled:opacity-60 rounded-xl transition-colors shadow-xs"
            >
              {authSubmitting
                ? 'جاري التحقق...'
                : authMode === 'register'
                ? 'إنشاء الحساب والمتابعة'
                : 'تسجيل الدخول'}
            </button>
          </form>

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-[#E8EAED]" />
            <span className="px-3 text-xs text-[#5F6368] bg-[#F8F9FA] shrink-0">
              أو المتابعة عبر
            </span>
          </div>

          <button
            type="button"
            onClick={() => void onGoogleSignIn()}
            className="w-full inline-flex items-center justify-center gap-3 px-6 py-3 text-sm font-semibold text-[#202124] bg-white hover:bg-[#F1F3F4] border border-[#DADCE0] rounded-xl transition-colors"
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
    );
  }

  const myApps = apps.filter((a) => a.ownerUid === user.uid);

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

      {/* Post-Publish / Post-Update Permanent App Link Banner */}
      {lastSavedBanner && (
        <section className="p-5 bg-[#E6F4EA] border border-[#01875F]/30 rounded-2xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-bold text-[#016E4D]">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>
                {lastSavedBanner.isUpdate
                  ? `تم تحديث تطبيق «${lastSavedBanner.app.name}» إلى الإصدار v${lastSavedBanner.app.versionName} مع الحفاظ على نفس الرابط الدائم!`
                  : `تم نشر تطبيق «${lastSavedBanner.app.name}» وإنشاء رابطه الخاص تلقائياً!`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLastSavedBanner(null)}
              aria-label="إغلاق الإشعار"
              className="text-[#016E4D] hover:opacity-75 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white border border-[#01875F]/20 rounded-xl">
            <div className="flex items-center gap-2 min-w-0">
              <Link2 className="w-4 h-4 text-[#01875F] shrink-0" />
              <code className="text-xs font-mono text-[#202124] truncate" dir="ltr">
                {buildPermanentAppShareUrl(lastSavedBanner.app)}
              </code>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleCopyAppLink(lastSavedBanner.app)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#01875F] bg-[#E6F4EA] hover:bg-[#D5ECD9] rounded-lg transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedAppId === lastSavedBanner.app.id ? 'تم نسخ الرابط' : 'نسخ الرابط'}</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenApp(lastSavedBanner.app.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>فتح صفحة التطبيق</span>
              </button>
            </div>
          </div>

          {!lastSavedBanner.app.syncedToCloud && (
            <p className="text-[11px] text-[#016E4D] leading-relaxed">
              هذا الرابط يحتوي تلقائياً على بيانات التطبيق لكي يفتح صفحة تطبيقك لدى أي شخص ترسل له الرابط. وللربط السحابي الكامل برابط قصير وإتاحة التطبيق في الواجهة العامة للجميع، يمكنك تسجيل الدخول بحساب جوجل.
            </p>
          )}
        </section>
      )}

      {/* Developer Dashboard: My Published Apps & Independent Permanent Links */}
      <section className="p-5 bg-white border border-[#E8EAED] rounded-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-[#202124]">
              لوحة تحكم المطور — تطبيقاتي وروابطها الخاصة
            </h2>
            <p className="text-xs text-[#5F6368]">
              لكل تطبيق رابط دائم لا يتغير عند تحديث الإصدار؛ شاركه ليفتح الزوار صفحة تطبيقك مباشرة.
            </p>
          </div>
          <span className="text-xs font-semibold text-[#01875F] bg-[#E6F4EA] px-3 py-1 rounded-lg tabular-nums">
            {myApps.length} تطبيق منشور
          </span>
        </div>

        {myApps.length === 0 ? (
          <p className="text-xs text-[#5F6368] py-4 text-center bg-[#F8F9FA] rounded-xl">
            لم تنشر أي تطبيقات بعد. ارفع ملف APK في النموذج أدناه ليظهر رابطه الخاص هنا تلقائياً.
          </p>
        ) : (
          <div className="divide-y divide-[#E8EAED]">
            {myApps.map((item) => {
              const appLink = buildPermanentAppShareUrl(item);
              const isEditingThis = editingApp?.id === item.id;
              return (
                <div
                  key={item.id}
                  className={`py-4 first:pt-2 last:pb-1 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                    isEditingThis ? 'bg-[#E6F4EA]/35 -mx-3 px-3 rounded-xl' : ''
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <AppIcon src={item.iconUrl} alt={item.name} className="w-12 h-12 rounded-xl shrink-0" />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-sm font-bold text-[#202124] truncate">
                          {item.name}
                        </span>
                        <span className="text-[11px] font-mono bg-[#F1F3F4] text-[#202124] px-2 py-0.5 rounded-md" dir="ltr">
                          v{item.versionName}
                        </span>
                        <span className="text-[11px] text-[#5F6368] tabular-nums">
                          {item.downloads} تثبيت
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                            item.syncedToCloud
                              ? 'bg-[#E6F4EA] text-[#01875F]'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {item.syncedToCloud ? 'متزامن سحابياً' : 'رابط ذاتي مضمّن'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-[#5F6368] min-w-0">
                        <Link2 className="w-3.5 h-3.5 text-[#01875F] shrink-0" />
                        <code className="font-mono text-[11px] truncate" dir="ltr">
                          {appLink}
                        </code>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyAppLink(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#202124] bg-[#F8F9FA] hover:bg-[#F1F3F4] border border-[#DADCE0] rounded-lg transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5 text-[#01875F]" />
                      <span>{copiedAppId === item.id ? 'تم النسخ' : 'نسخ الرابط'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenApp(item.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#202124] bg-[#F8F9FA] hover:bg-[#F1F3F4] border border-[#DADCE0] rounded-lg transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#5F6368]" />
                      <span>عرض الصفحة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartEdit(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] rounded-lg transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{isEditingThis ? 'جاري التحديث...' : 'تحديث الإصدار'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
            {editingApp
              ? `تحديث تطبيق «${editingApp.name}»`
              : 'استوديو نشر التطبيقات (APK)'}
          </h1>
          <p className="text-sm text-[#5F6368]">
            {editingApp
              ? `سيتم تحديث التطبيق وتصدير الإصدار الجديد مع الاحتفاظ بنفس الرابط الدائم (${editingApp.id}). يمكنك رفع APK جديد أو تعديل البيانات فقط.`
              : 'ارفع ملف APK لاستخراج الأيقونة وبيانات الحزمة تلقائياً، ثم أضف الصور الترويجية والوصف للنشر الفوري.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {editingApp ? (
            <button
              type="button"
              onClick={() => {
                onCancelEdit();
                resetFormFields();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#5F6368] bg-[#F1F3F4] hover:bg-[#E8EAED] rounded-xl transition-colors whitespace-nowrap"
            >
              <X className="w-4 h-4" />
              <span>إلغاء التحديث والانتقال لنشر جديد</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLoadSampleApk}
              disabled={parsingApk || uploading}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#01875F] bg-[#01875F]/8 hover:bg-[#01875F]/15 rounded-xl transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" />
              <span>تجربة بملف APK نموذجي</span>
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Step 1: APK Upload & Automatic Icon/Metadata Extraction */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-[#202124]">
              {editingApp
                ? '1. تحديث ملف APK (اختياري) أو تعديل الأيقونة'
                : '1. حزمة التطبيق (APK) واستخراج الأيقونة'}
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
              className={`cursor-pointer border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-colors ${
                apkDragging
                  ? 'border-[#01875F] bg-[#01875F]/5'
                  : 'border-[#DADCE0] bg-[#F8F9FA] hover:border-[#01875F]/60'
              }`}
            >
              {editingApp ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <img
                      src={activeIconPreview || ''}
                      alt={editingApp.name}
                      className="w-16 h-16 rounded-2xl object-cover border border-black/10 bg-white"
                    />
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        customIconInputRef.current?.click();
                      }}
                      title="تغيير الأيقونة"
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
                  <p className="font-display text-sm font-bold text-[#202124]">
                    الحزمة الحالية محفوظة (v{editingApp.versionName}) — اضغط لرفع ملف APK أحدث إذا رغبت
                  </p>
                  <p className="text-xs text-[#5F6368]">
                    أو اكتفِ بتعديل رقم الإصدار والوصف بالأسفل وسيتم الحفاظ على الحزمة والأيقونة الحالية.
                  </p>
                </div>
              ) : (
                <>
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#01875F]/10 text-[#01875F] flex items-center justify-center">
                    <FileArchive className="w-7 h-7" />
                  </div>
                  <p className="font-display text-base font-bold text-[#202124] mb-1">
                    اسحب ملف APK وأفلته هنا، أو اضغط للاختيار من جهازك
                  </p>
                  <p className="text-xs text-[#5F6368]">
                    يتحقق النظام من سلامة الحزمة ويستخرج الأيقونة، اسم الحزمة، رقم الإصدار تلقائياً (حتى 150 MB)
                  </p>
                </>
              )}
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
                        {extracted?.isValidZipApk && (
                          <div className="space-y-1.5 pt-1">
                            <p className={extracted.isSignedApk ? 'text-[#01875F] font-medium' : 'text-amber-700 font-medium'}>
                              حزمة APK سليمة ومكتملة
                              {extracted.isSignedApk
                                ? ` · موقّعة رقمياً (${extracted.signatureScheme || 'Android Signature'}) — سيُحفظ توقيعك الأصلي كما هو`
                                : ' · الحزمة غير موقّعة رقمياً بعد'}
                            </p>
                            {!extracted.isSignedApk && (
                              <label className="flex items-start gap-2 p-2.5 bg-white border border-amber-200 rounded-xl text-[11px] text-[#3C4043] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={autoSignUnsigned}
                                  onChange={(e) => setAutoSignUnsigned(e.target.checked)}
                                  className="mt-0.5 accent-[#01875F]"
                                />
                                <span>
                                  <strong>توقيع الحزمة تلقائياً على الخادم بمفتاح Play55 (RSA-2048 v1)</strong> ليقبلها مُثبّت Android.
                                  <span className="block text-[#5F6368] mt-0.5">
                                    ملاحظة تقنية: أندرويد لا يعتمد شهادات موثوقة عالمياً لملفات APK؛ لذا يزول تنبيه Chrome تدريجياً مع استقرار النطاق والسمعة عبر HTTPS وليس عبر التوقيع وحده.
                                  </span>
                                </span>
                              </label>
                            )}
                            {extracted.apkSha256 && (
                              <p className="font-mono text-[11px] text-[#5F6368] break-all" dir="ltr">
                                SHA-256: {extracted.apkSha256}
                              </p>
                            )}
                          </div>
                        )}
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

          <div>
            <label htmlFor="app-external-apk" className="block text-xs font-semibold text-[#3C4043] mb-1.5">
              رابط استضافة APK مباشر عبر HTTPS (اختياري — للتوزيع عبر خادم/CDN موثوق)
            </label>
            <input
              id="app-external-apk"
              type="url"
              dir="ltr"
              value={externalApkUrl}
              onChange={(e) => setExternalApkUrl(e.target.value)}
              placeholder="https://github.com/user/repo/releases/download/v1.2/app.apk"
              className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#DADCE0] rounded-xl focus:outline-none focus:border-[#01875F]"
            />
            <p className="mt-1.5 text-[11px] text-[#5F6368] leading-relaxed">
              يُفضّل إضافة رابط HTTPS مباشر عند النشر على استضافة ثابتة لضمان عدم التنزيل عبر ذاكرة المتصفح المؤقتة (Blob) وإمكانية التنزيل من أي جهاز برابط موثوق.
            </p>
          </div>
        </section>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {uploading && (
          <div className="p-4 bg-[#F8F9FA] border border-[#E8EAED] rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#202124]">
              <span>
                {editingApp
                  ? 'جاري حفظ التحديث وتجهيز الإصدار الجديد بنفس الرابط...'
                  : 'جاري رفع ملف APK والصور الترويجية إلى المتجر...'}
              </span>
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
            onClick={() => {
              if (editingApp) {
                onCancelEdit();
                resetFormFields();
              } else {
                onBack();
              }
            }}
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
            <span>
              {uploading
                ? editingApp
                  ? 'جاري حفظ التحديث...'
                  : 'جاري النشر...'
                : editingApp
                ? 'حفظ التحديث بنفس الرابط'
                : 'نشر التطبيق في المتجر'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
