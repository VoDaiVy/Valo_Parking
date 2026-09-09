import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Clock, DollarSign, CheckCircle, Star, CircleDollarSign, CalendarDays, ChevronRight } from 'lucide-react';
import { getServices } from '../../services/extraServiceApi';
import { buildBookingUrl } from '../../utils/bookingNavigation';

/* ── Custom Animations ────────────────────────────────────── */
const customStyles = `
  @keyframes cinematicSweep {
    0% { transform: translateX(-100%) rotate(25deg); }
    100% { transform: translateX(200%) rotate(25deg); }
  }
  @keyframes ambientGlow {
    0%, 100% { opacity: 0.08; }
    50% { opacity: 0.15; }
  }
  @keyframes heroEntrance {
    0% { opacity: 0; transform: translateY(10px); }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes cardEntrance {
    0% { opacity: 0; transform: scale(0.98); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes listEntrance {
    0% { opacity: 0; transform: translateX(8px); }
    100% { opacity: 1; transform: translateX(0); }
  }
  .animate-cinematic-sweep {
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(to right, transparent, rgba(245, 197, 66, 0.03), transparent);
    animation: cinematicSweep 12s infinite linear;
    pointer-events: none;
  }
  .animate-ambient-glow {
    animation: ambientGlow 10s infinite ease-in-out;
  }
  .hero-entrance {
    animation: heroEntrance 0.6s ease-out forwards;
  }
  .card-entrance {
    animation: cardEntrance 0.6s ease-out forwards;
  }
  .list-entrance {
    opacity: 0;
    animation: listEntrance 0.4s ease-out forwards;
  }
  /* Hide scrollbar */
  .scrollbar-hidden::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hidden {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
`;

/* ── Helpers ──────────────────────────────────────────────── */
const formatMoney = (value = 0) =>
  `${Number(value || 0).toLocaleString('vi-VN')} VND`;

const formatServiceTime = (timeCost) => {
  const minutes = Number(timeCost);
  if (!Number.isFinite(minutes) || minutes < 1) return '30 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
};

/* ── Sub-components ───────────────────────────────────────── */

/** Compact right-column service navigation card */
const ServiceNavCard = ({ service, isActive, onClick, style }) => (
  <button
    onClick={onClick}
    id={`service-nav-${service._id}`}
    className="w-full text-left relative overflow-hidden rounded-xl transition-all duration-200 group"
    style={{
      background: isActive
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(255,255,255,0.02)',
      border: isActive
        ? '1px solid rgba(245,197,66,0.45)'
        : '1px solid rgba(255,255,255,0.04)',
      boxShadow: isActive
        ? '0 0 15px rgba(245,197,66,0.08)'
        : 'none',
      transform: isActive ? 'translateX(2px)' : 'translateX(0)',
      ...style,
    }}
  >
    {/* Gold left-edge accent */}
    <div
      className="absolute left-0 top-0 bottom-0 w-[4px] rounded-l-xl transition-all duration-200"
      style={{
        background: '#F5C542',
        opacity: isActive ? 1 : 0,
      }}
    />

    <div className="flex items-center gap-3 p-3 pl-4">
      {/* Thumbnail */}
      <div
        className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden transition-all duration-200"
        style={{ border: isActive ? '1px solid rgba(245,197,66,0.3)' : '1px solid rgba(255,255,255,0.06)' }}
      >
        <img
          src={service.imageUrl}
          alt={service.name}
          className="w-full h-full object-cover transition-all duration-250 group-hover:scale-[1.03] group-hover:brightness-[1.08]"
        />
      </div>

      {/* Center: Name & Time */}
      <div className="flex-1 min-w-0 pr-2">
        <p
          className="font-semibold text-sm leading-tight truncate transition-colors duration-200"
          style={{ color: isActive ? '#F5C542' : '#F5F5F5' }}
        >
          {service.name}
        </p>
        <div className="flex items-center gap-1.5 mt-1.5">
          <Clock size={12} style={{ color: isActive ? 'rgba(245,197,66,0.8)' : '#777' }} />
          <span className="text-[11px] font-medium tracking-wide" style={{ color: isActive ? '#ccc' : '#777' }}>
            {formatServiceTime(service.timeCost)}
          </span>
        </div>
      </div>

      {/* Right-center: Price Badge */}
      <div
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full transition-all duration-200 group-hover:shadow-[0_0_8px_rgba(245,197,66,0.2)]"
        style={{ background: '#F5C542' }}
      >
        <span className="text-[13px] font-bold tracking-tight text-[#111111]">
          {formatMoney(service.price)}
        </span>
      </div>

      {/* Far Right: Chevron */}
      <div className="flex-shrink-0 pl-1">
        <ChevronRight 
           size={16} 
           className="transition-colors duration-200 group-hover:text-[#F5C542]" 
           style={{ color: isActive ? '#F5C542' : '#AFAFAF' }} 
        />
      </div>
    </div>
  </button>
);

