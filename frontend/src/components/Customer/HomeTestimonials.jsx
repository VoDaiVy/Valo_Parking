import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Pause, Play, Star } from 'lucide-react';
import { apiFetch } from '../../services/api';
import { useLanguage } from '../../i18n/hooks/useLanguage';

export default function HomeTestimonials() {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const container = useRef(null);
  const inView = useInView(container, { amount: 0.5 });
  const reducedMotion = useReducedMotion();
  const playing = !paused && !hovered && !focused && visible && inView && !reducedMotion;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/feedbacks/public', { signal: controller.signal }).then((response) => {
      if (controller.signal.aborted || !response.ok) return;
      const reviews = response.data?.data?.items;
      if (Array.isArray(reviews)) {
        setItems(reviews.filter((review) => review.id && typeof review.comment === 'string' && review.comment.trim() && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5));
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!playing || items.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => current + 1), 7000);
    return () => window.clearInterval(timer);
  }, [playing, items.length, index]);

  const move = (direction) => {
    setPaused(true);
    setIndex((current) => current + direction);
  };
  const currentIndex = items.length ? ((index % items.length) + items.length) % items.length : 0;
  const review = items[currentIndex];
  const bubbleCount = Math.min(items.length, 3);
  // Replace one slot per step, leaving the other bubbles steady for reading.
  const slotReviews = Array.from({ length: bubbleCount }, (_, slot) => {
    const step = Math.floor(index / bubbleCount) * bubbleCount + slot;
    const itemIndex = step < index ? step + bubbleCount : step;
    return { review: items[((itemIndex % items.length) + items.length) % items.length], step: itemIndex };
  });

  return (
    <div ref={container} className={review ? 'relative mt-2 pb-1' : ''}>
      {review && (
        <section
          aria-label={t('homeTestimonials.title')}
          aria-roledescription={items.length > 1 ? t('homeTestimonials.carousel') : undefined}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
          className="relative isolate"
        >
          <div className="relative">
            <div className="flex flex-col gap-4 px-1 py-2 sm:px-3" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
              {slotReviews.map(({ review, step }, slot) => (
                <motion.div
                  key={slot}
                  animate={{ y: playing ? [0, -5, 0] : 0 }}
                  transition={{ duration: playing ? 3.6 + slot * 0.6 : 0.25, repeat: playing ? Infinity : 0, ease: 'easeInOut', delay: playing ? slot * 0.4 : 0 }}
                  className={`relative w-[88%] max-w-[380px] sm:w-[84%] ${slot % 2 ? 'self-end' : 'self-start'}`}
                >
              <AnimatePresence initial={false} mode="wait">
                <motion.figure
                  key={`${review.id}-${step}`}
                  initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.96, y: reducedMotion ? 0 : 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.97, y: reducedMotion ? 0 : -6 }}
                  transition={{ duration: reducedMotion ? 0 : 0.4, ease: 'easeOut' }}
                  className={`relative flex h-[76px] flex-col rounded-2xl border border-[#dfc783]/40 px-3 py-2 shadow-[0_8px_24px_-16px_rgba(112,85,24,0.3)] ${slot === 1 ? 'bg-[#fffbf1]' : 'bg-white'}`}
                >
                  <span aria-hidden="true" className={`absolute -bottom-[7px] h-3.5 w-3.5 rotate-45 border-b border-r border-[#dfc783]/40 ${slot % 2 ? 'right-7 bg-[#fffbf1]' : 'left-7 bg-white'}`} />
                  <figcaption className="mb-1 flex shrink-0 items-center gap-2">
                    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#dfc783]/30 bg-[#f7f0df] text-xs font-bold text-[#94702b]">{(review.displayName || t('homeTestimonials.customer')).trim().charAt(0).toLocaleUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-charcoal" title={review.displayName}>{review.displayName || t('homeTestimonials.customer')}</span>
                    </span>
                    <span aria-label={t('homeTestimonials.rating', { rating: review.rating })} className="flex shrink-0 gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={11} aria-hidden="true" className={star <= review.rating ? 'fill-[#c99e42] text-[#c99e42]' : 'text-gray-200'} />)}
                    </span>
                  </figcaption>
                  <blockquote tabIndex={0} className="min-h-0 flex-1 overflow-y-auto break-words pr-1 text-xs leading-relaxed text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c99e42]">
                    “{review.comment}”
                  </blockquote>
                </motion.figure>
              </AnimatePresence>
                </motion.div>
              ))}
            </div>
            {items.length > 1 && (
              <nav aria-label={t('homeTestimonials.controls')} className="mt-1 flex items-center justify-between px-4 py-0.5 sm:px-5">
                <span className="text-[10px] tabular-nums text-gray-500">{String(currentIndex + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(-1)} aria-label={t('homeTestimonials.previous')} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#f7f0df] focus-visible:outline-[#c99e42]"><ChevronLeft size={15} /></button>
                  {!reducedMotion && <button type="button" onClick={() => setPaused((value) => !value)} aria-label={t(paused ? 'homeTestimonials.play' : 'homeTestimonials.pause')} className="flex h-11 w-11 items-center justify-center rounded-full text-[#94702b] transition-colors hover:bg-[#f7f0df] focus-visible:outline-[#c99e42]">{paused ? <Play size={13} /> : <Pause size={13} />}</button>}
                  <button type="button" onClick={() => move(1)} aria-label={t('homeTestimonials.next')} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-[#f7f0df] focus-visible:outline-[#c99e42]"><ChevronRight size={15} /></button>
                </div>
              </nav>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
