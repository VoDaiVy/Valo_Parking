import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, Zap, Camera, Car, CreditCard, ArrowRight, Smartphone, QrCode, Wrench, Sparkles, Clock, ChevronDown, ChevronLeft, ChevronRight, Star } from 'lucide-react';

// Import images
import CarImage from '../../assets/images/car.png';

// Import Component 3D
import SmartGate3D from '../../components/SmartGate3D';
import PublicFeedbackSection from '../../components/Guest/PublicFeedbackSection';

import { getServices } from '../../services/extraServiceApi';
import { getLiveMapData } from '../../services/parkingFloorService';
import { buildBookingUrl } from '../../utils/bookingNavigation';
import { serviceName, serviceDescription } from '../../utils/servicePresentation';
import { useLanguage } from '../../i18n/hooks/useLanguage';

const SERVICE_PRESENTATION = [
  {
    icon: Sparkles,
    fallbackImage: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1400&q=80',
  },
  {
    icon: Zap,
    fallbackImage: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1400&q=80',
  },
  {
    icon: ShieldCheck,
    fallbackImage: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1400&q=80',
  },
  {
    icon: Wrench,
    fallbackImage: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=1400&q=80',
  },
  {
    icon: CreditCard,
    fallbackImage: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=1400&q=80',
  },
  {
    icon: Car,
    fallbackImage: 'https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?auto=format&fit=crop&w=1400&q=80',
  },
];