/* ── Main Page ────────────────────────────────────────────── */
const ServiceList = () => {
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imgLoaded, setImgLoaded] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const prevServiceRef = useRef(null);

  /* Fetch services */
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const res = await getServices(true);
        if (res.ok && res.data.success) {
          const list = res.data.data;
          setServices(list);
          if (list.length > 0) setSelectedId(list[0]._id);
        } else {
          throw new Error(res.data.message || 'Failed to fetch services');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, []);

  const selectedService = services.find((s) => s._id === selectedId) || null;

  /* Smooth transition when switching service */
  const handleSelectService = (id) => {
    if (id === selectedId) return;
    setTransitioning(true);
    setTimeout(() => {
      setSelectedId(id);
      setTransitioning(false);
    }, 250);
  };

  /* ── Loading ── */
  if (loading) {
    return (
      <div
        className="min-h-screen flex justify-center items-center"
        style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-12 w-12 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: '#D4AF37', borderTopColor: 'transparent' }}
          />
          <p className="text-xs font-bold tracking-widest uppercase" style={{ color: '#D4AF37' }}>
            Loading Services...
          </p>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div
        className="min-h-screen flex justify-center items-center px-4"
        style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}
      >
        <div
          className="max-w-md w-full rounded-2xl border p-8 text-center"
          style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(212,175,55,0.2)' }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <span className="text-xl font-bold text-red-400">!</span>
          </div>
          <p className="font-bold text-lg text-white mb-2">Something went wrong</p>
          <p className="text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ backgroundColor: '#0B0B0A' }}
    >
      <style>{customStyles}</style>

      {/* Blurred Background Image Layer */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'url("/bg-garage.png")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
          filter: 'blur(5px)',
          transform: 'scale(1.02)', /* Prevent blurred edges */
        }}
      />

      {/* Background cinematic overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(11,11,10,0.4)' }}>
        {/* Deep gradient layer to darken the center for UI readability */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at center, rgba(11,11,10,0.8) 0%, transparent 100%)' }} />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            COMPACT HERO
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div className="text-center pt-16 md:pt-20 pb-6 max-w-2xl mx-auto hero-entrance">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 py-1 px-4 rounded-full text-xs font-bold tracking-widest uppercase mb-4"
            style={{
              background: 'rgba(212,175,55,0.10)',
              border: '1px solid rgba(212,175,55,0.28)',
              color: '#D4AF37',
            }}
          >
            <Sparkles size={11} />
            Premium Add-Ons
          </div>

          {/* Heading */}
          <h1
            className="text-2xl md:text-3xl font-extrabold text-white mb-3 leading-tight"
            style={{ fontFamily: 'Montserrat, sans-serif' }}
          >
            Elevate Your{' '}
            <span className="text-gold-gradient">Parking Experience</span>
          </h1>

          {/* Subtext */}
          <p className="text-[13px] md:text-[14px] text-gray-400 leading-relaxed max-w-xl mx-auto">
            Choose from our exclusive range of extra services. From a sparkling
            car wash to dedicated valet, we ensure your vehicle gets the best
            treatment while you're away.
          </p>
        </div>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            MASTER-DETAIL EXPLORER
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {services.length === 0 ? (
          <div className="text-center py-20">
            <div
              className="inline-flex items-center gap-3 px-8 py-5 rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Star size={18} className="text-gray-500" />
              <p className="text-gray-400 font-medium text-sm">
                No premium services available at the moment. Please check back later.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-5 pb-12">

            {/* ─────────────────────────────────────────────
                LEFT — SELECTED SERVICE PANEL (60%)
            ───────────────────────────────────────────── */}
            <div className="lg:w-[60%] flex-shrink-0">
              {selectedService && (
                <div
                  className="rounded-2xl overflow-hidden card-entrance"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(212,175,55,0.18)',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(212,175,55,0.04)',
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  {/* Service Image */}
                  <div className="relative w-full overflow-hidden" style={{ aspectRatio: '16/9', maxHeight: '350px' }}>
                    <img
                      key={selectedService._id}
                      src={selectedService.imageUrl}
                      alt={selectedService.name}
                      className="w-full h-full object-cover"
                      style={{
                        opacity: transitioning ? 0 : 1,
                        transform: transitioning ? 'scale(1.02)' : 'scale(1)',
                        transition: 'opacity 250ms ease, transform 250ms ease',
                        maxHeight: '280px',
                      }}
                    />
                    {/* Cinematic bottom gradient */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          'linear-gradient(to top, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.3) 40%, transparent 100%)',
                      }}
                    />
                    {/* Side gradient to blend with card bg */}
                    <div
                      className="absolute inset-0 hidden lg:block"
                      style={{
                        background:
                          'linear-gradient(to right, transparent 85%, rgba(10,10,10,0.4) 100%)',
                      }}
                    />
                  </div>

                  {/* Service Info */}
                  <div
                    className="p-5 md:p-6"
                    style={{
                      opacity: transitioning ? 0 : 1,
                      transform: transitioning ? 'translateY(6px)' : 'translateY(0)',
                      transition: 'opacity 250ms ease, transform 250ms ease',
                    }}
                  >
                    {/* Name + Meta row */}
                    <div className="flex flex-col sm:flex-row sm:items-stretch sm:justify-between gap-6 h-full">
                      {/* Left: Name & Description & Badges */}
                      <div className="flex-1 min-w-0 sm:pr-4">
                        <h2
                          className="text-xl md:text-2xl font-bold text-white mb-3 leading-tight"
                          style={{ fontFamily: 'Montserrat, sans-serif' }}
                        >
                          {selectedService.name}
                        </h2>
                        <p
                          className="text-[13px] md:text-sm leading-relaxed mb-8"
                          style={{ color: 'rgba(200,200,200,0.7)', lineHeight: '1.65' }}
                        >
                          {selectedService.description}
                        </p>

                        {/* Trust badges */}
                        <div className="flex flex-wrap gap-4 mt-auto">
                          {[
                            'Quality Guaranteed',
                            'Professional Staff',
                            'Secure Payment',
                          ].map((label) => (
                            <div
                              key={label}
                              className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide"
                              style={{ color: 'rgba(212,175,55,0.75)' }}
                            >
                              <CheckCircle size={12} style={{ color: '#D4AF37' }} />
                              {label}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Right: Price + Duration + CTA */}
                      <div className="flex-shrink-0 flex flex-col sm:flex-row gap-6 pt-6 sm:pt-0 w-full sm:w-auto">
                        {/* Vertical divider on desktop */}
                        <div className="hidden sm:block w-px bg-white/10 self-stretch" />
                        
                        <div className="flex flex-col justify-between w-full sm:w-auto sm:pl-2 h-full">
                          <div className="flex flex-col gap-4 mb-6 sm:mb-auto">
                            {/* Price */}
                            <div className="flex items-center gap-3">
                              <CircleDollarSign
                                size={18}
                                style={{ color: '#D4AF37', flexShrink: 0 }}
                              />
                              <span
                                className="text-xl md:text-2xl font-black tracking-tight"
                                style={{
                                  background: 'linear-gradient(135deg, #C59A3F, #E5C058)',
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text',
                                }}
                              >
                                {formatMoney(selectedService.price)}
                              </span>
                            </div>
                            {/* Duration */}
                            <div className="flex items-center gap-3 pl-0.5">
                              <Clock
                                size={16}
                                style={{ color: 'rgba(160,160,160,0.8)', flexShrink: 0 }}
                              />
                              <span
                                className="text-sm font-medium"
                                style={{ color: 'rgba(180,180,180,0.8)' }}
                              >
                                {formatServiceTime(selectedService.timeCost)}
                              </span>
                            </div>
                          </div>

                          {/* CTA */}
                          <div className="mt-auto">
                            <AddToBookingButton
                              onClick={() => navigate(buildBookingUrl(selectedService._id))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ─────────────────────────────────────────────
                RIGHT — SERVICE NAVIGATION LIST (40%)
            ───────────────────────────────────────────── */}
            <div className="lg:w-[40%] flex-shrink-0">
              <div className="h-full">
                <p
                  className="text-[10px] font-bold tracking-widest uppercase mb-3 px-1"
                  style={{ color: 'rgba(212,175,55,0.5)' }}
                >
                  All Services
                </p>

                {/* Scrollable on mobile when many services */}
                <div
                  className="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto scrollbar-hidden pr-1 pb-4"
                  style={{ maxHeight: 'calc(100vh - 280px)' }}
                >
                  {services.map((service, idx) => (
                    <div 
                      key={service._id} 
                      className="flex-shrink-0 lg:flex-shrink lg:w-full list-entrance" 
                      style={{ minWidth: '180px', animationDelay: `${idx * 70}ms` }}
                    >
                      <ServiceNavCard
                        service={service}
                        isActive={service._id === selectedId}
                        onClick={() => handleSelectService(service._id)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};

/* ── Add to Booking Button ────────────────────────────────── */
const AddToBookingButton = ({ onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  return (
    <button
      id="add-to-booking-btn"
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setIsPressed(false); }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      className="relative w-full sm:w-auto overflow-hidden px-7 py-3 rounded-full font-bold text-sm tracking-wide transition-all duration-250 flex justify-center items-center gap-2"
      style={{
        background: isHovered
          ? 'linear-gradient(135deg, #C59A3F, #E5C058)'
          : 'rgba(255,255,255,0.92)',
        color: isHovered ? '#0f0f0f' : '#111',
        boxShadow: isHovered
          ? '0 8px 28px rgba(212,175,55,0.38), 0 0 0 1px rgba(212,175,55,0.25)'
          : '0 4px 16px rgba(0,0,0,0.25)',
        transform: isPressed ? 'scale(0.98)' : isHovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      {/* Shimmer */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: isHovered ? 'shimmer 0.7s ease-in-out' : 'none',
          opacity: isHovered ? 1 : 0,
        }}
      />
      <span className="relative z-10 flex items-center gap-2">
        <CalendarDays size={16} />
        Add to Booking
      </span>
    </button>
  );
};

export default ServiceList;
