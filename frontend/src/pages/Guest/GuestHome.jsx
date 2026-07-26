import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShieldCheck, Zap, Camera, Car, CreditCard, ArrowRight, Smartphone, QrCode, Wrench, Sparkles, Clock, ChevronDown } from 'lucide-react';

// Import images
import CarImage from '../../assets/images/car.png';

// Import Component 3D
import SmartGate3D from '../../components/SmartGate3D';

import { getServices } from '../../services/extraServiceApi';
import { getLiveMapData } from '../../services/parkingFloorService';

const SERVICE_PRESENTATION = [
  {
    badge: 'Most Requested',
    icon: Sparkles,
    fallbackImage: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1400&q=80',
  },
  {
    badge: 'Fast Care',
    icon: Zap,
    fallbackImage: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=1400&q=80',
  },
  {
    badge: 'Cabin Care',
    icon: ShieldCheck,
    fallbackImage: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1400&q=80',
  },
  {
    badge: 'Safety Add-on',
    icon: Wrench,
    fallbackImage: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=1400&q=80',
  },
  {
    badge: 'Smart Energy',
    icon: CreditCard,
    fallbackImage: 'https://images.unsplash.com/photo-1593941707882-a5bba14938c7?auto=format&fit=crop&w=1400&q=80',
  },
  {
    badge: 'VIP Flow',
    icon: Car,
    fallbackImage: 'https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?auto=format&fit=crop&w=1400&q=80',
  },
];

const formatServicePrice = (price) => {
  const amount = Number(price);

  if (!Number.isFinite(amount)) {
    return 'Contact us';
  }

  return `${amount.toLocaleString('vi-VN')} VND`;
};