export const PremiumCarServicesSection = () => {
  const { t, language } = useLanguage();
  const [services, setServices] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const locale = language === 'vi' ? 'vi-VN' : 'en-US';
  const text = (key, options) => t(`homePage.premiumServices.${key}`, options);

  useEffect(() => {
    let mounted = true;
    const fetchServices = async () => {
      try {
        const res = await getServices(true);
        if (!res.ok || !res.data?.success || !Array.isArray(res.data.data)) throw new Error('Unavailable');
        // Rank once from API data; selection never changes order or popularity.
        const count = service => Number.isInteger(service.usageCount) && service.usageCount >= 0 ? service.usageCount : -1;
        const date = service => Date.parse(service.createdAt) || 0;
        const id = service => String(service._id || service.id);
        const ranked = res.data.data.filter(service => service.isActive === true)
          .sort((a, b) => Math.max(0, count(b)) - Math.max(0, count(a)) || date(b) - date(a)
            || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0))
          .map((service, index) => ({
            ...service,
            id: id(service),
            image: service.imageUrl || SERVICE_PRESENTATION[index % SERVICE_PRESENTATION.length].fallbackImage,
            usageCount: count(service),
            icon: SERVICE_PRESENTATION[index % SERVICE_PRESENTATION.length].icon,
          }));
        if (mounted) {
          setServices(ranked);
          setSelectedId(ranked[0]?.id ?? null);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchServices();
    return () => { mounted = false; };
  }, []);
  const duration = service => Number.isFinite(Number(service.timeCost)) && Number(service.timeCost) > 0
    ? text('minutes', { count: Number(service.timeCost) }) : text('durationUnknown');
  const usage = service => service.usageCount >= 0
    ? text('completed', { count: service.usageCount.toLocaleString(locale) }) : text('usageUnknown');
  const price = service => service.price != null && Number.isFinite(Number(service.price))
    ? <span className="inline-flex items-baseline gap-1 whitespace-nowrap"><span className="text-lg font-extrabold">{Number(service.price).toLocaleString('en-US')}</span><span className="text-[10px] font-semibold">VND</span></span> : text('contact');
  const pageCount = Math.ceil(services.length / 3);
  const visibleServices = services.slice(page * 3, page * 3 + 3);
  const popular = service => service.id === services[0]?.id && service.usageCount > 0;
  const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold';
  const activeService = services.find(service => service.id === selectedId);
  const [fade, setFade] = useState(true);
  const fadeTimeoutRef = useRef(null);
  useEffect(() => () => clearTimeout(fadeTimeoutRef.current), []);
  const handleServiceSelect = service => {
    if (service.id === selectedId) return;
    setSelectedId(service.id);
    setFade(false);
    clearTimeout(fadeTimeoutRef.current);
    fadeTimeoutRef.current = setTimeout(() => setFade(true), 220);
  };
  const ActiveIcon = activeService?.icon || Sparkles;

  return (
    <section className="bg-[#121212] text-white py-12 lg:py-14 relative overflow-hidden border-y border-gray-800">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"></div>
      <div className="absolute -top-32 right-10 w-[420px] h-[420px] bg-gold-gradient opacity-10 blur-[120px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="max-w-3xl mx-auto text-center mb-9">
          <div className="inline-flex items-center gap-2 py-1.5 px-4 rounded-full bg-white/5 border border-white/10 text-gold text-xs font-bold tracking-wider mb-3 uppercase">
            <Sparkles size={14} /> {text('eyebrow')}
          </div>
          <h2 className="text-3xl lg:text-4xl font-extrabold leading-tight mb-3">
            {text('title')} <span className="text-gold-gradient">{text('titleAccent')}</span>
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            {text('subtitle')}
          </p>
        </div>

        {loading && (
          <div role="status" aria-label={text('loading')} className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start max-w-6xl mx-auto animate-pulse motion-reduce:animate-none">
            <div className="lg:col-span-5">
              <div className="w-full max-w-[410px] mx-auto h-[430px] lg:h-[488px] rounded-[26px] bg-[#1A1A1A] border border-white/10"></div>
            </div>
            <div className="lg:col-span-7 space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className={`h-32 rounded-[22px] bg-[#1A1A1A] border border-gray-800`}></div>
              ))}
            </div>
          </div>
        )}

        {!loading && (error || !activeService) && (
          <div role="status" className="rounded-2xl border border-white/10 bg-[#1A1A1A] p-10 text-center">
            <Sparkles size={28} className="text-gold mx-auto mb-4" />
            <h3 className="text-xl font-extrabold text-white mb-2">
              {text(error ? 'error' : 'empty')}
            </h3>
            <p className="text-gray-400 text-sm max-w-xl mx-auto">
              {text(error ? 'errorHint' : 'emptyHint')}
            </p>
          </div>
        )}

        {!loading && activeService && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start max-w-6xl mx-auto">
            <div className="lg:col-span-5">
              <div className="relative w-full max-w-[410px] mx-auto h-[430px] lg:h-[488px] rounded-[26px] overflow-hidden border border-white/10 bg-[#1A1A1A] shadow-2xl">
                <img
                  src={activeService.image}
                  alt={serviceName(activeService, t) || text('fallbackName')}
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 motion-reduce:transition-none ease-out ${fade ? 'opacity-100 scale-100' : 'opacity-40 scale-105'}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal/75 via-transparent to-black/10"></div>
                <div className={`absolute left-5 right-5 bottom-5 transition-all duration-300 motion-reduce:transition-none ${fade ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
                  <div className="flex max-w-full flex-wrap sm:flex-nowrap items-center gap-3 rounded-2xl border border-white/15 bg-white/90 p-3 text-charcoal shadow-xl backdrop-blur">
                    <div className="w-11 h-11 rounded-xl bg-gold text-charcoal flex items-center justify-center shrink-0">
                      <ActiveIcon size={21} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold break-words [overflow-wrap:anywhere]">{serviceName(activeService, t) || text('fallbackName')}</p>
                      <p className="text-[10px] text-gray-600 font-bold leading-relaxed">
                        <span className="text-[#A67C24]">{price(activeService)}</span><span className="block">{duration(activeService)}</span>
                      </p>
                    </div>
                    <Link
                      to={buildBookingUrl(activeService.id)}
                      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold inline-flex items-center justify-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2.5 text-xs font-extrabold text-charcoal shadow-[0_10px_24px_rgba(212,175,55,0.24)] transition-all hover:scale-105"
                    >
                      {text('book')}
                      <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 min-w-0">
              <div className="space-y-3 lg:h-[432px]">
                {visibleServices.map((service) => {
                  const Icon = service.icon;
                  const isActive = service.id === activeService.id;
                  return (
                    <article key={service.id} className={`group relative isolate overflow-hidden rounded-2xl border p-3.5 transition-colors motion-reduce:transition-none lg:h-[136px] ${isActive
                      ? 'border-gold/60 bg-[linear-gradient(120deg,rgba(212,175,55,0.14),rgba(26,26,26,0.98)_65%)] shadow-[0_4px_20px_rgba(212,175,55,0.06)]'
                      : 'border-white/10 bg-[#181818] hover:border-gold/30 hover:bg-[#202020]'}`}>
                      {isActive && <div className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-gold-gradient" />}
                      <button type="button" onClick={() => handleServiceSelect(service)} aria-pressed={isActive}
                        aria-label={serviceName(service, t) || text('fallbackName')}
                        className={`${focus} absolute inset-0 z-10 rounded-2xl`} />
                      <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-gold-gradient text-charcoal shadow-[0_0_18px_rgba(212,175,55,0.3)]' : 'bg-white/5 text-gold'}`}><Icon size={20} aria-hidden="true" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="grid min-w-0 grid-cols-1 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
                            <div className="min-w-0">
                              <h3 className="line-clamp-1 text-sm font-extrabold text-white" title={serviceName(service, t)}>{serviceName(service, t) || text('fallbackName')}</h3>
                              {popular(service) && <span className="mt-1 inline-flex rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold">{text('popular')}</span>}
                              <p className="mt-1 min-w-0 truncate text-xs leading-5 text-gray-400">{serviceDescription(service, t) || text('fallbackDescription')}</p>
                            </div>
                            <div className="shrink-0 whitespace-nowrap text-gold">{price(service)}</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <span className="inline-flex flex-wrap items-center gap-1 text-[11px] text-gray-400"><Clock size={12} aria-hidden="true" className="text-gold" />{duration(service)}<span aria-hidden="true" className="mx-0.5 h-1 w-1 shrink-0 rounded-full bg-current" />{usage(service)}</span>
                        <Link to="/services" state={{ selectedServiceId: service.id }} aria-label={`${text('details')}: ${serviceName(service, t)}`}
                          className={`${focus} relative z-20 inline-flex min-h-11 items-center rounded-full border border-gold/50 px-3 text-xs font-bold text-gold transition-colors hover:border-gold hover:bg-gold/10 motion-reduce:transition-none lg:min-h-8`}>{text('details')}<ArrowRight size={12} className="ml-1" aria-hidden="true" /></Link>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <Link to="/services" className={`${focus} inline-flex min-h-11 items-center gap-2 rounded text-sm font-bold text-gold`}>{text('explore')}<ArrowRight size={16} aria-hidden="true" /></Link>
                {pageCount > 1 && <nav aria-label={text('pagination')} className="flex items-center gap-1">
                  <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={text('previous')} className={`${focus} h-11 w-11 rounded-full border border-white/10 text-gold hover:bg-gold/10 disabled:opacity-30`}><ChevronLeft size={16} aria-hidden="true" className="mx-auto" /></button>
                  <span className="whitespace-nowrap px-1 text-xs text-gray-400" aria-live="polite">{page + 1} / {pageCount}</span>
                  <button type="button" disabled={page === pageCount - 1} onClick={() => setPage(page + 1)} aria-label={text('next')} className={`${focus} h-11 w-11 rounded-full border border-white/10 text-gold hover:bg-gold/10 disabled:opacity-30`}><ChevronRight size={16} aria-hidden="true" className="mx-auto" /></button>
                </nav>}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default function GuestHome() {
  const { t, language } = useLanguage();
  const [feedbackSummary, setFeedbackSummary] = useState(null);
  const navigate = useNavigate();
  const [pulse, setPulse] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mapData, setMapData] = useState([]);
  const [mapStats, setMapStats] = useState({ available: 12, total: 50 });

  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 1500);
    
    const checkAuth = () => {
      const userStr = sessionStorage.getItem('valo_user');
      setIsLoggedIn(!!userStr);
    };
    checkAuth();
    window.addEventListener('valo_auth_change', checkAuth);

    const fetchMap = async () => {
      try {
        const { ok, data } = await getLiveMapData();
        if (ok && data?.data) {
          const slots = data.data;
          setMapStats({
            available: slots.filter(s => s.status === 'available').length,
            total: slots.length
          });
          // Pick up to 8 slots for the preview
          setMapData(slots.slice(0, 8));
        }
      } catch (e) {
        console.error('Live Map fetch error:', e);
      }
    };
    fetchMap();
    const mapInterval = setInterval(fetchMap, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(mapInterval);
      window.removeEventListener('valo_auth_change', checkAuth);
    };
  }, []);

  const summary = feedbackSummary?.data;
  const averageRating = Number(summary?.averageRating);
  const totalReviews = Number(summary?.total);
  const hasRating = !feedbackSummary?.loading && !feedbackSummary?.error
    && Number.isInteger(totalReviews) && totalReviews > 0
    && summary?.averageRating != null && Number.isFinite(averageRating) && averageRating >= 1 && averageRating <= 5;
  const scrollToReviews = event => {
    const target = document.getElementById('public-feedback');
    if (!target) return;
    event.preventDefault();
    const navbarHeight = document.getElementById('main-navbar')?.getBoundingClientRect().height || 0;
    window.scrollTo({
      top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - navbarHeight - 16),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    target.focus({ preventScroll: true });
  };

  const handleMapClick = () => {
    if (isLoggedIn) {
      navigate('/parking-map');
    }
  };

  return (
    <>
      {/* 1. HERO SECTION */}
      <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 max-w-7xl mx-auto px-6 flex flex-col lg:flex-row items-center gap-12">
        <div className="w-full lg:w-1/2 flex flex-col items-start z-10">
          <div className="inline-flex items-center gap-2 py-1.5 px-4 rounded-full bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-bold tracking-wider mb-6 uppercase">
            <Zap size={14} className="text-yellow-600" /> {t('homePage.aiBadge')}
          </div>
          <h1 className="text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
            {t('homePage.heroTitle')}<br />
            <span className="text-gold-gradient">{t('homePage.heroTitleAccent')}</span>
          </h1>
          <p className="text-lg text-gray-600 mb-8 max-w-lg leading-relaxed">
            {t('homePage.heroDescription')}
          </p>
          <div className="w-full max-w-md bg-white p-2 rounded-xl shadow-xl border border-gray-100 flex gap-2 hover:shadow-2xl transition-shadow duration-300">
            <div className="flex items-center pl-3 text-gray-400">
              <Search size={20} />
            </div>
            <input type="text" placeholder={t('homePage.platePlaceholder')} className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none text-gray-700 font-semibold placeholder-gray-400" />
            <button className="bg-charcoal text-white px-6 py-3 rounded-lg font-bold hover:bg-black hover:scale-105 transition-all whitespace-nowrap">{t('homePage.check')}</button>
          </div>
          <a href="#public-feedback" onClick={scrollToReviews} className="valo-hero-rating">
            {hasRating ? <>
              <span className="valo-hero-stars" aria-hidden="true">
                {[0, 1, 2, 3, 4].map(index => <span key={index} className="valo-hero-star">
                  <Star size={16} />
                  <span style={{ width: `${Math.max(0, Math.min(1, averageRating - index)) * 100}%` }}><Star size={16} fill="currentColor" /></span>
                </span>)}
              </span>
              <strong>{averageRating.toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 })} / 5</strong>
              <span>{t('homePage.reviewCount', { count: totalReviews })}</span>
            </> : <span>{t(!feedbackSummary || feedbackSummary.loading ? 'homePage.reviewsLoading'
              : !feedbackSummary.error && totalReviews === 0 ? 'homePage.noReviews' : 'homePage.reviewsUnavailable')}</span>}
            <span className="valo-hero-read-reviews">{t('homePage.readReviews')}<ChevronDown size={14} aria-hidden="true" /></span>
          </a>
        </div>

        <div className="w-full lg:w-1/2 relative">
          <div className="absolute inset-0 bg-gold-gradient opacity-10 blur-3xl rounded-full transform -translate-y-10"></div>
          <div onClick={handleMapClick} className={`bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 relative overflow-hidden scan-line group ${isLoggedIn ? 'cursor-pointer hover:shadow-[0_0_25px_rgba(255,213,85,0.4)]' : ''}`}>
            <div className="flex justify-between items-center mb-6 border-b border-gray-50 pb-4">
              <div>
                <h3 className="font-bold text-lg text-charcoal">{t('homePage.liveGridMap')} {isLoggedIn ? '(100%)' : '(50%)'}</h3>
                <p className="text-xs text-gray-400">{isLoggedIn ? t('homePage.viewInteractiveMap') : t('homePage.currentParkingStatus')}</p>
              </div>
              <div className="bg-green-50 text-green-600 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 border border-green-100">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div> {mapStats.available}/{mapStats.total} {t('homePage.available')}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 relative">
              {mapData.length > 0 ? (
                mapData.map((slot) => {
                  if (slot.status === 'available') {
                    return (
                      <div key={slot.id} className={`bg-white border-2 border-green-400 rounded-lg p-3 h-24 flex flex-col justify-center items-center transition-all duration-300 ${pulse ? 'shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''}`}>
                        <span className="text-xs font-bold text-green-600">{slot.id}</span>
                        <span className="text-[10px] font-bold text-green-500 mt-2 uppercase tracking-wider bg-green-50 px-2 py-1 rounded">{t('homePage.empty')}</span>
                      </div>
                    );
                  } else if (slot.status === 'occupied') {
                    return (
                      <div key={slot.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center">
                        <span className="text-xs font-bold text-gray-400">{slot.id}</span>
                        <Car size={24} className="text-gray-600 mt-2" />
                      </div>
                    );
                  } else if (slot.status === 'reserved') {
                    return (
                      <div key={slot.id} className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 h-24 flex flex-col justify-center items-center">
                        <span className="text-xs font-bold text-yellow-700">{slot.id}</span>
                        <span className="text-[10px] font-bold text-yellow-600 mt-2 uppercase tracking-wider">{t('homePage.booked')}</span>
                      </div>
                    );
                  } else {
                    return (
                      <div key={slot.id} className="bg-charcoal border border-gray-800 rounded-lg p-3 h-24 flex flex-col justify-center items-center">
                        <span className="text-xs font-bold text-gray-500">{slot.id}</span>
                        <span className="text-[10px] font-bold text-white mt-2 uppercase tracking-wider text-center">{t('homePage.maintenance')}</span>
                      </div>
                    );
                  }
                })
              ) : (
                <>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-01</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className={`bg-white border-2 border-green-400 rounded-lg p-3 h-24 flex flex-col justify-center items-center transition-all duration-300 ${pulse ? 'shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''}`}><span className="text-xs font-bold text-green-600">A-02</span><span className="text-[10px] font-bold text-green-500 mt-2 uppercase tracking-wider bg-green-50 px-2 py-1 rounded">{t('homePage.empty')}</span></div>
                  <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-yellow-700">A-03</span><span className="text-[10px] font-bold text-yellow-600 mt-2 uppercase tracking-wider">{t('homePage.booked')}</span></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-04</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className={`bg-white border-2 border-green-400 rounded-lg p-3 h-24 flex flex-col justify-center items-center transition-all duration-300 ${!pulse ? 'shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''}`}><span className="text-xs font-bold text-green-600">A-05</span><span className="text-[10px] font-bold text-green-500 mt-2 uppercase tracking-wider bg-green-50 px-2 py-1 rounded">{t('homePage.empty')}</span></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-06</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-07</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className="bg-charcoal border border-gray-800 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-500">A-08</span><span className="text-[10px] font-bold text-white mt-2 uppercase tracking-wider text-center">{t('homePage.maintenance')}</span></div>
                </>
              )}
            </div>
            {!isLoggedIn && (
              <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pb-6">
                <button onClick={(e) => { e.stopPropagation(); navigate('/login'); }} className="bg-charcoal text-white font-bold py-3 px-8 rounded-full text-sm shadow-xl hover:-translate-y-1 hover:shadow-2xl transition transform flex items-center gap-2 border border-gray-700">
                  <ShieldCheck size={16} className="text-gold" /> {t('homePage.loginToViewMap')}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. NEW SECTION: 3D AI GATE CHECK-IN (REACT THREE FIBER) */}
      <section className="bg-charcoal text-white py-24 relative overflow-hidden border-y border-gray-800">
        <div className="max-w-7xl mx-auto px-6 flex flex-col lg:flex-row items-center gap-16 relative z-10">
          
          <div className="w-full lg:w-1/2">
            <div className="inline-flex items-center gap-2 py-1.5 px-4 rounded-full bg-white/5 border border-white/10 text-gold text-xs font-bold tracking-wider mb-6 uppercase">
              <Camera size={14} /> {t('homePage.seamlessCheckin')}
            </div>
            <h2 className="text-3xl lg:text-4xl font-extrabold mb-6">
              {t('homePage.alprTitle')} <span className="text-gold-gradient">{t('homePage.alprAccent')}</span>
            </h2>
            <p className="text-gray-400 mb-8 leading-relaxed">
              {t('homePage.alprDescription')}
            </p>
            <ul className="space-y-4">
              <li className="flex items-center gap-3 text-gray-300">
                <div className="w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center shrink-0">✓</div>
                {t('homePage.highSpeedRecognition')}
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <div className="w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center shrink-0">✓</div>
                {t('homePage.noTickets')}
              </li>
            </ul>
          </div>

          <div className="w-full lg:w-1/2 relative">
             <SmartGate3D />
             {/* Decorative background lighting behind the scene */}
             <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-gold-gradient opacity-10 blur-[100px] rounded-full pointer-events-none -z-10"></div>
          </div>

        </div>
      </section>

      {/* 3. SHOWCASE CAR & DUAL RECOGNITION */}
      <section className="py-20 bg-white border-y border-gray-100 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 flex flex-col lg:flex-row items-center gap-16">
          <div className="w-full lg:w-1/2 relative animate-drive-in">
            <div className="relative z-10 rounded-2xl overflow-hidden shadow-2xl animate-hover-car bg-gray-100 min-h-[400px]">
              <img src={CarImage} alt="Smart Parking Vehicle" className="w-full h-full object-cover absolute inset-0" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-green-400 font-mono text-sm tracking-widest">ALPR SCANNING ACTIVE</span>
                </div>
                <h3 className="text-white text-2xl font-bold font-mono tracking-widest">43A - 123.45</h3>
              </div>
            </div>
            <div className="absolute top-10 -right-10 w-full h-full bg-gold-gradient opacity-10 rounded-2xl -z-10 transform rotate-3"></div>
          </div>

          <div className="w-full lg:w-1/2">
            <h2 className="text-3xl lg:text-4xl font-extrabold mb-6 text-charcoal">
              The Power of <span className="text-gold-gradient">Dual Recognition</span>
            </h2>
            <p className="text-gray-600 mb-8 leading-relaxed">
              We don't just rely on AI Cameras. VALO features cross-validation between Gate Cameras and Dynamic Mobile QRs, ensuring absolute security for your vehicle.
            </p>
            
            <div className="space-y-6">
              <div className="flex gap-4 items-start group">
                <div className="w-12 h-12 rounded-full bg-charcoal text-gold flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Camera size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-lg group-hover:text-gold transition-colors">Ultra-fast AI Camera (1s)</h4>
                  <p className="text-gray-500 text-sm">Multi-thread analysis, recognizing plates the moment your car touches the line.</p>
                </div>
              </div>
              <div className="flex gap-4 items-start group">
                <div className="w-12 h-12 rounded-full bg-yellow-50 border border-yellow-200 text-yellow-700 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <QrCode size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-lg group-hover:text-yellow-700 transition-colors">Dynamic QR Backup</h4>
                  <p className="text-gray-500 text-sm">QR codes refresh every 30s. 100% risk prevention during camera weather disruptions.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. PREMIUM CAR SERVICES */}
      <PremiumCarServicesSection />
      <PublicFeedbackSection onSummaryChange={setFeedbackSummary} />

      {/* 5. HOW IT WORKS */}
      <section className="bg-charcoal text-white py-24 relative">
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-extrabold mb-4"><span className="text-gold-gradient">Touchless</span> Experience</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">Just 2 seconds to pass the gate. VALO's technology completely eliminates traditional paper tickets and cash.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { step: "01", icon: <Smartphone size={28}/>, title: "Book Slot", desc: "Open the VALO app, select your preferred parking slot and time." },
              { step: "02", icon: <Camera size={28}/>, title: "AI Plate Scan", desc: "Drive to the gate, the camera automatically recognizes your plate in 1s." },
              { step: "03", icon: <Car size={28}/>, title: "Park", desc: "The barrier opens automatically. Proceed to your designated slot." },
              { step: "04", icon: <CreditCard size={28}/>, title: "Exit", desc: "The system auto-deducts from your Wallet or VNPay." }
            ].map((item, index) => (
              <div key={index} className="relative group h-full cursor-pointer">
                <div className="bg-[#1A1A1A] border border-gray-800 p-8 rounded-2xl relative z-10 transition-all duration-500 h-full flex flex-col justify-between overflow-hidden group-hover:-translate-y-3 group-hover:border-[#D4AF37]/50 group-hover:shadow-[0_15px_40px_rgba(212,175,55,0.15)]">
                  <div className="text-9xl font-extrabold text-white/5 absolute -top-8 -right-4 z-0 transition-colors duration-500 group-hover:text-gold/10 select-none pointer-events-none">
                    {item.step}
                  </div>
                  <div className="relative z-10">
                    <div className="text-gold mb-6 bg-gold/10 w-14 h-14 rounded-xl flex items-center justify-center transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3">
                      {item.icon}
                    </div>
                    <h4 className="text-xl font-bold mb-3 text-white">{item.title}</h4>
                    <p className="text-gray-400 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
                {index < 3 && <ArrowRight className="hidden md:block absolute top-1/2 -right-6 text-gray-700 z-20 transform -translate-y-1/2 group-hover:text-gold transition-colors duration-300" />}
              </div>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
