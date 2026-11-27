import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import type { AppCategory, ReviewItem, StoreApp } from './src/types.ts';

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const APKS_DIR = path.join(UPLOADS_DIR, 'apks');
const ICONS_DIR = path.join(UPLOADS_DIR, 'icons');
const SCREENSHOTS_DIR = path.join(UPLOADS_DIR, 'screenshots');

for (const dir of [DATA_DIR, UPLOADS_DIR, APKS_DIR, ICONS_DIR, SCREENSHOTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

interface FirebaseAppletConfig {
  projectId?: string;
}

function getFirebaseProjectId(): string {
  const cfgPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as FirebaseAppletConfig;
    if (raw.projectId && raw.projectId !== 'remixed-project-id') {
      return raw.projectId;
    }
  }
  return '';
}

const firebaseProjectId = getFirebaseProjectId();
const adminApp = firebaseProjectId
  ? getApps().length
    ? getApp()
    : initializeApp({ projectId: firebaseProjectId })
  : null;
const adminAuth = adminApp ? getAdminAuth(adminApp) : null;

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

interface StoredUser {
  uid: string;
  displayName: string;
  email: string;
  salt: string;
  passwordHash: string;
  createdAt: string;
}

function loadUsers(): StoredUser[] {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
  } catch {
    return [];
  }
}

