import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Pause, Play, ShieldCheck, Star } from 'lucide-react';
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
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % items.length), 7000);
    return () => window.clearInterval(timer);
  }, [playing, items.length, index]);

  const move = (direction) => {
    setPaused(true);
    setIndex((current) => (current + direction + items.length) % items.length);
  };
  const review = items[index];

  return (
    <div ref={container} className={review ? 'relative mt-4 pb-2' : ''}>
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
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-5 -bottom-3 top-5 -z-20 rounded-2xl border border-[#dfc783]/20 bg-[#f7f1e4]" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-2.5 -bottom-1.5 top-3 -z-10 rounded-2xl border border-[#dfc783]/30 bg-[#fcf9f2]" />
          <div className="overflow-hidden rounded-2xl border border-[#dfc783]/40 bg-white shadow-[0_12px_35px_-20px_rgba(112,85,24,0.35)]">
            <div className="relative h-28" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
              <AnimatePresence initial={false} mode="wait">
                <motion.figure
                  key={review.id}
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                  transition={{ duration: reducedMotion ? 0 : 0.25, ease: 'easeOut' }}
                  className="absolute inset-0 flex flex-col px-4 py-3 sm:px-5"
                >
                  <figcaption className="mb-2 flex shrink-0 items-center gap-2.5">
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#dfc783]/30 bg-[#f7f0df] text-xs font-bold text-[#94702b]">{(review.displayName || t('homeTestimonials.customer')).trim().charAt(0).toLocaleUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-charcoal" title={review.displayName}>{review.displayName || t('homeTestimonials.customer')}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-400"><ShieldCheck size={11} aria-hidden="true" />{t('homeTestimonials.verified')}</span>
                    </span>
                    <span aria-label={t('homeTestimonials.rating', { rating: review.rating })} className="flex shrink-0 gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={11} aria-hidden="true" className={star <= review.rating ? 'fill-[#c99e42] text-[#c99e42]' : 'text-gray-200'} />)}
                    </span>
                  </figcaption>
                  <blockquote tabIndex={0} className="min-h-0 flex-1 overflow-y-auto break-words pr-1 text-sm leading-relaxed text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c99e42]">
                    “{review.comment}”
                  </blockquote>
                </motion.figure>
              </AnimatePresence>
            </div>
            {items.length > 1 && (
              <nav aria-label={t('homeTestimonials.controls')} className="flex items-center justify-between border-t border-[#f4efdf] px-4 py-0.5 sm:px-5">
                <span className="text-[10px] tabular-nums text-gray-400">{String(index + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(-1)} aria-label={t('homeTestimonials.previous')} className="rounded-full p-2 text-gray-500 transition-colors hover:bg-[#f7f0df] focus-visible:outline-[#c99e42]"><ChevronLeft size={15} /></button>
                  {!reducedMotion && <button type="button" onClick={() => setPaused((value) => !value)} aria-label={t(paused ? 'homeTestimonials.play' : 'homeTestimonials.pause')} className="rounded-full p-2 text-[#94702b] transition-colors hover:bg-[#f7f0df] focus-visible:outline-[#c99e42]">{paused ? <Play size={13} /> : <Pause size={13} />}</button>}
                  <button type="button" onClick={() => move(1)} aria-label={t('homeTestimonials.next')} className="rounded-full p-2 text-gray-500 transition-colors hover:bg-[#f7f0df] focus-visible:outline-[#c99e42]"><ChevronRight size={15} /></button>
                </div>
              </nav>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
