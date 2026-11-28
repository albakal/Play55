export type AppCategory =
  | 'الإنتاجية'
  | 'الأدوات'
  | 'الصوتيات'
  | 'التعليم'
  | 'الأعمال'
  | 'التصوير'
  | 'الألعاب';

export interface ReviewItem {
  id: string;
  appId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
  helpfulCount: number;
}

export interface StoreApp {
  id: string;
  name: string;
  developer: string;
  category: AppCategory;
  shortDescription: string;
  fullDescription: string;
  whatsNew: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  minAndroid: string;
  ageRating: string;
  sizeMB: number;
  iconUrl: string;
  screenshots: string[];
  apkFilename: string;
  hasCustomApk: boolean;
  isBinaryManifest?: boolean;
  isSignedApk?: boolean;
  signatureScheme?: string;
  signerCertSha256?: string;
  apkSha256?: string;
  externalApkUrl?: string;
  permissionsCount: number;
  downloads: number;
  averageRating: number;
  reviewCount: number;
  ratingDistribution: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
  featured?: boolean;
  syncedToCloud?: boolean;
  ownerUid?: string;
  ownerEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppDetailResponse {
  app: StoreApp;
  reviews: ReviewItem[];
}

export interface DeveloperSessionUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string | null;
  provider: 'manual' | 'google';
}

export interface ExtractedApkInfo {
  packageName: string;
  versionName: string;
  versionCode: string;
  appLabel: string;
  minAndroid: string;
  permissionsCount: number;
  sizeMB: number;
  isValidZipApk: boolean;
  isBinaryManifest: boolean;
  isSignedApk: boolean;
  signatureScheme?: string;
  apkSha256?: string;
  validationError?: string;
  iconDataUrl: string | null;
  iconBlob: Blob | null;
  iconFilename: string | null;
  iconSourcePath: string | null;
}

