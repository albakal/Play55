import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { resolveAssetUrl } from '../catalog/fallbackStore.ts';

interface AppIconProps {
  src: string;
  alt: string;
  className?: string;
}

export function AppIcon({ src, alt, className = 'w-16 h-16 rounded-2xl' }: AppIconProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = resolveAssetUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed) {
    return (
      <div
        aria-label={alt}
        className={`${className} bg-gradient-to-br from-[#01875F] to-[#0B57D0] text-white flex items-center justify-center shrink-0 shadow-xs`}
      >
        <Smartphone className="w-1/2 h-1/2 opacity-90" />
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} object-cover shrink-0 bg-[#F1F3F4] border border-black/5 shadow-xs`}
    />
  );
}