const formatServiceTime = (timeCost) => {
  const minutes = Number(timeCost);

  if (!Number.isFinite(minutes) || minutes < 1) {
    return '30 min';
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const mapServiceFromApi = (service, index) => {
  const presentation = SERVICE_PRESENTATION[index % SERVICE_PRESENTATION.length];

  return {
    id: service._id || service.id || `service-${index}`,
    title: service.name || 'Premium Service',
    price: formatServicePrice(service.price),
    desc: service.description || 'Premium vehicle care handled during your VALO parking session.',
    image: service.imageUrl || presentation.fallbackImage,
    badge: presentation.badge,
    duration: formatServiceTime(service.timeCost),
    icon: presentation.icon,
  };
};

const PremiumCarServicesSection = () => {
  const [services, setServices] = useState([]);
  const [activeService, setActiveService] = useState(null);
  const [fade, setFade] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fadeTimeoutRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    const fetchPremiumServices = async () => {
      try {
        const res = await getServices(true);

        if (!isMounted) return;

        if (res.ok && res.data?.success) {
          const mappedServices = (res.data.data || []).map(mapServiceFromApi);

          setServices(mappedServices);
          setActiveService(mappedServices[0] || null);
          setError('');
          return;
        }

        throw new Error(res.data?.message || 'Failed to fetch services');
      } catch (err) {
        if (!isMounted) return;

        setServices([]);
        setActiveService(null);
        setError(err.message || 'Failed to fetch services');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPremiumServices();

    return () => {
      isMounted = false;
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, []);

  const handleServiceSelect = (service) => {
    if (!activeService || service.id === activeService.id) return;

    setFade(false);
    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
    }

    fadeTimeoutRef.current = setTimeout(() => {
      setActiveService(service);
      setFade(true);
    }, 220);
  };

  const handleNextService = () => {
    if (!activeService || services.length < 2) return;

    const currentIndex = services.findIndex((service) => service.id === activeService.id);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % services.length;

    handleServiceSelect(services[nextIndex]);
  };

  const ActiveIcon = activeService?.icon || Sparkles;
  const activeIndex = activeService ? services.findIndex((service) => service.id === activeService.id) : -1;
  const visibleServices = activeIndex >= 0
    ? Array.from({ length: Math.min(4, services.length) }, (_, offset) => services[(activeIndex + offset) % services.length])
    : services.slice(0, 4);

  return (
    <section className="bg-[#121212] text-white py-12 lg:py-14 relative overflow-hidden border-y border-gray-800">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"></div>
      <div className="absolute -top-32 right-10 w-[420px] h-[420px] bg-gold-gradient opacity-10 blur-[120px] rounded-full pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="max-w-3xl mx-auto text-center mb-9">
          <div className="inline-flex items-center gap-2 py-1.5 px-4 rounded-full bg-white/5 border border-white/10 text-gold text-xs font-bold tracking-wider mb-3 uppercase">
            <Sparkles size={14} /> Premium Add-ons
          </div>
          <h2 className="text-3xl lg:text-4xl font-extrabold leading-tight mb-3">
            Premium Car <span className="text-gold-gradient">Services</span>
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Upgrade every parking session with curated vehicle care, safety checks, and VIP pickup options handled while your car stays inside VALO.
          </p>
        </div>

        {loading && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start max-w-6xl mx-auto animate-pulse">
            <div className="lg:col-span-5">
              <div className="w-full max-w-[410px] mx-auto h-[430px] lg:h-[460px] rounded-[26px] bg-[#1A1A1A] border border-white/10"></div>
            </div>
            <div className="lg:col-span-7 space-y-3">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className={`${item === 1 ? 'h-32' : 'h-20'} rounded-[22px] bg-[#1A1A1A] border border-gray-800`}></div>
              ))}
            </div>
          </div>
        )}

        {!loading && (error || !activeService) && (
          <div className="rounded-2xl border border-white/10 bg-[#1A1A1A] p-10 text-center">
            <Sparkles size={28} className="text-gold mx-auto mb-4" />
            <h3 className="text-xl font-extrabold text-white mb-2">
              {error ? 'Services are temporarily unavailable' : 'No premium services available'}
            </h3>
            <p className="text-gray-400 text-sm max-w-xl mx-auto">
              {error || 'Please add active services from the admin dashboard to display them here.'}
            </p>
          </div>
        )}

        {!loading && activeService && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start max-w-6xl mx-auto">
            <div className="lg:col-span-5">
              <div className="relative w-full max-w-[410px] mx-auto h-[430px] lg:h-[460px] rounded-[26px] overflow-hidden border border-white/10 bg-[#1A1A1A] shadow-2xl">
                <img
                  src={activeService.image}
                  alt={activeService.title}
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ease-out ${fade ? 'opacity-100 scale-100' : 'opacity-40 scale-105'}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal/75 via-transparent to-black/10"></div>
                <div className={`absolute left-5 right-5 bottom-5 transition-all duration-300 ${fade ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
                  <div className="flex max-w-full items-center gap-3 rounded-2xl border border-white/15 bg-white/90 p-3 text-charcoal shadow-xl backdrop-blur">
                    <div className="w-11 h-11 rounded-xl bg-gold text-charcoal flex items-center justify-center shrink-0">
                      <ActiveIcon size={21} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold truncate">{activeService.title}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-[0.18em] font-bold truncate">
                        {activeService.badge}
                      </p>
                    </div>
                    <Link
                      to={`/services/${activeService.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gold-gradient px-4 py-2.5 text-xs font-extrabold text-charcoal shadow-[0_10px_24px_rgba(212,175,55,0.24)] transition-all hover:scale-105"
                    >
                      Book Now
                      <ArrowRight size={13} />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="relative space-y-3">
                {services.length > 1 && (
                  <button
                    type="button"
                    onClick={handleNextService}
                    className="absolute left-1/2 top-[122px] z-20 hidden h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-gold/40 bg-[#121212] text-gold shadow-[0_10px_30px_rgba(0,0,0,0.35),0_0_0_6px_rgba(18,18,18,0.75)] transition-all hover:-translate-y-0.5 hover:border-gold hover:bg-gold hover:text-charcoal lg:flex"
                    aria-label="Show next service"
                  >
                    <ChevronDown size={20} />
                  </button>
                )}
                {visibleServices.map((service) => {
                  const Icon = service.icon;
                  const isActive = service.id === activeService.id;

                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => handleServiceSelect(service)}
                      aria-pressed={isActive}
                      className={`group relative w-full overflow-hidden text-left rounded-[24px] border transition-all duration-300 ${
                        isActive
                          ? 'min-h-[132px] border-gold/70 bg-[linear-gradient(135deg,rgba(212,175,55,0.12),rgba(26,26,26,0.96)_48%,rgba(26,26,26,1))] p-5 shadow-[0_14px_34px_rgba(0,0,0,0.24),0_6px_22px_rgba(212,175,55,0.07)]'
                          : 'min-h-[76px] border-white/10 bg-[#181818] p-3.5 hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#202020]'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-gold-gradient"></div>
                      )}
                      <div className={`flex gap-4 ${isActive ? 'items-start' : 'items-center'}`}>
                        <div className={`rounded-xl flex items-center justify-center shrink-0 transition-all duration-300 ${
                          isActive
                            ? 'w-14 h-14 rounded-2xl bg-gold-gradient text-charcoal shadow-[0_10px_24px_rgba(212,175,55,0.2)]'
                            : 'w-10 h-10 bg-white/5 text-gold group-hover:bg-gold/10'
                        }`}>
                          <Icon size={isActive ? 23 : 18} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className={`font-extrabold text-white truncate ${isActive ? 'text-lg' : 'text-sm'}`}>
                                  {service.title}
                                </h4>
                                {isActive && (
                                  <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full border border-gold/30 bg-gold/10 text-gold text-[10px] font-bold uppercase tracking-wider">
                                    {service.badge}
                                  </span>
                                )}
                              </div>
                              <p className={`text-gray-400 leading-relaxed transition-all duration-300 ${
                                isActive ? 'mt-1.5 text-sm line-clamp-1' : 'mt-1 text-xs line-clamp-1'
                              }`}>
                                {service.desc}
                              </p>
                            </div>
                            <span className={`text-gold font-mono font-bold whitespace-nowrap ${isActive ? 'text-base' : 'text-sm'}`}>
                              {service.price}
                            </span>
                          </div>

                          <div className={`flex items-center justify-between ${isActive ? 'mt-3' : 'mt-2.5'}`}>
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-500">
                              <Clock size={13} className="text-gold" /> {service.duration}
                            </span>
                            {isActive ? (
                              <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3.5 py-1.5 text-xs font-extrabold text-gold">
                                Selected
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-600 group-hover:text-gold">
                                View <ArrowRight size={12} />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {services.length > 1 && (
                <button
                  type="button"
                  onClick={handleNextService}
                  className="mx-auto mt-4 flex h-10 w-10 items-center justify-center rounded-full border border-gold/30 bg-white/5 text-gold transition-all hover:border-gold hover:bg-gold hover:text-charcoal lg:hidden"
                  aria-label="Show next service"
                >
                  <ChevronDown size={19} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default function GuestHome() {
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
            <Zap size={14} className="text-yellow-600" /> AI Recognition System 2.0
          </div>
          <h1 className="text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
            The New Era of<br />
            <span className="text-gold-gradient">Smart Parking.</span>
          </h1>
          <p className="text-lg text-gray-600 mb-8 max-w-lg leading-relaxed">
            Touchless check-in with AI Cameras. Preview parking availability in real-time. One-touch payment via VALO Wallet.
          </p>
          <div className="w-full max-w-md bg-white p-2 rounded-xl shadow-xl border border-gray-100 flex gap-2 hover:shadow-2xl transition-shadow duration-300">
            <div className="flex items-center pl-3 text-gray-400">
              <Search size={20} />
            </div>
            <input type="text" placeholder="Enter license plate (e.g., 43A-123.45)..." className="flex-1 bg-transparent px-2 py-3 outline-none text-gray-700 font-semibold placeholder-gray-400" />
            <button className="bg-charcoal text-white px-6 py-3 rounded-lg font-bold hover:bg-black hover:scale-105 transition-all whitespace-nowrap">Check</button>
          </div>
        </div>

        <div className="w-full lg:w-1/2 relative">
          <div className="absolute inset-0 bg-gold-gradient opacity-10 blur-3xl rounded-full transform -translate-y-10"></div>
          <div onClick={handleMapClick} className={`bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 relative overflow-hidden scan-line group ${isLoggedIn ? 'cursor-pointer hover:shadow-[0_0_25px_rgba(255,213,85,0.4)]' : ''}`}>
            <div className="flex justify-between items-center mb-6 border-b border-gray-50 pb-4">
              <div>
                <h3 className="font-bold text-lg text-charcoal">Live Grid Map {isLoggedIn ? '(100%)' : '(50%)'}</h3>
                <p className="text-xs text-gray-400">{isLoggedIn ? 'Click to view full interactive map' : 'Current parking status'}</p>
              </div>
              <div className="bg-green-50 text-green-600 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 border border-green-100">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div> {mapStats.available}/{mapStats.total} Available
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 relative">
              {mapData.length > 0 ? (
                mapData.map((slot) => {
                  if (slot.status === 'available') {
                    return (
                      <div key={slot.id} className={`bg-white border-2 border-green-400 rounded-lg p-3 h-24 flex flex-col justify-center items-center transition-all duration-300 ${pulse ? 'shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''}`}>
                        <span className="text-xs font-bold text-green-600">{slot.id}</span>
                        <span className="text-[10px] font-bold text-green-500 mt-2 uppercase tracking-wider bg-green-50 px-2 py-1 rounded">Empty</span>
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
                        <span className="text-[10px] font-bold text-yellow-600 mt-2 uppercase tracking-wider">Booked</span>
                      </div>
                    );
                  } else {
                    return (
                      <div key={slot.id} className="bg-charcoal border border-gray-800 rounded-lg p-3 h-24 flex flex-col justify-center items-center">
                        <span className="text-xs font-bold text-gray-500">{slot.id}</span>
                        <span className="text-[10px] font-bold text-white mt-2 uppercase tracking-wider text-center">Maintain</span>
                      </div>
                    );
                  }
                })
              ) : (
                <>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-01</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className={`bg-white border-2 border-green-400 rounded-lg p-3 h-24 flex flex-col justify-center items-center transition-all duration-300 ${pulse ? 'shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''}`}><span className="text-xs font-bold text-green-600">A-02</span><span className="text-[10px] font-bold text-green-500 mt-2 uppercase tracking-wider bg-green-50 px-2 py-1 rounded">Empty</span></div>
                  <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-yellow-700">A-03</span><span className="text-[10px] font-bold text-yellow-600 mt-2 uppercase tracking-wider">Booked</span></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-04</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className={`bg-white border-2 border-green-400 rounded-lg p-3 h-24 flex flex-col justify-center items-center transition-all duration-300 ${!pulse ? 'shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''}`}><span className="text-xs font-bold text-green-600">A-05</span><span className="text-[10px] font-bold text-green-500 mt-2 uppercase tracking-wider bg-green-50 px-2 py-1 rounded">Empty</span></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-06</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-400">A-07</span><Car size={24} className="text-gray-600 mt-2" /></div>
                  <div className="bg-charcoal border border-gray-800 rounded-lg p-3 h-24 flex flex-col justify-center items-center"><span className="text-xs font-bold text-gray-500">A-08</span><span className="text-[10px] font-bold text-white mt-2 uppercase tracking-wider text-center">Maintain</span></div>
                </>
              )}
            </div>
            {!isLoggedIn && (
              <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center pb-6">
                <button onClick={(e) => { e.stopPropagation(); navigate('/login'); }} className="bg-charcoal text-white font-bold py-3 px-8 rounded-full text-sm shadow-xl hover:-translate-y-1 hover:shadow-2xl transition transform flex items-center gap-2 border border-gray-700">
                  <ShieldCheck size={16} className="text-gold" /> Log in to view 100% of the map
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
              <Camera size={14} /> Seamless Check-in
            </div>
            <h2 className="text-3xl lg:text-4xl font-extrabold mb-6">
              Automated <span className="text-gold-gradient">ALPR Gate</span>
            </h2>
            <p className="text-gray-400 mb-8 leading-relaxed">
              Experience the magic of 100% touchless entry. Just drive up to the barrier. Our AI cameras instantly read your license plate, cross-check your booking, and open the gate in less than a second.
            </p>
            <ul className="space-y-4">
              <li className="flex items-center gap-3 text-gray-300">
                <div className="w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center shrink-0">✓</div>
                High-speed recognition (0.5s response time).
              </li>
              <li className="flex items-center gap-3 text-gray-300">
                <div className="w-6 h-6 rounded-full bg-gold/20 text-gold flex items-center justify-center shrink-0">✓</div>
                No tickets, no stopping, no windows down.
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
