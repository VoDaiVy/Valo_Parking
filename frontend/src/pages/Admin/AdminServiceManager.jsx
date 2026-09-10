import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Transition } from '@headlessui/react';
import { 
  Pencil, Trash2, Plus, X, CheckCircle, 
  Package, Clock, DollarSign, Sparkles, ImagePlus, 
  Eye, Search, Calendar, LayoutGrid, List as ListIcon,
  UploadCloud, AlertTriangle, ChevronDown, Check, Star, Wrench
} from 'lucide-react';
import { getServices, createService, updateService, deleteService } from '../../services/extraServiceApi';
import toast, { Toaster } from 'react-hot-toast';

// --- Animated Counter ---------------------------------------------------------
function AnimatedCounter({ target, duration = 1200, isCurrency, isTime }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === undefined || target === null) return;
    let frame;
    const start = performance.now();
    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(eased * target);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  if (isCurrency) {
    return (
      <span className="flex items-baseline gap-1">
        <span>
          {Math.round(count).toLocaleString('vi-VN')}
        </span>
        <span className="text-lg text-white/70 font-semibold">₫</span>
      </span>
    );
  }
  if (isTime) {
    return (
      <span className="flex items-baseline gap-1.5">
        <span>{Math.round(count).toLocaleString('en-US')}</span>
        <span className="text-[13px] text-white/60 font-semibold tracking-wide uppercase">min</span>
      </span>
    );
  }
  return <span>{Math.round(count).toLocaleString('en-US')}</span>;
}

