import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Pause, Play, Quote, Star } from 'lucide-react';
import { getPublicFeedbacks } from '../../services/feedbackService';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import './publicFeedback.css';

const copy = {
  vi: {
    eyebrow: 'GÓC NHÌN TỪ NGƯỜI DÙNG', title: 'Mỗi chuyến đi.', accent: 'Một trải nghiệm thật.',
    intro: 'Những đánh giá sau mỗi lượt gửi xe tại VALO. Từ điều hài lòng đến góp ý để chúng tôi tốt hơn mỗi ngày.',
    total: 'đánh giá từ khách hàng', outOf: 'trên 5 điểm', verified: 'Đã hoàn tất lượt gửi xe',
    author: 'Khách hàng VALO', emptyComment: 'Khách hàng đã chấm điểm và không để lại nhận xét.',
    empty: 'Hành trình của những đánh giá bắt đầu từ bạn.', emptyBody: 'Đánh giá sau lượt gửi xe hoàn tất sẽ xuất hiện tại đây.',
    error: 'Chưa thể tải đánh giá. Vui lòng thử lại.', retry: 'Thử lại', loading: 'Đang tải trải nghiệm từ khách hàng…',
    previous: 'Đánh giá trước', next: 'Đánh giá tiếp theo', all: 'Khám phá tất cả đánh giá', less: 'Thu gọn',
    older: 'Trang tiếp', newer: 'Trang trước', page: 'Trang', play: 'Tự động chuyển', pause: 'Dừng chuyển',
    topics: { parking: 'Chỗ đỗ', staff: 'Nhân viên', payment: 'Thanh toán', app: 'Ứng dụng', other: 'Góp ý khác' },
  },
  en: {
    eyebrow: 'THE DRIVER’S PERSPECTIVE', title: 'Every journey.', accent: 'A real experience.',
    intro: 'Feedback after parking with VALO. The moments you love and the suggestions that help us get better.',
    total: 'customer reviews', outOf: 'out of 5', verified: 'Completed parking session', author: 'VALO driver',
    emptyComment: 'This customer left a rating without a written review.', empty: 'Your experience starts the conversation.',
    emptyBody: 'Reviews from completed parking sessions will appear here.', error: 'Reviews are unavailable. Please try again.',
    retry: 'Try again', loading: 'Loading customer experiences…', previous: 'Previous review', next: 'Next review',
    all: 'Explore all reviews', less: 'Show less', older: 'Next page', newer: 'Previous page', page: 'Page',
    play: 'Play slideshow', pause: 'Pause slideshow',
    topics: { parking: 'Parking', staff: 'Staff', payment: 'Payment', app: 'Application', other: 'Other' },
  },
};

function Stars({ rating }) {
  return <span className="valo-review-stars" role="img" aria-label={`${rating}/5`}>
    {[1, 2, 3, 4, 5].map(value => <Star key={value} size={18} aria-hidden="true" fill={value <= rating ? 'currentColor' : 'none'} />)}
  </span>;
}

