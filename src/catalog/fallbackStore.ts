import heroBannerImg from '../assets/images/hero_banner_store_1795812501251.jpg';
import iconAtlasImg from '../assets/images/app_icon_atlas_1795812501468.jpg';
import iconQalamImg from '../assets/images/app_icon_qalam_1795812502461.jpg';
import iconSadaImg from '../assets/images/app_icon_sada_1795812502435.jpg';
import promoProductivityImg from '../assets/images/promo_screen_productivity_1795812503448.jpg';
import promoAudioImg from '../assets/images/promo_screen_audio_1795812504131.jpg';
import type { ReviewItem, StoreApp } from '../types.ts';

export const BUNDLED_HERO_BANNER = heroBannerImg;

const ASSET_MAP: Record<string, string> = {
  '/src/assets/images/hero_banner_store_1795812501251.jpg': heroBannerImg,
  '/src/assets/images/app_icon_atlas_1795812501468.jpg': iconAtlasImg,
  '/src/assets/images/app_icon_qalam_1795812502461.jpg': iconQalamImg,
  '/src/assets/images/app_icon_sada_1795812502435.jpg': iconSadaImg,
  '/src/assets/images/promo_screen_productivity_1795812503448.jpg': promoProductivityImg,
  '/src/assets/images/promo_screen_audio_1795812504131.jpg': promoAudioImg,
};

export function resolveAssetUrl(url: string): string {
  return ASSET_MAP[url] || url;
}

export const FALLBACK_APPS: StoreApp[] = [
  {
    id: 'app-atlas-tasks',
    name: 'أطلس المهام والتخطيط',
    developer: 'استوديو مدار للتقنية',
    category: 'الإنتاجية',
    shortDescription: 'تنظيم المهام اليومية والمشاريع الجماعية بتجربة سريعة ومزامنة فورية بدون اتصال.',
    fullDescription:
      'تطبيق أطلس هو مساحتك المتكاملة لإدارة المهام اليومية، جدولة المواعيد، وتتبع المشاريع الشخصية ومشاريع العمل بسلاسة تامة.',
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
    reviewCount: 2,
    ratingDistribution: { 5: 2, 4: 0, 3: 0, 2: 0, 1: 0 },
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
      'حوّل كاميرا هاتفك إلى ماسح ضوئي احترافي للمستندات والفواتير والعقود بدقة عالية وبدون علامات مائية.',
    whatsNew: 'إضافة وضع المسح المتعدد للكتب والمجلات.',
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
    reviewCount: 1,
    ratingDistribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
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
      'استمتع بالاستماع إلى آلاف الحلقات الصوتية والكتب المسموعة، أو سجّل حلقاتك الخاصة بجودة الاستوديو مباشرة من هاتفك.',
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
    reviewCount: 1,
    ratingDistribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
    featured: false,
    createdAt: '2026-09-28T20:53:25.957Z',
    updatedAt: '2026-11-26T20:53:25.957Z',
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
  ],
};
