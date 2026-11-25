import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, SlidersHorizontal, Star } from 'lucide-react';
import AdminSelect from '../Admin/AdminSelect';
import { getPublicFeedbacks } from '../../services/feedbackService';
import { useLanguage } from '../../i18n/hooks/useLanguage';
import './publicFeedback.css';

function Stars({ rating }) {
  return <span className="valo-review-stars" role="img" aria-label={`${rating}/5`}>
    {[1, 2, 3, 4, 5].map(value => <span className="valo-review-star" key={value} aria-hidden="true">
      <Star size={15} /><span style={{ width: `${Math.max(0, Math.min(1, rating - value + 1)) * 100}%` }}><Star size={15} fill="currentColor" /></span>
    </span>)}
  </span>;
}

function ReviewComment({ comment, t }) {
  const ref = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { if (!expanded) setClipped(element.scrollHeight > element.clientHeight + 1); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [comment, expanded]);
  if (!comment?.trim()) return <p className="valo-review-rating-only">{t('ratingOnly')}</p>;
  return <div className="valo-review-comment">
    <p ref={ref} className={expanded ? '' : 'valo-review-clamped'}>{comment}</p>
    {(clipped || expanded) && <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'less' : 'readMore')}</button>}
  </div>;
}

export default function PublicFeedbackSection({ onSummaryChange }) {
  const { language, t: translate } = useLanguage();
  const t = (key, options) => translate(`homePage.publicFeedback.${key}`, options);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 600px)').matches);
  const [query, setQuery] = useState({ page: 1, rating: '', sort: 'recent' });
  const [result, setResult] = useState({ data: null, loading: true, error: false, key: '' });
  const [retry, setRetry] = useState(0);
  const limit = mobile ? 2 : 3;
  const requestKey = JSON.stringify({ ...query, limit });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 600px)');
    const update = () => { setMobile(media.matches); setQuery(current => ({ ...current, page: 1 })); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    let alive = true;
    const params = JSON.parse(requestKey);
    getPublicFeedbacks(params.page, { limit: params.limit, rating: params.rating, sort: params.sort }).then(response => {
      if (!response.ok || !response.data?.success) throw new Error('Unable to load reviews');
      if (alive) setResult({ data: response.data.data, loading: false, error: false, key: requestKey });
    }).catch(() => { if (alive) setResult({ data: null, loading: false, error: true, key: requestKey }); });
    return () => { alive = false; };
  }, [requestKey, retry]);
  const loading = result.loading || result.key !== requestKey;
  const error = !loading && result.error;
  const data = result.data;
  // Browsing changes only the list; Hero always receives the global summary.
  useEffect(() => { onSummaryChange?.({ data, loading, error }); }, [data, loading, error, onSummaryChange]);
  const pages = Math.max(1, Math.ceil((data?.filteredTotal || 0) / limit));
  const change = (field, value) => setQuery(current => ({ ...current, [field]: value, page: 1 }));
  const date = value => new Date(value).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short', year: 'numeric' });
  return <section id="public-feedback" tabIndex={-1} className="valo-reviews" aria-labelledby="valo-reviews-title">
    <div className="valo-reviews-layout">
      <div className="valo-reviews-intro">
        <p className="valo-reviews-eyebrow"><span />{t('eyebrow')}</p>
        <h2 id="valo-reviews-title">{t('title')}<br /><span>{t('accent')}</span></h2>
        <p className="valo-reviews-description">{t('intro')}</p>
        <div className="valo-reviews-summary" aria-busy={loading}>
          <div className="valo-reviews-score"><strong>{data?.total > 0 ? Number(data.averageRating).toFixed(1) : '?'}<small>/5</small></strong>
            <div><Stars rating={data?.averageRating || 0} /><p>{data ? data.total.toLocaleString(language) : '?'} {t('total')}</p></div>
          </div>
          <div className="valo-reviews-distribution" role="group" aria-label={t('distribution')}>
            {[5, 4, 3, 2, 1].map(value => <div key={value} aria-label={`${t('stars', { count: value })}: ${data?.distribution?.[value] || 0}`}>
              <span>{value} <Star size={11} fill="currentColor" aria-hidden="true" /></span>
              <span className="valo-review-bar"><span style={{ width: `${data?.total ? (data.distribution?.[value] || 0) / data.total * 100 : 0}%` }} /></span>
              <span>{data?.distribution?.[value] || 0}</span>
            </div>)}
          </div>
        </div>
      </div>
      <div className="valo-reviews-stage">
        <h3>{t('reviews')}</h3>
        <div className="valo-reviews-filters">
          <AdminSelect
            ariaLabel={t('filter')} icon={Star} value={query.rating}
            onChange={value => change('rating', value)}
            options={[{ value: '', label: t('allRatings') }, ...[1, 2, 3, 4, 5].map(value => ({ value: String(value), label: t('stars', { count: value }) }))]}
            buttonClassName="valo-reviews-filter-button" menuClassName="valo-reviews-filter-menu" menuAnchor="bottom start"
          />
          <AdminSelect
            ariaLabel={t('sort')} icon={SlidersHorizontal} value={query.sort}
            onChange={value => change('sort', value)}
            options={['recent', 'lowest', 'highest'].map(value => ({ value, label: t(value) }))}
            buttonClassName="valo-reviews-filter-button" menuClassName="valo-reviews-filter-menu" menuAnchor="bottom start"
          />
        </div>
        <div className="valo-reviews-list" aria-busy={loading}>
          {loading ? <p className="valo-reviews-message" role="status">{t('loading')}</p> : error ? <div className="valo-reviews-message" role="alert"><p>{t('error')}</p><button onClick={() => { setResult(current => ({ ...current, loading: true })); setRetry(current => current + 1); }}>{t('retry')}</button></div>
            : !data?.items?.length ? <p className="valo-reviews-message" role="status">{t(query.rating ? 'noMatch' : 'empty')}</p>
              : data.items.map(review => <article className="valo-review-row" key={review.id}>
                <header><div className="valo-review-avatar" aria-hidden="true">{Array.from(review.author?.trim() || 'V')[0].toLocaleUpperCase(language)}</div>
                  <div className="valo-review-identity"><strong>{review.author || t('author')}</strong><Stars rating={review.rating} /></div>
                  <time dateTime={review.createdAt}>{date(review.createdAt)}</time>
                </header>
                {review.verifiedSession === true && <p className="valo-review-verified"><Check size={12} aria-hidden="true" />{t('verified')}</p>}
                <ReviewComment key={`${requestKey}-${review.id}`} comment={review.comment} t={t} />
              </article>)}
        </div>
        <nav className="valo-reviews-pagination" aria-label={t('reviews')}>
          <button aria-label={t('previous')} disabled={loading || error || query.page <= 1} onClick={() => setQuery(current => ({ ...current, page: current.page - 1 }))}><ArrowLeft size={16} /></button>
          <span aria-live="polite">{t('page')} {query.page} / {pages}</span>
          <button aria-label={t('next')} disabled={loading || error || query.page >= pages} onClick={() => setQuery(current => ({ ...current, page: current.page + 1 }))}><ArrowRight size={16} /></button>
        </nav>
      </div>
    </div>
  </section>;
}
