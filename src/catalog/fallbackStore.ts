import heroBannerImg from '../assets/images/hero_banner_store_1795812501251.jpg';
import iconAtlasImg from '../assets/images/app_icon_atlas_1795812501468.jpg';
import iconQalamImg from '../assets/images/app_icon_qalam_1795812502461.jpg';
import iconSadaImg from '../assets/images/app_icon_sada_1795812502435.jpg';
import promoProductivityImg from '../assets/images/promo_screen_productivity_1795812503448.jpg';
import promoAudioImg from '../assets/images/promo_screen_audio_1795812504131.jpg';
import type { ReviewItem, StoreApp } from '../types.ts';

export const BUNDLED_HERO_BANNER = heroBannerImg;

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const ICON_NABD = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0F766E"/><stop offset="100%" stop-color="#0D9488"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#g)"/><path d="M24 68h16l10-26 14 44 12-30 8 12h20" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
);

const ICON_BAYAN = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1D4ED8"/><stop offset="100%" stop-color="#2563EB"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#g)"/><path d="M32 36c0-4.4 3.6-8 8-8h48c4.4 0 8 3.6 8 8v56c0 4.4-3.6 8-8 8H40c-4.4 0-8-3.6-8-8V36z" fill="none" stroke="#FFFFFF" stroke-width="7"/><path d="M48 48h32M48 64h24M48 80h18" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/></svg>'
);

const ICON_LENS = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#18181B"/><stop offset="100%" stop-color="#3F3F46"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#g)"/><circle cx="64" cy="64" r="28" fill="none" stroke="#FFFFFF" stroke-width="7"/><circle cx="64" cy="64" r="12" fill="#34D399"/><circle cx="88" cy="40" r="4.5" fill="#FFFFFF"/></svg>'
);

const ASSET_MAP: Record<string, string> = {
  '/src/assets/images/hero_banner_store_1795812501251.jpg': heroBannerImg,
  './src/assets/images/hero_banner_store_1795812501251.jpg': heroBannerImg,
  '/media/store/hero_banner_store_1795812501251.jpg': heroBannerImg,
  './media/store/hero_banner_store_1795812501251.jpg': heroBannerImg,
  '/src/assets/images/app_icon_atlas_1795812501468.jpg': iconAtlasImg,
  './src/assets/images/app_icon_atlas_1795812501468.jpg': iconAtlasImg,
  '/media/store/app_icon_atlas_1795812501468.jpg': iconAtlasImg,
  './media/store/app_icon_atlas_1795812501468.jpg': iconAtlasImg,
  '/src/assets/images/app_icon_qalam_1795812502461.jpg': iconQalamImg,
  './src/assets/images/app_icon_qalam_1795812502461.jpg': iconQalamImg,
  '/media/store/app_icon_qalam_1795812502461.jpg': iconQalamImg,
  './media/store/app_icon_qalam_1795812502461.jpg': iconQalamImg,
  '/src/assets/images/app_icon_sada_1795812502435.jpg': iconSadaImg,
  './src/assets/images/app_icon_sada_1795812502435.jpg': iconSadaImg,
  '/media/store/app_icon_sada_1795812502435.jpg': iconSadaImg,
  './media/store/app_icon_sada_1795812502435.jpg': iconSadaImg,
  '/src/assets/images/promo_screen_productivity_1795812503448.jpg': promoProductivityImg,
  './src/assets/images/promo_screen_productivity_1795812503448.jpg': promoProductivityImg,
  '/media/store/promo_screen_productivity_1795812503448.jpg': promoProductivityImg,
  './media/store/promo_screen_productivity_1795812503448.jpg': promoProductivityImg,
  '/src/assets/images/promo_screen_audio_1795812504131.jpg': promoAudioImg,
  './src/assets/images/promo_screen_audio_1795812504131.jpg': promoAudioImg,
  '/media/store/promo_screen_audio_1795812504131.jpg': promoAudioImg,
  './media/store/promo_screen_audio_1795812504131.jpg': promoAudioImg,
  '/api/brand-icon/nabd': ICON_NABD,
  './api/brand-icon/nabd': ICON_NABD,
  '/media/store/brand_nabd.svg': ICON_NABD,
  './media/store/brand_nabd.svg': ICON_NABD,
  '/api/brand-icon/bayan': ICON_BAYAN,
  './api/brand-icon/bayan': ICON_BAYAN,
  '/media/store/brand_bayan.svg': ICON_BAYAN,
  './media/store/brand_bayan.svg': ICON_BAYAN,
  '/api/brand-icon/lens': ICON_LENS,
  './api/brand-icon/lens': ICON_LENS,
  '/media/store/brand_lens.svg': ICON_LENS,
  './media/store/brand_lens.svg': ICON_LENS,
};

