import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, CheckCircle2, ArrowRight, Star, Clock } from 'lucide-react';
import { getServices } from '../../services/extraServiceApi';

const formatMoney = (value = 0) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;

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

const ServiceList = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const res = await getServices(true);
        if (res.ok && res.data.success) {
          setServices(res.data.data);
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

  if (loading) {
    return (
      <div className="min-h-screen flex justify-center items-center" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-14 w-14 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: '#D4AF37', borderTopColor: 'transparent' }}
          />
          <p className="text-sm font-semibold tracking-widest uppercase" style={{ color: '#D4AF37' }}>
            Loading Services...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex justify-center items-center px-4" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
        <div className="max-w-md w-full rounded-2xl border p-8 text-center" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(212,175,55,0.2)' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <span className="text-2xl font-bold text-red-400">!</span>
          </div>
          <p className="font-bold text-lg text-white mb-2">Something went wrong</p>
          <p className="text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 60%, #0f0f0f 100%)' }}>
      {/* Decorative background orb */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-full pointer-events-none opacity-20 blur-[120px]"
        style={{ background: 'radial-gradient(ellipse, #D4AF37 0%, transparent 70%)' }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">

        {/* ── Header ── */}
        <div className="text-center max-w-3xl mx-auto mb-20">
          <div
            className="inline-flex items-center gap-2 py-1.5 px-5 rounded-full text-xs font-bold tracking-widest uppercase mb-6"
            style={{ background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.3)', color: '#D4AF37' }}
          >
            <Sparkles size={14} />
            Premium Add-ons
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-5 leading-tight">
            Elevate Your{' '}
            <span className="text-gold-gradient">Parking Experience</span>
          </h1>
          <p className="text-lg text-gray-400 leading-relaxed">
            Choose from our exclusive range of extra services. From a sparkling car wash to dedicated valet, we ensure your vehicle gets the best treatment while you're away.
          </p>
        </div>

        {/* ── Service Cards ── */}
        {services.length === 0 ? (
          <div className="text-center py-20">
            <div
              className="inline-flex items-center gap-3 px-8 py-5 rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Star size={20} className="text-gray-500" />
              <p className="text-gray-400 font-medium">No premium services available at the moment. Please check back later.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {services.map((service, idx) => (
              <div
                key={service._id}
                className="group relative flex flex-col rounded-2xl overflow-hidden transition-all duration-500 hover:-translate-y-2"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                  animationDelay: `${idx * 80}ms`,
                }}
              >
                {/* Hover border glow */}
                <div
                  className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{ border: '1px solid rgba(212,175,55,0.4)', boxShadow: '0 0 40px rgba(212,175,55,0.08) inset' }}
                />

                {/* ── Image ── */}
                <div className="relative h-52 overflow-hidden flex-shrink-0">
                  <img
                    src={service.imageUrl}
                    alt={service.name}
                    className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700 ease-out"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Price badge */}
                  <div
                    className="absolute bottom-4 left-4 px-4 py-1.5 rounded-full text-sm font-bold"
                    style={{ background: 'linear-gradient(135deg, #C59A3F, #E5C058)', color: '#0f0f0f' }}
                  >
                    {formatMoney(service.price)}
                  </div>
                </div>

                {/* ── Content ── */}
                <div className="p-6 flex flex-col flex-1">
                  <h3
                    className="text-lg font-bold text-white mb-3 transition-colors duration-300"
                    style={{ fontFamily: 'Montserrat, sans-serif' }}
                  >
                    {service.name}
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed mb-5 flex-1 line-clamp-3">
                    {service.description}
                  </p>

                  {/* Features */}
                  <ul className="mb-6 space-y-2">
                    <li className="flex items-center gap-2 text-xs text-gray-400">
                      <CheckCircle2 size={14} style={{ color: '#D4AF37' }} />
                      Professional staff
                    </li>
                    <li className="flex items-center gap-2 text-xs text-gray-400">
                      <Clock size={14} style={{ color: '#D4AF37' }} />
                      Estimated time: {formatServiceTime(service.timeCost)}
                    </li>
                  </ul>

                  {/* CTA */}
                  <Link
                    to={`/services/${service._id}`}
                    className="group/btn relative flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl font-bold text-sm transition-all duration-300 overflow-hidden"
                    style={{
                      background: 'rgba(212,175,55,0.1)',
                      border: '1px solid rgba(212,175,55,0.3)',
                      color: '#D4AF37',
                    }}
                  >
                    <span className="relative z-10 flex items-center gap-2 transition-colors duration-300 group-hover/btn:text-black">
                      View Details
                      <ArrowRight size={15} className="transition-transform duration-300 group-hover/btn:translate-x-1" />
                    </span>
                    {/* Fill effect */}
                    <div
                      className="absolute inset-0 scale-x-0 group-hover/btn:scale-x-100 transition-transform duration-300 origin-left"
                      style={{ background: 'linear-gradient(135deg, #C59A3F, #E5C058)' }}
                    />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ServiceList;