export default function PublicFeedbackSection() {
  const { language } = useLanguage();
  const c = copy[language] || copy.en;
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    getPublicFeedbacks(page).then(response => {
      if (!response.ok || !response.data?.success) throw new Error('Unable to load reviews');
      if (alive) { setData(response.data.data); setActive(0); }
    }).catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, retry]);
  const items = data?.items || [];
  useEffect(() => {
    if (!playing || hovered || reducedMotion || items.length < 2 || loading || error) return;
    const timer = setInterval(() => {
      if (!document.hidden) setActive(current => (current + 1) % items.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [playing, hovered, reducedMotion, items.length, loading, error]);
  const navigate = next => { setPlaying(false); setActive((active + next + items.length) % items.length); };
  const loadPage = next => { setLoading(true); setError(false); setPage(next); };
  const review = items[active];
  const date = value => new Date(value).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-GB', { timeZone: 'Asia/Ho_Chi_Minh', month: 'short', year: 'numeric' });
  return <section className="valo-reviews" aria-labelledby="valo-reviews-title">
    <div className="valo-reviews-layout">
      <div className="valo-reviews-intro">
        <p className="valo-reviews-eyebrow"><span />{c.eyebrow}</p>
        <h2 id="valo-reviews-title">{c.title}<br /><span>{c.accent}</span></h2>
        <p className="valo-reviews-description">{c.intro}</p>
        {data?.total > 0 && <div className="valo-reviews-score">
          <strong>{Number(data.averageRating).toFixed(1)}</strong>
          <div><Stars rating={Math.round(data.averageRating)} /><p>{c.outOf} · {data.total.toLocaleString()} {c.total}</p></div>
        </div>}
      </div>
      <div className="valo-reviews-stage" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setHovered(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false); }}>
        {loading ? <p role="status" className="valo-reviews-message">{c.loading}</p> : error ? <div className="valo-reviews-message" role="alert">
          <p>{c.error}</p><button onClick={() => { setLoading(true); setError(false); setRetry(retry + 1); }}>{c.retry}</button>
        </div> : !review ? <div className="valo-reviews-message"><Quote size={36} /><h3>{c.empty}</h3><p>{c.emptyBody}</p></div> : <>
          <Quote className="valo-review-quote" size={64} strokeWidth={1} aria-hidden="true" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.article key={review.id} initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -12 }} transition={{ duration: reducedMotion ? 0 : 0.3 }} className="valo-review-feature">
              <div className="valo-review-rating"><Stars rating={review.rating} /><span>{review.rating.toFixed(1)} <span>/ 5</span></span></div>
              <blockquote>{review.comment || c.emptyComment}</blockquote>
              <div className="valo-review-topics">{review.categories?.map(topic => <span key={topic}>{c.topics[topic] || topic}</span>)}</div>
              <footer><div className="valo-review-avatar" aria-hidden="true">{Array.from(review.author?.trim() || 'V')[0].toLocaleUpperCase()}</div><div><strong>{review.author || c.author}</strong><p><Check size={13} aria-hidden="true" />{c.verified}</p></div><time dateTime={review.createdAt}>{date(review.createdAt)}</time></footer>
            </motion.article>
          </AnimatePresence>
          <div className="valo-reviews-controls">
            <div className="valo-review-position"><span>{String(active + 1).padStart(2, '0')} <span>/ {String(items.length).padStart(2, '0')}</span></span><div className="valo-review-track" aria-hidden="true"><span style={{ width: `${((active + 1) / items.length) * 100}%` }} /></div></div>
            <div>{items.length > 1 && <>
              {!reducedMotion && <button aria-label={playing ? c.pause : c.play} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>}
              <button aria-label={c.previous} onClick={() => navigate(-1)}><ArrowLeft size={18} /></button>
              <button aria-label={c.next} onClick={() => navigate(1)}><ArrowRight size={18} /></button>
            </>}</div>
          </div>
        </>}
      </div>
    </div>
    {!loading && !error && data?.total > 0 && <div className="valo-reviews-browse">
      <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? c.less : c.all}<ArrowRight size={17} /></button>
      {expanded && <div className="valo-review-grid">{items.map(item => <article key={item.id}>
        <Stars rating={item.rating} /><p className="valo-review-text">{item.comment || c.emptyComment}</p>
        <footer><span className="valo-review-author">{item.author || c.author}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time></footer>
      </article>)}</div>}
      {(expanded || page > 1) && <nav className="valo-reviews-pagination" aria-label={c.all}>
        <button disabled={page === 1} onClick={() => loadPage(page - 1)}>{c.newer}</button>
        <span>{c.page} {page} / {Math.ceil(data.total / 6)}</span>
        <button disabled={page * 6 >= data.total} onClick={() => loadPage(page + 1)}>{c.older}</button>
      </nav>}
    </div>}
  </section>;
}
