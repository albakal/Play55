import type { StoreApp } from '../types.ts';
import { resolveAssetUrl } from '../catalog/fallbackStore.ts';

async function imageUrlToShareFile(rawUrl: string, filenameBase: string): Promise<File | null> {
  if (!rawUrl || typeof fetch !== 'function') return null;
  try {
    const resolved = resolveAssetUrl(rawUrl);
    if (!resolved) return null;
    const res = await fetch(resolved);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    // Convert SVG or WebP to PNG when possible so WhatsApp/Telegram always show the thumbnail reliably
    if (
      blob.type === 'image/png' ||
      blob.type === 'image/jpeg'
    ) {
      const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
      return new File([blob], `${filenameBase}.${ext}`, { type: blob.type });
    }

    if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
      const objectUrl = URL.createObjectURL(blob);
      try {
        const pngBlob = await new Promise<Blob | null>((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              const size = Math.min(512, Math.max(img.naturalWidth || 256, img.naturalHeight || 256));
              const canvas = document.createElement('canvas');
              canvas.width = size;
              canvas.height = size;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                resolve(null);
                return;
              }
              ctx.drawImage(img, 0, 0, size, size);
              canvas.toBlob((out) => resolve(out), 'image/png');
            } catch {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = objectUrl;
        });
        if (pngBlob) {
          return new File([pngBlob], `${filenameBase}.png`, { type: 'image/png' });
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    return new File([blob], `${filenameBase}.webp`, { type: blob.type });
  } catch {
    return null;
  }
}

export async function shareShortLinkWithAppImage(
  app: StoreApp,
  shortUrl: string
): Promise<'shared-with-image' | 'shared-link' | 'copied'> {
  const title = `${app.name} (v${app.versionName}) — Play55`;
  const text = `${app.name} · ${app.shortDescription}\nالتثبيت المباشر:\n${shortUrl}`;
  const slug = app.packageName.replace(/[^a-zA-Z0-9_-]+/g, '-') || app.id;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const imgSource = app.iconUrl || app.screenshots?.[0] || '';
    const imageFile = await imageUrlToShareFile(imgSource, slug);

    if (
      imageFile &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [imageFile] })
    ) {
      try {
        await navigator.share({
          title,
          text,
          url: shortUrl,
          files: [imageFile],
        });
        return 'shared-with-image';
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          throw err;
        }
        // Fallback to URL share below if OS target rejected files+url together
      }
    }

    try {
      await navigator.share({
        title,
        text: `${app.name} — ${app.shortDescription}`,
        url: shortUrl,
      });
      return 'shared-link';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        throw err;
      }
    }
  }

  await navigator.clipboard.writeText(shortUrl);
  return 'copied';
}
