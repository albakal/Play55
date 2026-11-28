import { Upload } from 'lucide-react';

export type NavTab = 'apps' | 'top-rated' | 'newest' | 'upload';

interface StoreHeaderProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export function StoreHeader({ activeTab, onSelectTab }: StoreHeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E8EAED]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 md:gap-8">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('apps')}
          className="flex items-center gap-2 text-[#202124] hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#01875F] rounded-lg"
        >
          <span className="w-8 h-8 rounded-xl bg-[#01875F] text-white flex items-center justify-center shadow-xs shrink-0">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 5.5L18.5 12L7 18.5V5.5Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="font-display text-base sm:text-lg font-bold tracking-tight flex items-center gap-1.5">
            <span className="text-[#01875F]">Play55</span>
            <span className="hidden xs:inline text-[#DADCE0]" aria-hidden="true">|</span>
            <span className="text-sm sm:text-base font-semibold text-[#202124]">متجر تطبيقات بلس</span>
          </span>
        </button>

        {/* Zone 2: 4 Clean Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#5F6368]">
          <button
            type="button"
            onClick={() => onSelectTab('apps')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'apps'
                ? 'border-[#01875F] text-[#01875F] font-semibold'
                : 'border-transparent hover:text-[#202124]'
            }`}
          >
            التطبيقات
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('top-rated')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'top-rated'
                ? 'border-[#01875F] text-[#01875F] font-semibold'
                : 'border-transparent hover:text-[#202124]'
            }`}
          >
            الأعلى تقييماً
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('newest')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'newest'
                ? 'border-[#01875F] text-[#01875F] font-semibold'
                : 'border-transparent hover:text-[#202124]'
            }`}
          >
            أحدث الإصدارات
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('upload')}
            className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'upload'
                ? 'border-[#01875F] text-[#01875F] font-semibold'
                : 'border-transparent hover:text-[#202124]'
            }`}
          >
            استوديو المطورين
          </button>
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('upload')}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-white bg-[#01875F] hover:bg-[#016E4D] rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#01875F]"
          >
            <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>رفع تطبيق APK</span>
          </button>
        </div>
      </div>
    </header>
  );
}