let userWriteQueue = Promise.resolve();
function saveUsers(usersList: StoredUser[]): Promise<void> {
  userWriteQueue = userWriteQueue.then(async () => {
    const tmp = `${USERS_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(usersList, null, 2), 'utf8');
    await fs.promises.rename(tmp, USERS_FILE);
  });
  return userWriteQueue;
}

let usersDb = loadUsers();

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

interface CustomTokenPayload {
  uid: string;
  email: string;
  name: string;
  exp: number;
}

function signSessionToken(user: StoredUser): string {
  const payload: CustomTokenPayload = {
    uid: user.uid,
    email: user.email,
    name: user.displayName,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `dev1.${encoded}.${sig}`;
}

function verifySessionToken(token: string): VerifiedDeveloper | null {
  if (!token.startsWith('dev1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as CustomTokenPayload;
    if (!payload.uid || !payload.email || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    return {
      uid: payload.uid,
      email: payload.email,
      name: payload.name || '',
      provider: 'manual',
    };
  } catch {
    return null;
  }
}

interface VerifiedDeveloper {
  uid: string;
  email: string;
  name: string;
  provider: 'manual' | 'google';
}

async function verifyDeveloperRequest(req: express.Request): Promise<VerifiedDeveloper | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  if (token.startsWith('dev1.')) {
    return verifySessionToken(token);
  }

  if (!adminAuth) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email || '',
      name: typeof decoded.name === 'string' ? decoded.name : '',
      provider: 'google',
    };
  } catch {
    return null;
  }
}

interface StoreDatabase {
  apps: StoreApp[];
  reviews: ReviewItem[];
}

function computeRatingStats(reviews: ReviewItem[]) {
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

function buildInitialSeed(): StoreDatabase {
  const now = new Date().toISOString();
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

  const apps: StoreApp[] = [
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
      iconUrl: '/src/assets/images/app_icon_atlas_1795812501468.jpg',
      screenshots: [
        '/src/assets/images/promo_screen_productivity_1795812503448.jpg',
        '/src/assets/images/hero_banner_store_1795812501251.jpg',
      ],
      apkFilename: '',
      hasCustomApk: false,
      permissionsCount: 4,
      downloads: 84200,
      averageRating: 4.8,
      reviewCount: 4,
      ratingDistribution: { 5: 3, 4: 1, 3: 0, 2: 0, 1: 0 },
      featured: true,
      createdAt: daysAgo(45),
      updatedAt: daysAgo(2),
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
      iconUrl: '/src/assets/images/app_icon_qalam_1795812502461.jpg',
      screenshots: [
        '/src/assets/images/promo_screen_productivity_1795812503448.jpg',
      ],
      apkFilename: '',
      hasCustomApk: false,
      permissionsCount: 5,
      downloads: 61500,
      averageRating: 4.7,
      reviewCount: 3,
      ratingDistribution: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 },
      featured: false,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(4),
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
      iconUrl: '/src/assets/images/app_icon_sada_1795812502435.jpg',
      screenshots: [
        '/src/assets/images/promo_screen_audio_1795812504131.jpg',
      ],
      apkFilename: '',
      hasCustomApk: false,
      permissionsCount: 6,
      downloads: 112400,
      averageRating: 4.7,
      reviewCount: 3,
      ratingDistribution: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 },
      featured: false,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(1),
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
      iconUrl: '/api/brand-icon/nabd',
      screenshots: [
        '/src/assets/images/promo_screen_productivity_1795812503448.jpg',
      ],
      apkFilename: '',
      hasCustomApk: false,
      permissionsCount: 3,
      downloads: 43900,
      averageRating: 4.5,
      reviewCount: 2,
      ratingDistribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
      featured: false,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(5),
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
      iconUrl: '/api/brand-icon/bayan',
      screenshots: [
        '/src/assets/images/hero_banner_store_1795812501251.jpg',
      ],
      apkFilename: '',
      hasCustomApk: false,
      permissionsCount: 2,
      downloads: 37800,
      averageRating: 4.5,
      reviewCount: 2,
      ratingDistribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
      featured: false,
      createdAt: daysAgo(15),
      updatedAt: daysAgo(3),
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
      iconUrl: '/api/brand-icon/lens',
      screenshots: [
        '/src/assets/images/hero_banner_store_1795812501251.jpg',
      ],
      apkFilename: '',
      hasCustomApk: false,
      permissionsCount: 4,
      downloads: 52100,
      averageRating: 5.0,
      reviewCount: 2,
      ratingDistribution: { 5: 2, 4: 0, 3: 0, 2: 0, 1: 0 },
      featured: false,
      createdAt: daysAgo(10),
      updatedAt: now,
    },
  ];

  const reviews: ReviewItem[] = [
    {
      id: 'rev-1',
      appId: 'app-atlas-tasks',
      authorName: 'عبدالله المنصور',
      rating: 5,
      comment: 'أفضل تطبيق لتنظيم مهام عملي اليومية، خفيف جداً على الهاتف والواجهة العربية متقنة للغاية.',
      createdAt: daysAgo(3),
      helpfulCount: 28,
    },
    {
      id: 'rev-2',
      appId: 'app-atlas-tasks',
      authorName: 'سارة العتيبي',
      rating: 5,
      comment: 'التثبيت المباشر كان سريعاً، وأعجبني دعم التقويم الهجري والميلادي مع التنبيهات الدقيقة.',
      createdAt: daysAgo(7),
      helpfulCount: 15,
    },
    {
      id: 'rev-3',
      appId: 'app-atlas-tasks',
      authorName: 'خالد الحربي',
      rating: 4,
      comment: 'ممتاز ومستقر جداً، أتمنى إضافة مزامنة مع تقويم العمل في التحديث القادم.',
      createdAt: daysAgo(12),
      helpfulCount: 9,
    },
    {
      id: 'rev-4',
      appId: 'app-atlas-tasks',
      authorName: 'نورة القحطاني',
      rating: 5,
      comment: 'أستخدمه يومياً لمتابعة مشاريع الفريق. لا غنى عنه في هاتفي.',
      createdAt: daysAgo(18),
      helpfulCount: 6,
    },
    {
      id: 'rev-5',
      appId: 'app-qalam-docs',
      authorName: 'طارق الزهراني',
      rating: 5,
      comment: 'جودة المسح الضوئي مبهرة وتغنيني تماماً عن الماسح المكتبي.',
      createdAt: daysAgo(4),
      helpfulCount: 19,
    },
    {
      id: 'rev-6',
      appId: 'app-qalam-docs',
      authorName: 'منى الشمري',
      rating: 5,
      comment: 'ميزة التوقيع على العقود وحفظها بصيغة PDF بدون علامة مائية ممتازة جداً.',
      createdAt: daysAgo(9),
      helpfulCount: 11,
    },
    {
      id: 'rev-7',
      appId: 'app-qalam-docs',
      authorName: 'وليد الدوسري',
      rating: 4,
      comment: 'دقيق وسريع، خاصية قص الحواف تعمل بكفاءة عالية.',
      createdAt: daysAgo(14),
      helpfulCount: 4,
    },
    {
      id: 'rev-8',
      appId: 'app-sada-audio',
      authorName: 'فيصل الغامدي',
      rating: 5,
      comment: 'عزل الضوضاء أثناء التسجيل خارق فعلاً وجودة الصوت نقية.',
      createdAt: daysAgo(2),
      helpfulCount: 31,
    },
    {
      id: 'rev-9',
      appId: 'app-sada-audio',
      authorName: 'ريم السالم',
      rating: 5,
      comment: 'تصميم المشغل مريح جداً أثناء القيادة والتحكم بالسرعة ممتاز.',
      createdAt: daysAgo(6),
      helpfulCount: 12,
    },
    {
      id: 'rev-10',
      appId: 'app-sada-audio',
      authorName: 'أحمد المالكي',
      rating: 4,
      comment: 'تطبيق رائع للبودكاست، يعمل بسلاسة على أندرويد 14.',
      createdAt: daysAgo(11),
      helpfulCount: 5,
    },
    {
      id: 'rev-11',
      appId: 'app-nabd-finance',
      authorName: 'ياسر العنزي',
      rating: 5,
      comment: 'ساعدني على ضبط مصاريف الشهر بوضوح وبساطة.',
      createdAt: daysAgo(5),
      helpfulCount: 14,
    },
    {
      id: 'rev-12',
      appId: 'app-nabd-finance',
      authorName: 'هند البقمي',
      rating: 4,
      comment: 'الرسوم البيانية جميلة وسهلة الفهم، وتشفير البيانات محلياً مريح نفسياً.',
      createdAt: daysAgo(8),
      helpfulCount: 7,
    },
    {
      id: 'rev-13',
      appId: 'app-bayan-learn',
      authorName: 'ماجد السبيعي',
      rating: 5,
      comment: 'نظام التكرار المتباعد فرق معي كثيراً في حفظ المصطلحات.',
      createdAt: daysAgo(4),
      helpfulCount: 10,
    },
    {
      id: 'rev-14',
      appId: 'app-bayan-learn',
      authorName: 'لينا الشهري',
      rating: 4,
      comment: 'محتوى مرتب وتجربة مستخدم راقية ومجانية.',
      createdAt: daysAgo(10),
      helpfulCount: 6,
    },
    {
      id: 'rev-15',
      appId: 'app-mirat-camera',
      authorName: 'زياد الفهد',
      rating: 5,
      comment: 'تصوير RAW مع التحكم اليدوي في سرعة الغالق أعطى صوري نقلة نوعية.',
      createdAt: daysAgo(1),
      helpfulCount: 22,
    },
    {
      id: 'rev-16',
      appId: 'app-mirat-camera',
      authorName: 'دانة الرشيد',
      rating: 5,
      comment: 'الألوان السينمائية في التطبيق متوازنة وطبيعية جداً.',
      createdAt: daysAgo(5),
      helpfulCount: 13,
    },
  ];

  // Sync exact calculated stats
  for (const app of apps) {
    const appReviews = reviews.filter((r) => r.appId === app.id);
    const stats = computeRatingStats(appReviews);
    app.averageRating = stats.averageRating;
    app.reviewCount = stats.reviewCount;
    app.ratingDistribution = stats.ratingDistribution;
  }

  return { apps, reviews };
}

function loadStore(): StoreDatabase {
  if (!fs.existsSync(STORE_FILE)) {
    const initial = buildInitialSeed();
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as StoreDatabase;
    if (!Array.isArray(parsed.apps) || !Array.isArray(parsed.reviews)) {
      throw new Error('Invalid store format');
    }
    return parsed;
  } catch {
    const initial = buildInitialSeed();
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
}

let writeQueue = Promise.resolve();
function saveStore(db: StoreDatabase): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${STORE_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fs.promises.rename(tmp, STORE_FILE);
  });
  return writeQueue;
}

let db = loadStore();

function safeSlug(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'app-package';
}

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === 'apk') cb(null, APKS_DIR);
    else if (file.fieldname === 'icon') cb(null, ICONS_DIR);
    else cb(null, SCREENSHOTS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || (file.fieldname === 'apk' ? '.apk' : '.png');
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 150 * 1024 * 1024, // 150 MB max APK
    files: 12,
  },
});

async function buildDynamicApkBuffer(app: StoreApp): Promise<Buffer> {
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
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function renderBrandIconSvg(slug: string): string {
  const palettes: Record<string, { bg1: string; bg2: string; path: string }> = {
    nabd: {
      bg1: '#0F766E',
      bg2: '#0D9488',
      path: '<path d="M24 68h16l10-26 14 44 12-30 8 12h20" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    bayan: {
      bg1: '#1D4ED8',
      bg2: '#2563EB',
      path: '<path d="M32 36c0-4.4 3.6-8 8-8h48c4.4 0 8 3.6 8 8v56c0 4.4-3.6 8-8 8H40c-4.4 0-8-3.6-8-8V36z" fill="none" stroke="#FFFFFF" stroke-width="7"/><path d="M48 48h32M48 64h24M48 80h18" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/>',
    },
    lens: {
      bg1: '#18181B',
      bg2: '#3F3F46',
      path: '<circle cx="64" cy="64" r="28" fill="none" stroke="#FFFFFF" stroke-width="7"/><circle cx="64" cy="64" r="12" fill="#34D399"/><circle cx="88" cy="40" r="4.5" fill="#FFFFFF"/>',
    },
  };
  const cfg = palettes[slug] || palettes.nabd;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${cfg.bg1}"/>
        <stop offset="100%" stop-color="${cfg.bg2}"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="28" fill="url(#g)"/>
    ${cfg.path}
  </svg>`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Static uploaded media
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Manual Developer Auth: Register
  app.post('/api/auth/register', async (req, res) => {
    const body = req.body as { name?: unknown; email?: unknown; password?: unknown };
    const displayName = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (displayName.length < 2 || displayName.length > 80) {
      res.status(400).json({ error: 'يرجى إدخال الاسم الكامل (حرفان على الأقل)' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
      res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح' });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل' });
      return;
    }

    if (usersDb.some((u) => u.email === email)) {
      res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل مسبقاً، يرجى تسجيل الدخول' });
      return;
    }

    const { salt, hash } = hashPassword(password);
    const newUser: StoredUser = {
      uid: `local-${crypto.randomBytes(8).toString('hex')}`,
      displayName,
      email,
      salt,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };

    usersDb.push(newUser);
    await saveUsers(usersDb);

    const token = signSessionToken(newUser);
    res.status(201).json({
      token,
      user: {
        uid: newUser.uid,
        displayName: newUser.displayName,
        email: newUser.email,
        photoURL: null,
        provider: 'manual',
      },
    });
  });

  // Manual Developer Auth: Login
  app.post('/api/auth/login', (req, res) => {
    const body = req.body as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور' });
      return;
    }

    const found = usersDb.find((u) => u.email === email);
    if (!found || !verifyPassword(password, found.salt, found.passwordHash)) {
      res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
      return;
    }

    const token = signSessionToken(found);
    res.json({
      token,
      user: {
        uid: found.uid,
        displayName: found.displayName,
        email: found.email,
        photoURL: null,
        provider: 'manual',
      },
    });
  });

  // Verify current session
  app.get('/api/auth/me', async (req, res) => {
    const verified = await verifyDeveloperRequest(req);
    if (!verified) {
      res.status(401).json({ error: 'الجلسة غير صالحة' });
      return;
    }
    res.json({
      user: {
        uid: verified.uid,
        displayName: verified.name || verified.email,
        email: verified.email,
        photoURL: null,
        provider: verified.provider,
      },
    });
  });

  // Generated SVG icons for secondary seeded apps
  app.get('/api/brand-icon/:slug', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(renderBrandIconSvg(req.params.slug));
  });

  // Sample valid APK archive for testing icon + manifest extraction in Upload Studio
  app.get('/api/sample-apk', async (_req, res) => {
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
    const atlasIconPath = path.join(ROOT_DIR, 'src/assets/images/app_icon_atlas_1795812501468.jpg');
    if (fs.existsSync(atlasIconPath)) {
      zip.file('res/mipmap-xxxhdpi-v4/ic_launcher.png', fs.readFileSync(atlasIconPath));
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="noor-smartnotes-v2.4.0.apk"');
    res.send(buf);
  });

  // List apps with search, category, and sorting
  app.get('/api/apps', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const category = String(req.query.category || '').trim();
    const sort = String(req.query.sort || 'popular').trim();

    let list = [...db.apps];
    if (category && category !== 'الكل') {
      list = list.filter((a) => a.category === category);
    }
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.developer.toLowerCase().includes(q) ||
          a.packageName.toLowerCase().includes(q) ||
          a.shortDescription.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q)
      );
    }

    if (sort === 'rating') {
      list.sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount);
    } else if (sort === 'newest') {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      list.sort((a, b) => b.downloads - a.downloads);
    }

    res.json({ apps: list });
  });

  // Get single app + its reviews
  app.get('/api/apps/:id', (req, res) => {
    const found = db.apps.find((a) => a.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'التطبيق غير موجود' });
      return;
    }
    const appReviews = db.reviews
      .filter((r) => r.appId === found.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ app: found, reviews: appReviews });
  });

  // Publish new app with APK, extracted/custom icon, and promotional screenshots (requires Google Sign-In)
  app.post(
    '/api/apps',
    async (req, res, next) => {
      const developerUser = await verifyDeveloperRequest(req);
      if (!developerUser) {
        res.status(401).json({ error: 'يجب تسجيل الدخول بحساب المطور أولاً قبل رفع التطبيق' });
        return;
      }
      res.locals.developerUser = developerUser;
      next();
    },
    upload.fields([
      { name: 'apk', maxCount: 1 },
      { name: 'icon', maxCount: 1 },
      { name: 'screenshots', maxCount: 8 },
    ]),
    async (req, res) => {
      try {
        const developerUser = res.locals.developerUser as VerifiedDeveloper;
        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const apkFile = files?.apk?.[0];
        if (!apkFile) {
          res.status(400).json({ error: 'يرجى إرفاق ملف APK الخاص بالتطبيق' });
          return;
        }

        const ALLOWED_CATEGORIES: AppCategory[] = [
          'الإنتاجية',
          'الأدوات',
          'الصوتيات',
          'التعليم',
          'الأعمال',
          'التصوير',
          'الألعاب',
        ];
        const body = req.body as Record<string, string>;
        const name = (body.name || '').trim();
        const developer = (body.developer || '').trim() || developerUser.name || 'مطور مستقل';
        const rawCategory = (body.category || '').trim() as AppCategory;
        const category: AppCategory = ALLOWED_CATEGORIES.includes(rawCategory)
          ? rawCategory
          : 'الإنتاجية';
        const shortDescription = (body.shortDescription || '').trim();
        const fullDescription = (body.fullDescription || '').trim() || shortDescription;

        if (!name || !shortDescription) {
          res.status(400).json({ error: 'يرجى إدخال اسم التطبيق والوصف المختصر' });
          return;
        }

        const iconFile = files?.icon?.[0];
        let iconUrl = '/api/brand-icon/nabd';

        if (iconFile) {
          iconUrl = `/uploads/icons/${iconFile.filename}`;
        } else {
          // Server-side fallback: attempt to extract icon directly from uploaded APK
          try {
            const apkBuffer = await fs.promises.readFile(apkFile.path);
            const zip = await JSZip.loadAsync(apkBuffer);
            const candidates = Object.values(zip.files).filter(
              (entry) =>
                !entry.dir &&
                /\.(png|webp|jpg|jpeg)$/i.test(entry.name) &&
                !entry.name.toLowerCase().endsWith('.9.png') &&
                /ic_launcher|app_icon|icon/i.test(entry.name)
            );
            candidates.sort((a, b) => b.name.length - a.name.length);
            if (candidates.length > 0) {
              const chosen = candidates[0];
              const buf = await chosen.async('nodebuffer');
              const ext = path.extname(chosen.name).toLowerCase() || '.png';
              const iconName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
              await fs.promises.writeFile(path.join(ICONS_DIR, iconName), buf);
              iconUrl = `/uploads/icons/${iconName}`;
            }
          } catch {
            // Keep default SVG icon fallback
          }
        }

        const screenshotFiles = files?.screenshots || [];
        const screenshots = screenshotFiles.map((f) => `/uploads/screenshots/${f.filename}`);

        const sizeMB = Number(body.sizeMB) || Number((apkFile.size / (1024 * 1024)).toFixed(2)) || 0.1;
        const now = new Date().toISOString();
        const newApp: StoreApp = {
          id: `app-${crypto.randomBytes(5).toString('hex')}`,
          name,
          developer,
          category,
          shortDescription,
          fullDescription,
          whatsNew: (body.whatsNew || '').trim() || 'الإصدار الأولي على متجر تطبيقات بلس.',
          packageName: (body.packageName || '').trim() || `com.app.${safeSlug(name).toLowerCase()}`,
          versionName: (body.versionName || '').trim() || '1.0.0',
          versionCode: (body.versionCode || '').trim() || '1',
          minAndroid: (body.minAndroid || '').trim() || 'Android 8.0+',
          ageRating: (body.ageRating || '').trim() || '+3',
          sizeMB: Math.max(sizeMB, 0.01),
          iconUrl,
          screenshots,
          apkFilename: apkFile.filename,
          hasCustomApk: true,
          permissionsCount: Number(body.permissionsCount) || 0,
          downloads: 1,
          averageRating: 0,
          reviewCount: 0,
          ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
          featured: false,
          ownerUid: (res.locals.developerUser as VerifiedDeveloper).uid,
          ownerEmail: (res.locals.developerUser as VerifiedDeveloper).email,
          createdAt: now,
          updatedAt: now,
        };

        db.apps.unshift(newApp);
        await saveStore(db);

        res.status(201).json({ app: newApp });
      } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'حدث خطأ أثناء رفع التطبيق ومعالجة ملف APK' });
      }
    }
  );

  // Increment install counter
  app.post('/api/apps/:id/install', async (req, res) => {
    const found = db.apps.find((a) => a.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'التطبيق غير موجود' });
      return;
    }
    found.downloads += 1;
    await saveStore(db);
    res.json({ downloads: found.downloads });
  });

  // Direct APK package stream for instant Android Package Installer invocation
  app.get('/api/apps/:id/install-apk', async (req, res) => {
    const found = db.apps.find((a) => a.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'التطبيق غير موجود' });
      return;
    }

    const downloadFilename = `${safeSlug(found.packageName)}-v${safeSlug(found.versionName)}.apk`;
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `inline; filename="${downloadFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    if (found.hasCustomApk && found.apkFilename) {
      const apkPath = path.join(APKS_DIR, path.basename(found.apkFilename));
      if (fs.existsSync(apkPath)) {
        const stat = await fs.promises.stat(apkPath);
        res.setHeader('Content-Length', String(stat.size));
        fs.createReadStream(apkPath).pipe(res);
        return;
      }
    }

    const buf = await buildDynamicApkBuffer(found);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  });

  // Submit a rating and review
  app.post('/api/apps/:id/reviews', async (req, res) => {
    const found = db.apps.find((a) => a.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: 'التطبيق غير موجود' });
      return;
    }

    const body = req.body as { authorName?: string; rating?: number; comment?: string };
    const authorName = String(body.authorName || '').trim();
    const comment = String(body.comment || '').trim();
    const rating = Number(body.rating);

    if (!authorName || authorName.length < 2) {
      res.status(400).json({ error: 'يرجى كتابة الاسم الكامل' });
      return;
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'يرجى اختيار تقييم من 1 إلى 5 نجوم' });
      return;
    }
    if (!comment || comment.length < 4) {
      res.status(400).json({ error: 'يرجى كتابة تعليق واضح حول تجربتك مع التطبيق' });
      return;
    }

    const newReview: ReviewItem = {
      id: `rev-${crypto.randomBytes(5).toString('hex')}`,
      appId: found.id,
      authorName: authorName.slice(0, 60),
      rating: Math.round(rating),
      comment: comment.slice(0, 1200),
      createdAt: new Date().toISOString(),
      helpfulCount: 0,
    };

    db.reviews.unshift(newReview);
    const appReviews = db.reviews.filter((r) => r.appId === found.id);
    const stats = computeRatingStats(appReviews);
    found.averageRating = stats.averageRating;
    found.reviewCount = stats.reviewCount;
    found.ratingDistribution = stats.ratingDistribution;

    await saveStore(db);
    res.status(201).json({ review: newReview, app: found });
  });

  // Helpful vote on a review
  app.post('/api/apps/:id/reviews/:reviewId/helpful', async (req, res) => {
    const review = db.reviews.find((r) => r.id === req.params.reviewId && r.appId === req.params.id);
    if (!review) {
      res.status(404).json({ error: 'المراجعة غير موجودة' });
      return;
    }
    review.helpfulCount += 1;
    await saveStore(db);
    res.json({ helpfulCount: review.helpfulCount });
  });

  // Delete an uploaded app (owner only)
  app.delete('/api/apps/:id', async (req, res) => {
    const developerUser = await verifyDeveloperRequest(req);
    if (!developerUser) {
      res.status(401).json({ error: 'يجب تسجيل الدخول بحساب المطور لحذف التطبيق' });
      return;
    }

    const idx = db.apps.findIndex((a) => a.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'التطبيق غير موجود' });
      return;
    }

    const target = db.apps[idx];
    if (!target.ownerUid || target.ownerUid !== developerUser.uid) {
      res.status(403).json({ error: 'لا تملك صلاحية حذف هذا التطبيق' });
      return;
    }

    const [removed] = db.apps.splice(idx, 1);
    db.reviews = db.reviews.filter((r) => r.appId !== removed.id);

    if (removed.hasCustomApk && removed.apkFilename) {
      const apkPath = path.join(APKS_DIR, path.basename(removed.apkFilename));
      if (fs.existsSync(apkPath)) fs.promises.unlink(apkPath).catch(() => {});
    }
    await saveStore(db);
    res.json({ deleted: true });
  });

  // Mount Vite dev middleware or production dist
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AppStorePlus server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
