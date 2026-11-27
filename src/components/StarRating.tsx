import { Star } from 'lucide-react';

interface StarRatingProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onChange?: (value: number) => void;
}

export function StarRating({
  rating,
  size = 'sm',
  interactive = false,
  onChange,
}: StarRatingProps) {
  const iconSize = size === 'lg' ? 'w-6 h-6' : size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';

  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`التقييم ${rating} من 5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.round(rating);
        if (interactive && onChange) {
          return (
            <button
              key={star}
              type="button"
              onClick={() => onChange(star)}
              className="p-1 rounded-md hover:scale-110 transition-transform focus-visible:outline-2 focus-visible:outline-[#01875F]"
              aria-label={`تقييم ${star} نجوم`}
            >
              <Star
                className={`${iconSize} transition-colors ${
                  filled ? 'fill-[#01875F] text-[#01875F]' : 'fill-transparent text-[#DADCE0] hover:text-[#01875F]/50'
                }`}
              />
            </button>
          );
        }

        return (
          <Star
            key={star}
            className={`${iconSize} ${
              filled ? 'fill-[#01875F] text-[#01875F]' : 'fill-[#E8EAED] text-[#E8EAED]'
            }`}
          />
        );
      })}
    </div>
  );
}