export function resolveAssetUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (ASSET_MAP[trimmed]) return ASSET_MAP[trimmed];

  if (/^(data:|blob:|https?:\/\/)/i.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/^\/Play55(?=\/)/i, '');
  if (ASSET_MAP[normalized]) return ASSET_MAP[normalized];

  if (normalized.startsWith('/uploads/')) {
    return `.${normalized}`;
  }
  if (normalized.startsWith('uploads/')) {
    return `./${normalized}`;
  }
  if (normalized.startsWith('/media/')) {
    return `.${normalized}`;
  }
  if (normalized.startsWith('media/')) {
    return `./${normalized}`;
  }
  if (normalized.startsWith('/assets/')) {
    return `.${normalized}`;
  }
  if (normalized.startsWith('assets/')) {
    return `./${normalized}`;
  }
  return normalized;
}

export const FALLBACK_APPS: StoreApp[] = [
  {
    id: 'app-atlas-tasks',
    name: 'أطلس المهام والتخطيط',
    developer: 'استوديو مدار للتقنية',
    category: 'الإنتاجية',
    shortDescription: 'تنظيم المهام اليومية والمشاريع الجماعية بتجربة سريعة ومزامنة فورية بدون اتصال.',
    fullDescription:
      'تطبيق أطلس هو مساحتك المتكاملة لإدارة المهام اليومية، جدولة المواعيد، وتتبع المشاريع الشخصية ومشاريع العمل بسلاسة تامة.\n\nالمميزات الرئيسية:\n• تقويم ذكي يدعم التقويمين الهجري والميلادي مع تنبيهات دقيقة.\n• قوائم مهام متدرجة مع إمكانية العمل الكامل دون اتصال بالإنترنت.\n• تصميم مادي مريح للعين يدعم الوضعين الفاتح والداكن.\n• خفيف الوزن ولا يستهلك البطارية في الخلفية.',
    whatsNew: 'تحسين سرعة فتح القوائم بنسبة 40%، وإضافة ويدجت تفاعلي للشاشة الرئيسية على أندرويد 14.',
    packageName: 'com.madar.atlas.tasks',
    versionName: '3.4.2',
    versionCode: '342',
    minAndroid: 'Android 8.0+',
    ageRating: '+3',
    sizeMB: 18.6,
    iconUrl: iconAtlasImg,
    screenshots: [promoProductivityImg, heroBannerImg],
    apkFilename: '',
    hasCustomApk: false,
    permissionsCount: 4,
    downloads: 84200,
    averageRating: 4.8,
    reviewCount: 4,
    ratingDistribution: { 5: 3, 4: 1, 3: 0, 2: 0, 1: 0 },
    featured: true,
    createdAt: '2026-10-13T20:53:25.957Z',
    updatedAt: '2026-11-25T20:53:25.957Z',
  },
  {
    id: 'app-qalam-docs',
    name: 'قلم للماسح والملفات',
    developer: 'دار البيان الرقمية',
    category: 'الأعمال',
    shortDescription: 'مسح المستندات ضوئياً بدقة فائقة وتحويلها إلى PDF مع التوقيع الإلكتروني الفوري.',
    fullDescription:
      'حوّل كاميرا هاتفك إلى ماسح ضوئي احترافي للمستندات والفواتير والعقود. يتعرف تطبيق قلم تلقائياً على حواف الورق ويصحح الإضاءة والمنظور خلال ثوانٍ.\n\nالمميزات الرئيسية:\n• قص تلقائي ذكي وتنقية النصوص العربية والإنجليزية.\n• دمج وتقسيم ملفات PDF وحمايتها بكلمة مرور.\n• إضافة التوقيع اليدوي والأختام الرقمية مباشرة على المستندات.\n• حفظ ومشاركة فورية بدون علامات مائية مزعجة.',
    whatsNew: 'إضافة وضع المسح المتعدد للكتب والمجلات وتحسين دقة التعرف على الحواف.',
    packageName: 'com.bayan.qalam.scanner',
    versionName: '2.8.0',
    versionCode: '280',
    minAndroid: 'Android 9.0+',
    ageRating: '+3',
    sizeMB: 24.3,
    iconUrl: iconQalamImg,
    screenshots: [promoProductivityImg],
    apkFilename: '',
    hasCustomApk: false,
    permissionsCount: 5,
    downloads: 61500,
    averageRating: 4.7,
    reviewCount: 3,
    ratingDistribution: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 },
    featured: false,
    createdAt: '2026-10-28T20:53:25.957Z',
    updatedAt: '2026-11-23T20:53:25.957Z',
  },
  {
    id: 'app-sada-audio',
    name: 'صدى بودكاست واستوديو الصوت',
    developer: 'موجة للوسائط',
    category: 'الصوتيات',
    shortDescription: 'مشغل بودكاست ذكي ومسجل صوت احترافي مع عزل الضوضاء ومعادل صوتي متقدم.',
    fullDescription:
      'استمتع بالاستماع إلى آلاف الحلقات الصوتية والكتب المسموعة، أو سجّل حلقاتك الخاصة بجودة الاستوديو مباشرة من هاتفك.\n\nالمميزات الرئيسية:\n• عزل ذكي للضوضاء المحيطة أثناء التسجيل.\n• تحميل تلقائي للحلقات الجديدة للاستماع دون إنترنت.\n• مؤقت نوم ذكي وسرعات تشغيل متدرجة.\n• دعم كامل للتحكم عبر سماعات البلوتوث والسيارة.',
    whatsNew: 'دعم صوتيات Lossless وتحديث واجهة المشغل المصغر.',
    packageName: 'com.mawja.sada.audio',
    versionName: '4.1.5',
    versionCode: '415',
    minAndroid: 'Android 8.0+',
    ageRating: '+12',
    sizeMB: 31.2,
    iconUrl: iconSadaImg,
    screenshots: [promoAudioImg],
    apkFilename: '',
    hasCustomApk: false,
    permissionsCount: 6,
    downloads: 112400,
    averageRating: 4.7,
    reviewCount: 3,
    ratingDistribution: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 },
    featured: false,
    createdAt: '2026-09-28T20:53:25.957Z',
    updatedAt: '2026-11-26T20:53:25.957Z',
  },
  {
    id: 'app-nabd-finance',
    name: 'نبض لإدارة المصروفات',
    developer: 'حلول ذكية المالية',
    category: 'الأدوات',
    shortDescription: 'تتبع الميزانية الشهرية، الفواتير، والأهداف الادخارية برسوم بيانية واضحة وآمنة.',
    fullDescription:
      'تطبيق نبض يساعدك على فهم أين تذهب أموالك شهرياً وتحديد أهداف ادخارية واقعية دون تعقيد محاسبي.\n\n• تصنيف تلقائي للمصروفات اليومية.\n• تقارير شهرية مفصلة قابلة للتصدير.\n• حماية بالبصمة وبيانات مشفرة محلياً على جهازك بالكامل.',
    whatsNew: 'إضافة ميزة الميزانيات المشتركة للعائلة وتنبيهات الفواتير الدورية.',
    packageName: 'com.smartfin.nabd.budget',
    versionName: '1.9.4',
    versionCode: '194',
    minAndroid: 'Android 8.0+',
    ageRating: '+3',
    sizeMB: 14.8,
    iconUrl: ICON_NABD,
    screenshots: [promoProductivityImg],
    apkFilename: '',
    hasCustomApk: false,
    permissionsCount: 3,
    downloads: 43900,
    averageRating: 4.5,
    reviewCount: 2,
    ratingDistribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
    featured: false,
    createdAt: '2026-11-07T20:53:25.957Z',
    updatedAt: '2026-11-22T20:53:25.957Z',
  },
  {
    id: 'app-bayan-learn',
    name: 'بيان للغات والبطاقات الذكية',
    developer: 'أكاديمية أفق التعليمية',
    category: 'التعليم',
    shortDescription: 'تعلّم اللغات والمفاهيم العلمية بنظام التكرار المتباعد والنطق الصوتي الدقيق.',
    fullDescription:
      'اعتمد على منهجية التكرار المتباعد المثبتة علمياً لتثبيت المفردات والقواعد في الذاكرة طويلة المدى خلال 10 دقائق يومياً فقط.\n\n• أكثر من 5,000 بطاقة تعليمية مصنفة حسب المستوى.\n• تحديات يومية وإحصائيات دقيقة للتقدم.\n• يعمل بسلاسة دون الحاجة لاتصال دائم بالإنترنت.',
    whatsNew: 'إضافة مسار تعلم البرمجة والمصطلحات التقنية.',
    packageName: 'com.ofoq.bayan.learn',
    versionName: '2.2.1',
    versionCode: '221',
    minAndroid: 'Android 7.0+',
    ageRating: '+3',
    sizeMB: 22.0,
    iconUrl: ICON_BAYAN,
    screenshots: [heroBannerImg],
    apkFilename: '',
    hasCustomApk: false,
    permissionsCount: 2,
    downloads: 37800,
    averageRating: 4.5,
    reviewCount: 2,
    ratingDistribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
    featured: false,
    createdAt: '2026-11-12T20:53:25.957Z',
    updatedAt: '2026-11-24T20:53:25.957Z',
  },
  {
    id: 'app-mirat-camera',
    name: 'عدسة برو للتصوير اليدوي',
    developer: 'استوديو ضوء للبصريات',
    category: 'التصوير',
    shortDescription: 'تحكم يدوي كامل بسرعة الغالق، ISO، والتصوير بصيغة RAW مع فلاتر سينمائية.',
    fullDescription:
      'أطلق قدرات كاميرا هاتفك الحقيقية مع تحكم احترافي كامل في التعريض، التركيز البؤري اليدوي، وتصوير الفيديو بمعدل إطارات ثابت.\n\n• دعم صيغة DNG RAW غير المضغوطة.\n• رسم بياني حي للإضاءة (Histogram).\n• فلاتر ألوان متوازنة مصممة للتصوير المعماري والطبيعي.',
    whatsNew: 'تحسين معالجة الإضاءة الليلية وتقليل التشويش اللوني.',
    packageName: 'com.daw.lenspro.camera',
    versionName: '5.0.2',
    versionCode: '502',
    minAndroid: 'Android 10+',
    ageRating: '+3',
    sizeMB: 36.4,
    iconUrl: ICON_LENS,
    screenshots: [heroBannerImg],
    apkFilename: '',
    hasCustomApk: false,
    permissionsCount: 4,
    downloads: 52100,
    averageRating: 5.0,
    reviewCount: 2,
    ratingDistribution: { 5: 2, 4: 0, 3: 0, 2: 0, 1: 0 },
    featured: false,
    createdAt: '2026-11-17T20:53:25.957Z',
    updatedAt: '2026-11-27T20:53:25.957Z',
  },
];

