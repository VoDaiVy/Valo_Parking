import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, ShieldCheck, Clock, CreditCard, Sparkles } from 'lucide-react';
import { getServiceById } from '../../services/extraServiceApi';
import { buildBookingUrl } from '../../utils/bookingNavigation';

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

const ServiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchService = async () => {
      try {
        const res = await getServiceById(id);
        if (res.ok && res.data.success) {
          setService(res.data.data);
        } else {
          throw new Error(res.data.message || 'Failed to fetch service details');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchService();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex justify-center items-center" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-14 w-14 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: '#D4AF37', borderTopColor: 'transparent' }}
          />
          <p className="text-sm font-semibold tracking-widest uppercase" style={{ color: '#D4AF37' }}>
            Loading...
          </p>
        </div>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center px-4 text-center" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 50%, #0f0f0f 100%)' }}>
        <div className="max-w-md w-full rounded-2xl p-10" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,175,55,0.2)' }}>
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <span className="text-2xl font-bold text-red-400">!</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Service Not Found</h2>
          <p className="text-gray-400 mb-8 text-sm">{error || "The service you are looking for doesn't exist or is currently unavailable."}</p>
          <button
            onClick={() => navigate(-1)}
            className="w-full py-3 px-4 font-bold rounded-xl transition-all duration-300"
            style={{ background: 'linear-gradient(135deg, #C59A3F, #E5C058)', color: '#0f0f0f' }}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const features = [
    { icon: <ShieldCheck size={20} />, label: 'Quality Guaranteed', bg: 'rgba(212,175,55,0.12)', color: '#D4AF37' },
    { icon: <Clock size={20} />,       label: `Estimated ${formatServiceTime(service.timeCost)}`, bg: 'rgba(212,175,55,0.08)', color: '#C59A3F' },
    { icon: <CheckCircle size={20} />, label: 'Trusted Pros',       bg: 'rgba(212,175,55,0.12)', color: '#D4AF37' },
    { icon: <CreditCard size={20} />,  label: 'Secure Payment',     bg: 'rgba(212,175,55,0.08)', color: '#C59A3F' },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 60%, #0f0f0f 100%)' }}>
      {/* Background glow */}
      <div
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] rounded-full pointer-events-none opacity-15 blur-[100px]"
        style={{ background: 'radial-gradient(ellipse, #D4AF37 0%, transparent 70%)' }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* ── Back Button ── */}
        <button
          onClick={() => navigate(-1)}
          className="group flex items-center gap-2 font-medium mb-10 transition-all duration-300"
          style={{ color: 'rgba(212,175,55,0.7)' }}
          onMouseEnter={e => e.currentTarget.style.color = '#D4AF37'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(212,175,55,0.7)'}
        >
          <ArrowLeft size={18} className="transition-transform duration-300 group-hover:-translate-x-1" />
          Back to Services
        </button>

        {/* ── Main Card ── */}
        <div
          className="rounded-3xl overflow-hidden flex flex-col md:flex-row"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(212,175,55,0.2)',
            boxShadow: '0 25px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(212,175,55,0.05)',
          }}
        >
          {/* ── Image ── */}
          <div className="md:w-1/2 relative min-h-[320px] md:min-h-[500px]">
            <img
              src={service.imageUrl}
              alt={service.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Overlay gradients */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/60 hidden md:block" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent md:hidden" />

            {/* Price overlay on image (mobile) */}
            <div className="absolute bottom-6 left-6 md:hidden">
              <span
                className="px-5 py-2 rounded-full text-lg font-black"
                style={{ background: 'linear-gradient(135deg, #C59A3F, #E5C058)', color: '#0f0f0f' }}
              >
                ${service.price.toFixed(2)}
              </span>
            </div>
          </div>

          {/* ── Content ── */}
          <div className="md:w-1/2 p-8 md:p-12 lg:p-16 flex flex-col justify-between">
            <div>
              {/* Badge */}
              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase mb-6"
                style={{ background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)', color: '#D4AF37' }}
              >
                <Sparkles size={12} />
                Premium Service
              </div>

              {/* Name */}
              <h1
                className="text-3xl md:text-4xl font-extrabold text-white mb-4 leading-tight"
                style={{ fontFamily: 'Montserrat, sans-serif' }}
              >
                {service.name}
              </h1>

              {/* Price (desktop) */}
              <div
                className="hidden md:block text-4xl font-black mb-6"
                style={{ background: 'linear-gradient(135deg, #C59A3F, #E5C058, #AA771C)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
              >
                ${service.price.toFixed(2)}
              </div>

              {/* Description */}
              <p className="text-gray-400 leading-relaxed text-base mb-8">
                {service.description}
              </p>

              {/* Feature grid */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                {features.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-xl transition-all duration-300 hover:scale-105"
                    style={{ background: f.bg, border: `1px solid rgba(212,175,55,0.12)` }}
                  >
                    <div style={{ color: f.color }}>{f.icon}</div>
                    <span className="text-sm font-semibold text-gray-300">{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => navigate(buildBookingUrl(service._id || id))}
                className="group relative w-full overflow-hidden py-4 px-6 rounded-xl font-black text-lg transition-all duration-300 hover:-translate-y-1"
                style={{
                  background: 'linear-gradient(135deg, #C59A3F, #E5C058)',
                  color: '#0f0f0f',
                  boxShadow: '0 8px 32px rgba(212,175,55,0.35)',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 12px 40px rgba(212,175,55,0.5)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = '0 8px 32px rgba(212,175,55,0.35)'}
              >
                {/* Shimmer effect */}
                <div
                  className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 pointer-events-none"
                  style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)' }}
                />
                <span className="relative z-10">Add to My Booking</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceDetail;