// --- Stat Card ----------------------------------------------------------------
function StatCard({ icon: Icon, label, value, sub, toneClass, subTone = 'text-emerald-300', loading, index, isCurrency, isTime }) {
  const dividerClass = [
    index > 0 ? 'border-t border-white/10' : '',
    index % 2 === 1 ? 'sm:border-l sm:border-white/10' : '',
    index > 1 ? 'sm:border-t sm:border-white/10' : 'sm:border-t-0',
    index > 0 ? 'xl:border-l xl:border-white/10' : '',
    'xl:border-t-0',
  ].join(' ');

  return (
    <div className={dividerClass}>
      <div className="group min-w-0 px-0 py-4 transition hover:bg-white/[0.018] sm:px-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition group-hover:brightness-125 ${toneClass}`}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-200/55">{label}</p>
            {loading ? (
              <div className="mt-3 h-8 w-20 animate-pulse rounded bg-white/10" />
            ) : (
              <p className="mt-2 truncate font-mono text-3xl font-black leading-none text-white">
                <AnimatedCounter target={value} isCurrency={isCurrency} isTime={isTime} />
              </p>
            )}
            <p className={`mt-2 truncate text-sm font-semibold ${subTone}`}>
              {sub}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main Component -----------------------------------------------------------
const AdminServiceManager = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters, Sort & View
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'

  // Modals & Panels
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  // Selected Services
  const [editingService, setEditingService] = useState(null);
  const [viewingService, setViewingService] = useState(null); // For Right Side Panel

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    timeCost: '30',
    isActive: true,
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [formError, setFormError] = useState('');
  
  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Styles
  const goldGrad = 'linear-gradient(135deg, #C59A3F, #E5C058)';

  const fetchServices = async () => {
    try {
      setLoading(true);
      const res = await getServices(false);
      if (res.ok && res.data.success) {
        setServices(res.data.data);
      } else {
        toast.error(res.data.message || 'Failed to fetch services');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to fetch services');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchServices();
  }, []);



  // KPIs
  const totalServices = services.length;
  const activeServices = services.filter(s => s.isActive).length;
  const avgPrice = totalServices > 0 ? services.reduce((acc, s) => acc + s.price, 0) / totalServices : 0;
  const avgTime = totalServices > 0 ? services.reduce((acc, s) => acc + (s.timeCost || 0), 0) / totalServices : 0;
  // Filter & Sort Logic
  const filteredAndSortedServices = useMemo(() => {
    let result = [...services];

    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(s => 
        s.name.toLowerCase().includes(lowerSearch) || 
        s.description.toLowerCase().includes(lowerSearch)
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter(s => statusFilter === 'active' ? s.isActive : !s.isActive);
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.createdAt) - new Date(a.createdAt);
        case 'oldest': return new Date(a.createdAt) - new Date(b.createdAt);
        case 'price_desc': return b.price - a.price;
        case 'price_asc': return a.price - b.price;
        case 'name_asc': return a.name.localeCompare(b.name);
        default: return 0;
      }
    });

    return result;
  }, [services, searchTerm, statusFilter, sortBy]);

  // Handlers
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const validateForm = () => {
    if (!formData.name || formData.name.length < 3) return "Service name must be at least 3 characters.";
    if (!formData.description || formData.description.length < 5) return "Description must be at least 5 characters.";
    if (!formData.price || Number(formData.price) <= 0) return "Price must be greater than 0.";
    if (!formData.timeCost || Number(formData.timeCost) <= 0) return "Time cost must be greater than 0 minutes.";
    if (!editingService && !imageFile) return "Image is required for new services.";
    return null;
  };

  const handleImageSelect = (file) => {
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setFormError("Invalid file type. Please upload JPEG, PNG, or WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError("File size exceeds 5MB limit.");
      return;
    }
    setFormError('');
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageSelect(e.dataTransfer.files[0]);
    }
  };

  const openModal = (service = null) => {
    if (service) {
      setEditingService(service);
      setFormData({
        name: service.name,
        description: service.description,
        price: service.price,
        timeCost: service.timeCost ?? 30,
        isActive: service.isActive,
      });
      setImagePreview(service.imageUrl);
      setImageFile(null);
    } else {
      setEditingService(null);
      setFormData({ name: '', description: '', price: '', timeCost: '30', isActive: true });
      setImagePreview('');
      setImageFile(null);
    }
    setFormError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingService(null);
    setFormError('');
  };

  const openViewModal = (service) => {
    setViewingService(service);
    setIsViewModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setLoading(true);
    setFormError('');

    try {
      const submitData = new FormData();
      submitData.append('name', formData.name);
      submitData.append('description', formData.description);
      submitData.append('price', formData.price);
      submitData.append('timeCost', formData.timeCost);
      submitData.append('isActive', formData.isActive);

      if (imageFile) {
        submitData.append('image', imageFile);
      }

      const res = editingService
        ? await updateService(editingService._id, submitData)
        : await createService(submitData);

      if (res.ok && res.data.success) {
        toast.success(`Service ${editingService ? 'updated' : 'created'} successfully`);
        fetchServices();
        closeModal();
      } else {
        throw new Error(res.data.message || 'Action failed');
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (service) => {
    setEditingService(service);
    setIsDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await deleteService(editingService._id);
      if (res.ok && res.data.success) {
        toast.success('Service deleted successfully');
        fetchServices();
        setIsDeleteModalOpen(false);
        setEditingService(null);
        if (viewingService?._id === editingService._id) setIsViewModalOpen(false);
      } else {
        throw new Error(res.data.message || 'Failed to delete service');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-2.5 bg-[#15191d] border border-white/[0.15] rounded-xl text-white text-sm placeholder-white/[0.36] focus:border-[#ffd555]/70 focus:ring-2 focus:ring-[#ffd555]/20 focus:bg-[#101316] focus:outline-none transition-all font-sans shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]";
  const labelClass = "block text-[10px] font-extrabold uppercase tracking-wider text-[#f4d675]/80 mb-1.5";

  const renderServiceCard = (service) => {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.3 }}
        key={service._id}
        onClick={() => openViewModal(service)}
        className="group relative flex flex-col p-4 rounded-2xl cursor-pointer transition-all duration-500 overflow-hidden border border-white/[0.12] hover:border-[#ffd555]/[0.45] hover:shadow-[0_22px_60px_rgba(255,213,85,0.12),0_10px_35px_rgba(24,198,168,0.08)] hover:-translate-y-1.5"
        style={{
          background: 'linear-gradient(145deg, rgba(28,31,34,0.92), rgba(16,20,23,0.9) 48%, rgba(73,50,18,0.28))',
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(255,213,85,0.16),transparent_28%),radial-gradient(circle_at_88%_18%,rgba(56,189,248,0.12),transparent_24%),linear-gradient(120deg,transparent,rgba(255,255,255,0.08),transparent)] opacity-65 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
        <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-[#ffe083]/60 to-transparent opacity-70" />
        
        {/* Top: Info */}
        <div className="flex gap-4 items-start mb-3 relative z-10">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-xl bg-[#ffd555] opacity-15 blur-md transition-all duration-500 group-hover:opacity-40 group-hover:blur-lg" />
            <img 
              src={service.imageUrl} 
              alt={service.name} 
              className="w-[84px] h-[84px] rounded-xl object-cover border border-white/20 bg-[#202832] relative z-10 transition-transform duration-500 group-hover:scale-105 shadow-[0_12px_28px_rgba(0,0,0,0.26)]"
            />
          </div>
          
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-[15px] font-extrabold text-white mb-1 truncate pr-2 group-hover:text-[#ffe083] transition-colors leading-tight drop-shadow">
                {service.name}
              </h3>
            </div>
            
            <div className="flex items-center gap-2 mb-2.5">
              {service.isActive ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-emerald-400/[0.14] border border-emerald-300/30 text-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.12)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-white/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/30" />Inactive
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#ffd555]/[0.16] text-[#ffe083] text-xs font-bold border border-[#ffd555]/[0.35] shadow-[0_0_16px_rgba(255,213,85,0.10)]">
                {service.price.toLocaleString('vi-VN')} ₫
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-sky-400/10 text-sky-100/80 text-xs font-semibold border border-sky-300/15">
                <Clock size={12}/> {service.timeCost}m
              </span>
            </div>
          </div>
        </div>

        {/* Middle: Description */}
        <p className="text-[13px] text-white/[0.58] line-clamp-2 leading-relaxed flex-1 relative z-10 mb-4 px-1">
          {service.description}
        </p>

        {/* Bottom: Actions */}
        <div className="pt-3 border-t border-white/10 flex justify-between items-center relative z-10">
          <button 
            onClick={(e) => { e.stopPropagation(); openViewModal(service); }}
            className="text-[11px] font-bold uppercase tracking-wider text-white/[0.55] hover:text-[#ffe083] transition-colors flex items-center gap-1.5 px-2 py-1 -ml-2"
          >
            <Eye size={14} /> View Panel
          </button>
          
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button 
              onClick={(e) => { e.stopPropagation(); openModal(service); }}
              className="w-7 h-7 rounded-lg bg-white/[0.08] flex items-center justify-center hover:bg-[#ffd555]/20 hover:text-[#ffe083] border border-white/10 hover:border-[#ffd555]/40 transition-all text-white/[0.65]"
              title="Edit"
            >
              <Pencil size={13} />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); confirmDelete(service); }}
              className="w-7 h-7 rounded-lg bg-white/[0.08] flex items-center justify-center hover:bg-red-500/20 hover:text-red-300 border border-white/10 hover:border-red-400/40 transition-all text-white/[0.65]"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  const renderServiceListItem = (service) => {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        key={service._id}
        onClick={() => openViewModal(service)}
        className="group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-300 border border-white/[0.12] hover:border-[#ffd555]/[0.35] hover:-translate-y-0.5 hover:shadow-[0_14px_38px_rgba(255,213,85,0.08)]"
        style={{ background: 'linear-gradient(115deg, rgba(28,32,35,0.92), rgba(18,22,25,0.92), rgba(45,34,16,0.28))' }}
      >
        <img src={service.imageUrl} className="w-12 h-12 rounded-lg object-cover bg-[#202832] border border-white/[0.15] shadow-lg shrink-0" />
        <div className="flex-1 min-w-0 grid grid-cols-12 gap-4 items-center">
          <div className="col-span-4">
            <h3 className="text-sm font-bold text-white truncate">{service.name}</h3>
            <p className="text-[11px] text-white/[0.55] truncate mt-0.5">{service.description}</p>
          </div>
          <div className="col-span-2 flex items-center gap-1 text-[#ffd555] font-bold text-sm">
            {service.price.toLocaleString('vi-VN')} ₫
          </div>
          <div className="col-span-2 flex items-center gap-1 text-sky-100/75 text-xs">
            <Clock size={12}/> {service.timeCost}m
          </div>
          <div className="col-span-2">
            {service.isActive ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/10 text-white/50">
                <span className="w-1.5 h-1.5 rounded-full bg-white/30" />Inactive
              </span>
            )}
          </div>
          <div className="col-span-2 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); openViewModal(service); }} className="p-1.5 text-white/40 hover:text-[#ffd555]"><Eye size={14}/></button>
            <button onClick={(e) => { e.stopPropagation(); openModal(service); }} className="p-1.5 text-white/40 hover:text-[#ffd555]"><Pencil size={14}/></button>
            <button onClick={(e) => { e.stopPropagation(); confirmDelete(service); }} className="p-1.5 text-white/40 hover:text-red-400"><Trash2 size={14}/></button>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex h-[calc(100vh-70px)] bg-[#080808] text-white relative overflow-hidden font-sans">
      <style>{`
        @keyframes skeletonShimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .animate-skeleton {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 800px 100%;
          animation: skeletonShimmer 1.6s infinite linear;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,213,85,0.28); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,213,85,0.48); }
      `}</style>
      <div className="absolute inset-0 pointer-events-none bg-[#080808]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:46px_46px]" />
      
      <Toaster position="top-right" toastOptions={{ 
        style: { background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' } 
      }} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative z-10">
        
        {/* ── Header ── */}
        <div className="px-8 pt-7 pb-6 border-b border-white/[0.06] flex-shrink-0 z-20 relative bg-[#080808]">
          <div className="absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-[#ffd555]/20 to-transparent" />
          <div className="flex items-center justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-yellow-300">
                <Wrench size={12} /> Service Manager
              </div>
              <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Services</h1>
              <p className="text-sm text-gray-400 mt-1">Manage extra parking services, pricing, time cost, and availability.</p>
            </div>
            <button
              onClick={() => openModal()}
              className="group relative overflow-hidden flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 hover:-translate-y-0.5 shadow-[0_4px_20px_rgba(255,213,85,0.3)] hover:shadow-[0_6px_28px_rgba(255,213,85,0.5)]"
              style={{ background: goldGrad, color: '#0f0f0f' }}
            >
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 pointer-events-none bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              <Plus size={16} />
              Add New Service
            </button>
          </div>

          {/* ── KPI Cards ── */}
          <div className="mt-6 border-y border-white/10 bg-[#080808]">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard index={0} icon={Package} label="Total Services" value={totalServices} sub="All created services" toneClass="bg-blue-500/10 text-blue-300" loading={loading} />
              <StatCard index={1} icon={CheckCircle} label="Active Services" value={activeServices} sub="Currently available" toneClass="bg-emerald-500/10 text-emerald-300" loading={loading} />
              <StatCard index={2} icon={DollarSign} label="Average Price" value={avgPrice} sub="Per service" toneClass="bg-purple-500/10 text-purple-300" loading={loading} isCurrency />
              <StatCard index={3} icon={Clock} label="Average Time" value={avgTime} sub="Per service" toneClass="bg-orange-500/10 text-orange-300" loading={loading} isTime />
            </div>
          </div>
        </div>

        {/* ── Control Bar ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-8 py-4 flex-shrink-0 bg-[#080808] border-b border-white/[0.04] z-40 relative">
          <div className="relative flex-1 max-w-[480px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ffe083]/75 pointer-events-none" />
            <input 
              type="text" 
              placeholder="Search extra services..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white/[0.07] border border-white/[0.14] rounded-full py-2.5 pl-10 pr-4 text-sm text-white placeholder-white/[0.38] focus:outline-none focus:border-[#ffd555]/[0.65] focus:ring-2 focus:ring-[#ffd555]/20 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.12)]"
            />
          </div>

          <div className="flex items-center gap-3">
            <Menu as="div" className="relative inline-block text-left z-30">
              <Menu.Button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.07] border border-white/[0.14] text-sm text-white/[0.78] hover:border-[#ffd555]/40 hover:text-white hover:bg-white/[0.11] transition-all shadow-sm">
                <Eye size={14} className="text-[#ffe083]/[0.65]" />
                <span className="font-medium">{statusFilter === 'all' ? 'All Status' : statusFilter === 'active' ? 'Active' : 'Inactive'}</span>
                <ChevronDown size={14} className="text-white/40" />
              </Menu.Button>
              <Transition as={Fragment} enter="transition ease-out duration-200" enterFrom="opacity-0 translate-y-1" enterTo="opacity-100 translate-y-0" leave="transition ease-in duration-150" leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-1">
                <Menu.Items className="absolute left-0 mt-2 w-40 origin-top-left rounded-xl bg-[#171b1f]/95 border border-white/[0.15] shadow-2xl backdrop-blur-xl focus:outline-none overflow-hidden z-50">
                  <div className="p-1.5">
                    {[['all','All Status'],['active','Active Only'],['inactive','Inactive Only']].map(([v,l]) => (
                      <Menu.Item key={v}>
                        {({ active }) => (
                          <button onClick={() => setStatusFilter(v)}
                            className={`${active ? 'bg-white/10 text-white' : 'text-white/70'} group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors`}>
                            {statusFilter === v ? <Check size={14} className="text-[#ffd555]" /> : <div className="w-3.5" />}
                            {l}
                          </button>
                        )}
                      </Menu.Item>
                    ))}
                  </div>
                </Menu.Items>
              </Transition>
            </Menu>

            <Menu as="div" className="relative inline-block text-left z-30">
              <Menu.Button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.07] border border-white/[0.14] text-sm text-white/[0.78] hover:border-[#ffd555]/40 hover:text-white hover:bg-white/[0.11] transition-all shadow-sm">
                <Clock size={14} className="text-sky-200/[0.65]" />
                <span className="font-medium">
                  {sortBy === 'newest' ? 'Newest' : sortBy === 'oldest' ? 'Oldest' : sortBy === 'price_desc' ? 'Price: High' : sortBy === 'price_asc' ? 'Price: Low' : 'Name: A-Z'}
                </span>
                <ChevronDown size={14} className="text-white/40" />
              </Menu.Button>
              <Transition as={Fragment} enter="transition ease-out duration-200" enterFrom="opacity-0 translate-y-1" enterTo="opacity-100 translate-y-0" leave="transition ease-in duration-150" leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-1">
                <Menu.Items className="absolute right-0 mt-2 w-48 origin-top-right rounded-xl bg-[#171b1f]/95 border border-white/[0.15] shadow-2xl backdrop-blur-xl focus:outline-none overflow-hidden z-50">
                  <div className="p-1.5">
                    {[['newest','Newest First'],['oldest','Oldest First'],['price_desc','Price: High to Low'],['price_asc','Price: Low to High'],['name_asc','Name: A-Z']].map(([v,l]) => (
                      <Menu.Item key={v}>
                        {({ active }) => (
                          <button onClick={() => setSortBy(v)}
                            className={`${active ? 'bg-white/10 text-white' : 'text-white/70'} group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors`}>
                            {sortBy === v ? <Check size={14} className="text-[#ffd555]" /> : <div className="w-3.5" />}
                            {l}
                          </button>
                        )}
                      </Menu.Item>
                    ))}
                  </div>
                </Menu.Items>
              </Transition>
            </Menu>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-white/[0.07] border border-white/[0.14] rounded-xl p-1 shadow-sm">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-[#ffd555]/[0.18] text-[#ffe083] shadow-[0_0_16px_rgba(255,213,85,0.18)]' : 'text-white/[0.45] hover:text-white'}`}
              >
                <LayoutGrid size={16} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-[#ffd555]/[0.18] text-[#ffe083] shadow-[0_0_16px_rgba(255,213,85,0.18)]' : 'text-white/[0.45] hover:text-white'}`}
              >
                <ListIcon size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Main Layout: Split ── */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left: Content Grid */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-6 relative">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent pointer-events-none" />

            {loading && services.length === 0 ? (
              <div className="flex justify-center py-20">
                <div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin border-[#ffd555]" />
              </div>
            ) : filteredAndSortedServices.length === 0 ? (
              <div className="py-20 text-center rounded-3xl bg-white/[0.06] border border-white/[0.12] backdrop-blur-sm max-w-lg mx-auto shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
                <div className="w-16 h-16 rounded-full bg-[#ffd555]/[0.12] border border-[#ffd555]/25 flex items-center justify-center mx-auto mb-4 text-[#ffe083] shadow-[0_0_35px_rgba(255,213,85,0.16)]">
                  <Star size={24} />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">No extra services yet</h3>
                <p className="text-sm text-white/[0.58] mb-6 px-8">Create your first premium parking add-on service to enhance the customer experience.</p>
                <button 
                  onClick={() => openModal()}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#ffd555]/10 text-[#ffd555] hover:bg-[#ffd555]/20 transition-colors border border-[#ffd555]/20"
                >
                  Add New Service
                </button>
              </div>
            ) : (
              <div className={viewMode === 'grid' ? "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5" : "flex flex-col gap-3"}>
                <AnimatePresence>
                  {filteredAndSortedServices.map(s => viewMode === 'grid' ? renderServiceCard(s) : renderServiceListItem(s))}
                </AnimatePresence>
              </div>
            )}
          </div>



        </div>
      </div>

      {/* ── Side Panel Detail View (520px) ── */}
      <AnimatePresence>
        {isViewModalOpen && viewingService && (
          <motion.div key="view-modal-container" className="fixed inset-0 z-[60]">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-black/70"
              onClick={() => setIsViewModalOpen(false)}
            />
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute inset-y-0 right-0 w-full max-w-[520px] bg-[#11161a]/[0.96] border-l border-[#ffd555]/[0.18] z-[70] shadow-[0_0_80px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden"
            >
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_10%_0%,rgba(255,213,85,0.16),transparent_25%),radial-gradient(circle_at_100%_18%,rgba(56,189,248,0.13),transparent_24%)]" />
              <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.08] bg-white/[0.035] shrink-0 relative">
                <h3 className="text-sm font-extrabold text-white uppercase tracking-wider">Service Profile</h3>
                <button onClick={() => setIsViewModalOpen(false)} className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white/[0.60] hover:text-white flex items-center justify-center transition-all border border-white/10">
                  <X size={15} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                <div className="p-6">
                  {/* Header Image section */}
                  <div className="flex gap-5 items-center mb-8">
                    <div className="relative shrink-0">
                      <div className="absolute inset-0 rounded-2xl bg-[#ffd555]/25 blur-xl" />
                      <img src={viewingService.imageUrl} className="relative w-[120px] h-[120px] rounded-2xl object-cover bg-[#202832] border border-white/20 shrink-0 shadow-xl" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-extrabold text-white mb-2 leading-tight">{viewingService.name}</h2>
                      {viewingService.isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Active Status
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white/5 border border-white/10 text-white/50">
                          <span className="w-1.5 h-1.5 rounded-full bg-white/30" />Inactive
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-white/[0.07] p-4 rounded-xl border border-[#ffd555]/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <p className="text-[10px] text-[#f4d675]/80 uppercase font-bold tracking-widest mb-1">Pricing</p>
                      <p className="text-2xl font-extrabold text-[#ffe083]">{viewingService.price.toLocaleString('vi-VN')} ₫</p>
                    </div>
                    <div className="bg-white/[0.07] p-4 rounded-xl border border-sky-300/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <p className="text-[10px] text-sky-100/[0.62] uppercase font-bold tracking-widest mb-1">Duration</p>
                      <p className="text-2xl font-extrabold text-white">{viewingService.timeCost}<span className="text-base text-white/50 ml-1">min</span></p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <h4 className="text-[10px] font-bold text-[#ffd555] uppercase tracking-widest mb-3">Service Description</h4>
                    <div className="bg-white/[0.07] p-5 rounded-2xl border border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                      <p className="text-sm text-white/70 leading-relaxed">
                        {viewingService.description}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] font-bold text-white/[0.55] uppercase tracking-widest mb-3">System Info</h4>
                    <div className="bg-white/[0.06] rounded-2xl border border-white/[0.12] divide-y divide-white/[0.08] overflow-hidden">
                      <div className="flex justify-between items-center p-4">
                        <span className="text-xs text-white/[0.55] flex items-center gap-2"><Calendar size={14}/> Added Date</span>
                        <span className="text-sm text-white font-medium">{new Date(viewingService.createdAt).toLocaleDateString()}</span>
                      </div>
                      {viewingService.updatedAt && (
                        <div className="flex justify-between items-center p-4">
                          <span className="text-xs text-white/[0.55] flex items-center gap-2"><Pencil size={14}/> Last Updated</span>
                          <span className="text-sm text-white font-medium">{new Date(viewingService.updatedAt).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-white/[0.08] bg-white/[0.035] flex gap-3 shrink-0 relative">
                <button 
                  onClick={() => { setIsViewModalOpen(false); openModal(viewingService); }}
                  className="flex-1 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-[#ffd555]/[0.16] text-[#ffe083] hover:bg-[#ffd555]/[0.24] transition-colors border border-[#ffd555]/[0.35] shadow-[0_0_24px_rgba(255,213,85,0.08)]"
                >
                  <Pencil size={16} /> Edit Settings
                </button>
                <button 
                  onClick={() => confirmDelete(viewingService)}
                  className="flex-1 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-red-500/[0.12] text-red-300 hover:bg-red-500/20 transition-colors border border-red-400/30"
                >
                  <Trash2 size={16} /> Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add/Edit Modal (Max 820px) ── */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div key="add-modal-container" className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-black/70"
              onClick={closeModal}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-[920px] bg-[#12171b]/[0.96] rounded-2xl shadow-[0_28px_90px_rgba(0,0,0,0.52)] border border-white/[0.14] z-10 flex flex-col max-h-[95vh] overflow-hidden"
            >
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_8%_0%,rgba(255,213,85,0.16),transparent_24%),radial-gradient(circle_at_92%_20%,rgba(56,189,248,0.12),transparent_24%),linear-gradient(145deg,rgba(255,255,255,0.05),transparent_38%)]" />
              <div className="flex justify-between items-center px-6 py-4 border-b border-white/10 bg-white/[0.04] rounded-t-2xl shrink-0 relative">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  {editingService ? <Pencil className="text-[#ffd555]" size={16} /> : <Sparkles className="text-[#ffd555]" size={16} />}
                  {editingService ? 'Edit Service' : 'Create Premium Service'}
                </h2>
                <button onClick={closeModal} className="w-8 h-8 rounded-full flex items-center justify-center text-white/[0.55] hover:text-white hover:bg-white/[0.12] transition-colors border border-white/10">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 relative">
                {formError && (
                  <div className="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-2 text-sm">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <p className="font-medium">{formError}</p>
                  </div>
                )}

                <form id="serviceForm" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Col: Upload & Live Preview */}
                  <div className="lg:col-span-5 space-y-6">
                    <div>
                      <label className={labelClass}>Service Thumbnail</label>
                      <div 
                        className={`relative group rounded-xl border border-dashed h-[180px] flex flex-col items-center justify-center overflow-hidden transition-all duration-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]
                          ${isDragging ? 'border-[#ffd555] bg-[#ffd555]/[0.14] shadow-[0_0_32px_rgba(255,213,85,0.16)]' : 'border-white/[0.24] bg-white/[0.055] hover:border-[#ffd555]/60 hover:bg-white/[0.08]'}
                        `}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          className="hidden" 
                          accept="image/jpeg, image/png, image/webp"
                          onChange={(e) => handleImageSelect(e.target.files[0])}
                        />
                        
                        {imagePreview ? (
                          <>
                            <img src={imagePreview} alt="Preview" className="absolute inset-0 w-full h-full object-cover opacity-95 group-hover:opacity-45 transition-opacity" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/45 backdrop-blur-[2px]">
                              <span className="flex items-center gap-1.5 bg-[#ffd555]/20 text-[#ffe083] px-3 py-1.5 rounded-lg font-bold text-xs border border-[#ffd555]/[0.35]">
                                <UploadCloud size={14} /> Change
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="text-center p-4 pointer-events-none">
                            <div className="w-12 h-12 rounded-full bg-[#ffd555]/[0.12] border border-[#ffd555]/25 flex items-center justify-center mx-auto mb-3 text-[#ffe083] shadow-[0_0_28px_rgba(255,213,85,0.12)]">
                              <ImagePlus size={18} />
                            </div>
                            <p className="text-xs font-bold text-white mb-1">Drag & Drop</p>
                            <p className="text-[10px] text-white/[0.55]">max 5MB (JPG/PNG)</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Live Preview</label>
                      <div className="bg-white/[0.06] border border-white/[0.14] rounded-2xl p-4 pointer-events-none shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                        <div className="flex gap-3 items-center">
                          <div className="w-12 h-12 rounded-lg bg-[#202832] border border-white/[0.15] shrink-0 overflow-hidden shadow-lg">
                            {imagePreview ? <img src={imagePreview} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/[0.06]" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold text-white truncate">{formData.name || 'Service Name'}</h4>
                            <div className="flex gap-2 mt-1.5">
                              <span className="text-[10px] font-bold text-[#ffd555] bg-[#ffd555]/10 px-1.5 py-0.5 rounded border border-[#ffd555]/20">{Number(formData.price || 0).toLocaleString('vi-VN')} ₫</span>
                              <span className="text-[10px] font-medium text-sky-100/75 bg-sky-400/10 px-1.5 py-0.5 rounded border border-sky-300/15">{formData.timeCost || 0}m</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Col: Form Fields */}
                  <div className="lg:col-span-7 space-y-4">
                    <div>
                      <label className={labelClass}>Service Name</label>
                      <input type="text" name="name" value={formData.name} onChange={handleInputChange} className={inputClass} placeholder="e.g. Premium Interior Detail" required />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Price (VND)</label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ffe083]/70 font-bold text-sm">₫</span>
                          <input type="number" name="price" value={formData.price} onChange={handleInputChange} min="0" step="1000" className={`${inputClass} pl-9`} placeholder="0" required />
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Duration (Min)</label>
                        <div className="relative">
                          <Clock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sky-100/[0.65]" />
                          <input type="number" name="timeCost" value={formData.timeCost} onChange={handleInputChange} min="1" step="1" className={`${inputClass} pl-9`} placeholder="30" required />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Description</label>
                      <textarea name="description" value={formData.description} onChange={handleInputChange} rows="4" className={`${inputClass} resize-none`} placeholder="Write a clear description for customers..." required />
                    </div>

                    <div>
                      <label className={labelClass}>Visibility Status</label>
                      <div 
                        className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all ${
                          formData.isActive ? 'bg-emerald-400/[0.14] border-emerald-300/[0.35] shadow-[0_0_30px_rgba(52,211,153,0.08)]' : 'bg-white/[0.055] border-white/[0.14]'
                        }`}
                        onClick={() => setFormData(prev => ({ ...prev, isActive: !prev.isActive }))}
                      >
                        <div>
                          <p className={`font-bold text-[13px] ${formData.isActive ? 'text-emerald-400' : 'text-white/[0.60]'}`}>
                            {formData.isActive ? 'Active Service' : 'Inactive Service'}
                          </p>
                          <p className="text-[11px] text-white/[0.56] mt-0.5">
                            {formData.isActive ? 'Available in booking catalog.' : 'Hidden from customers.'}
                          </p>
                        </div>
                        <div className={`relative w-10 h-5 rounded-full transition-colors duration-300 ${formData.isActive ? 'bg-emerald-500' : 'bg-white/20'}`}>
                          <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform duration-300 ${formData.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              </div>

              <div className="px-6 py-4 border-t border-white/10 bg-white/[0.04] rounded-b-2xl flex justify-end gap-3 shrink-0 sticky bottom-0 relative">
                <button type="button" onClick={closeModal} className="px-5 py-2.5 rounded-xl text-sm font-medium bg-white/[0.08] text-white/[0.84] hover:bg-white/[0.14] transition-colors border border-white/[0.14]">
                  Cancel
                </button>
                <button 
                  type="submit" 
                  form="serviceForm"
                  disabled={loading}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold text-black flex items-center gap-2 hover:-translate-y-0.5 transition-transform disabled:opacity-70 disabled:hover:translate-y-0 shadow-[0_10px_30px_rgba(255,213,85,0.25)]"
                  style={{ background: goldGrad }}
                >
                  {loading ? <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> : 'Save Service'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Compact Delete Confirmation Modal (420px max) ── */}
      <AnimatePresence>
        {isDeleteModalOpen && editingService && (
          <motion.div key="delete-modal-container" className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-black/70"
              onClick={() => !loading && setIsDeleteModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-[420px] bg-[#111] rounded-2xl p-6 shadow-2xl border border-red-500/20 z-10"
            >
              <div className="flex flex-col items-center text-center">
                <div className="relative w-16 h-16 mb-4 rounded-full p-1 bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full" />
                  <img src={editingService.imageUrl} alt={editingService.name} className="w-full h-full object-cover rounded-full relative z-10" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#111] rounded-full flex items-center justify-center border border-red-500/20 text-red-500 z-20">
                    <Trash2 size={12} />
                  </div>
                </div>

                <h3 className="text-lg font-bold text-white mb-2">Delete Service?</h3>
                <p className="text-[13px] text-white/50 mb-6 leading-relaxed px-4">
                  You are about to permanently delete <span className="text-white font-semibold">{editingService.name}</span>. This action cannot be undone.
                </p>

                <div className="flex gap-3 w-full">
                  <button 
                    onClick={() => setIsDeleteModalOpen(false)} 
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 text-white/[0.80] hover:bg-white/10 transition-colors border border-white/10"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleDelete}
                    disabled={loading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors shadow-[0_4px_12px_rgba(239,68,68,0.3)] flex items-center justify-center gap-2"
                  >
                    {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Delete'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminServiceManager;