export const FALLBACK_REVIEWS: Record<string, ReviewItem[]> = {
  'app-atlas-tasks': [
    {
      id: 'rev-1',
      appId: 'app-atlas-tasks',
      authorName: 'عبدالله المنصور',
      rating: 5,
      comment: 'أفضل تطبيق لتنظيم مهام عملي اليومية، خفيف جداً على الهاتف والواجهة العربية متقنة للغاية.',
      createdAt: '2026-11-24T12:00:00.000Z',
      helpfulCount: 28,
    },
    {
      id: 'rev-2',
      appId: 'app-atlas-tasks',
      authorName: 'سارة العتيبي',
      rating: 5,
      comment: 'التثبيت المباشر كان سريعاً، وأعجبني دعم التقويم الهجري والميلادي مع التنبيهات الدقيقة.',
      createdAt: '2026-11-20T12:00:00.000Z',
      helpfulCount: 15,
    },
    {
      id: 'rev-3',
      appId: 'app-atlas-tasks',
      authorName: 'خالد الحربي',
      rating: 4,
      comment: 'ممتاز ومستقر جداً، أتمنى إضافة مزامنة مع تقويم العمل في التحديث القادم.',
      createdAt: '2026-11-15T12:00:00.000Z',
      helpfulCount: 9,
    },
    {
      id: 'rev-4',
      appId: 'app-atlas-tasks',
      authorName: 'نورة القحطاني',
      rating: 5,
      comment: 'أستخدمه يومياً لمتابعة مشاريع الفريق. لا غنى عنه في هاتفي.',
      createdAt: '2026-11-09T12:00:00.000Z',
      helpfulCount: 6,
    },
  ],
  'app-qalam-docs': [
    {
      id: 'rev-5',
      appId: 'app-qalam-docs',
      authorName: 'طارق الزهراني',
      rating: 5,
      comment: 'جودة المسح الضوئي مبهرة وتغنيني تماماً عن الماسح المكتبي.',
      createdAt: '2026-11-23T12:00:00.000Z',
      helpfulCount: 19,
    },
    {
      id: 'rev-6',
      appId: 'app-qalam-docs',
      authorName: 'منى الشمري',
      rating: 5,
      comment: 'ميزة التوقيع على العقود وحفظها بصيغة PDF بدون علامة مائية ممتازة جداً.',
      createdAt: '2026-11-18T12:00:00.000Z',
      helpfulCount: 11,
    },
    {
      id: 'rev-7',
      appId: 'app-qalam-docs',
      authorName: 'وليد الدوسري',
      rating: 4,
      comment: 'دقيق وسريع، خاصية قص الحواف تعمل بكفاءة عالية.',
      createdAt: '2026-11-13T12:00:00.000Z',
      helpfulCount: 4,
    },
  ],
  'app-sada-audio': [
    {
      id: 'rev-8',
      appId: 'app-sada-audio',
      authorName: 'فيصل الغامدي',
      rating: 5,
      comment: 'عزل الضوضاء أثناء التسجيل خارق فعلاً وجودة الصوت نقية.',
      createdAt: '2026-11-25T12:00:00.000Z',
      helpfulCount: 31,
    },
    {
      id: 'rev-9',
      appId: 'app-sada-audio',
      authorName: 'ريم السالم',
      rating: 5,
      comment: 'تصميم المشغل مريح جداً أثناء القيادة والتحكم بالسرعة ممتاز.',
      createdAt: '2026-11-21T12:00:00.000Z',
      helpfulCount: 12,
    },
    {
      id: 'rev-10',
      appId: 'app-sada-audio',
      authorName: 'أحمد المالكي',
      rating: 4,
      comment: 'تطبيق رائع للبودكاست، يعمل بسلاسة على أندرويد 14.',
      createdAt: '2026-11-16T12:00:00.000Z',
      helpfulCount: 5,
    },
  ],
  'app-nabd-finance': [
    {
      id: 'rev-11',
      appId: 'app-nabd-finance',
      authorName: 'ياسر العنزي',
      rating: 5,
      comment: 'ساعدني على ضبط مصاريف الشهر بوضوح وبساطة.',
      createdAt: '2026-11-22T12:00:00.000Z',
      helpfulCount: 14,
    },
    {
      id: 'rev-12',
      appId: 'app-nabd-finance',
      authorName: 'هند البقمي',
      rating: 4,
      comment: 'الرسوم البيانية جميلة وسهلة الفهم، وتشفير البيانات محلياً مريح نفسياً.',
      createdAt: '2026-11-19T12:00:00.000Z',
      helpfulCount: 7,
    },
  ],
  'app-bayan-learn': [
    {
      id: 'rev-13',
      appId: 'app-bayan-learn',
      authorName: 'ماجد السبيعي',
      rating: 5,
      comment: 'نظام التكرار المتباعد فرق معي كثيراً في حفظ المصطلحات.',
      createdAt: '2026-11-23T12:00:00.000Z',
      helpfulCount: 10,
    },
    {
      id: 'rev-14',
      appId: 'app-bayan-learn',
      authorName: 'لينا الشهري',
      rating: 4,
      comment: 'محتوى مرتب وتجربة مستخدم راقية ومجانية.',
      createdAt: '2026-11-17T12:00:00.000Z',
      helpfulCount: 6,
    },
  ],
  'app-mirat-camera': [
    {
      id: 'rev-15',
      appId: 'app-mirat-camera',
      authorName: 'زياد الفهد',
      rating: 5,
      comment: 'تصوير RAW مع التحكم اليدوي في سرعة الغالق أعطى صوري نقلة نوعية.',
      createdAt: '2026-11-26T12:00:00.000Z',
      helpfulCount: 22,
    },
    {
      id: 'rev-16',
      appId: 'app-mirat-camera',
      authorName: 'دانة الرشيد',
      rating: 5,
      comment: 'الألوان السينمائية في التطبيق متوازنة وطبيعية جداً.',
      createdAt: '2026-11-22T12:00:00.000Z',
      helpfulCount: 13,
    },
  ],
};
