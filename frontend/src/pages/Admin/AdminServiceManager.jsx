import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Transition } from '@headlessui/react';
import { 
  Pencil, Trash2, Plus, X, CheckCircle, 
  Package, Clock, DollarSign, Sparkles, ImagePlus, 
  Eye, Search, Calendar,
  UploadCloud, AlertTriangle, ChevronDown, Check, Wrench
} from 'lucide-react';
import { getServices, createService, updateService, deleteService } from '../../services/extraServiceApi';
import toast, { Toaster } from 'react-hot-toast';
import './adminServices.css';
import { getPaginationPages } from '../Staff/sessionPagination.js';
import { useLocation, useSearchParams } from 'react-router-dom';
import { serviceLinkState, includeLinkedService, serviceRowPage, highlightServiceRow } from './serviceDeepLink.js';

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
      <div className="services-metric group min-w-0 px-0 py-2.5 transition hover:bg-white/[0.018] sm:px-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition group-hover:brightness-125 ${toneClass}`}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-wider text-blue-200/55 leading-none">{label}</p>
            {loading ? (
              <div className="mt-1 h-5 w-16 animate-pulse rounded bg-white/10" />
            ) : (
              <div className="mt-1 flex items-baseline gap-1.5">
                <p className="truncate font-mono text-xl font-black leading-none text-white">
                  <AnimatedCounter target={value} isCurrency={isCurrency} isTime={isTime} />
                </p>
                <p className={`truncate text-[10px] font-bold ${subTone}`}>
                  {sub}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main Component -----------------------------------------------------------
const AdminServiceManager = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const serviceIdQuery = searchParams.get('serviceId');
  const linkKey = serviceIdQuery ? `${location.key}:${serviceIdQuery}` : null;
  const [serviceLink, setServiceLink] = useState({ status: 'idle' });
  const linkedRowRef = useRef(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters, Sort & View
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [page, setPage] = useState(1);

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

  const aiRefreshGeneration = useRef(0);
  const fetchServices = async () => {
    const generation = ++aiRefreshGeneration.current;
    try {
      setLoading(true);
      const res = await getServices(false, linkKey ? { cache: 'no-store' } : {});
      if (generation !== aiRefreshGeneration.current) return;
      if (linkKey) setServiceLink({ ...serviceLinkState(res, serviceIdQuery), key: linkKey });
      if (res.ok && res.data.success) {
        setServices(res.data.data);
      } else {
        toast.error(res.data.message || 'Failed to fetch services');
      }
    } catch (err) {
      if (generation !== aiRefreshGeneration.current) return;
      if (linkKey) setServiceLink({ status: 'error', key: linkKey });
      toast.error(err.message || 'Failed to fetch services');
    } finally {
      if (generation === aiRefreshGeneration.current) setLoading(false);
    }
  };
  const aiLoader = useRef(null);
  useEffect(() => { aiLoader.current = fetchServices; });
  useEffect(() => {
    const onChange = ({ detail }) => {
      if (['CREATE_SERVICE', 'UPDATE_SERVICE', 'ARCHIVE_SERVICE'].includes(detail?.type)) aiLoader.current?.();
    };
    window.addEventListener('valo:admin-data-changed', onChange);
    return () => { aiRefreshGeneration.current += 1; window.removeEventListener('valo:admin-data-changed', onChange); };
  }, []);


  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchServices();
    return () => { aiRefreshGeneration.current += 1; };
  }, [linkKey]);



  // KPIs
  const totalServices = services.length;
  const activeServices = services.filter(s => s.isActive).length;
  const avgPrice = totalServices > 0 ? services.reduce((acc, s) => acc + s.price, 0) / totalServices : 0;
  const inactiveServices = totalServices - activeServices;
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

  const verifiedServiceId = linkKey && serviceLink.key === linkKey && serviceLink.status === 'ready' && !loading ? serviceLink.serviceId : null;
  const visibleServices = useMemo(() => includeLinkedService(filteredAndSortedServices, services, verifiedServiceId), [filteredAndSortedServices, services, verifiedServiceId]);
  useEffect(() => {
    const targetPage = verifiedServiceId && serviceRowPage(visibleServices, verifiedServiceId);
    if (targetPage) setPage(targetPage);
  }, [verifiedServiceId, visibleServices, linkKey]);
  const totalPages = Math.max(1, Math.ceil(visibleServices.length / 10));
  const currentPage = Math.min(page, totalPages);
  const pageServices = visibleServices.slice((currentPage - 1) * 10, currentPage * 10);
  useEffect(() => {
    if (verifiedServiceId) return highlightServiceRow(linkedRowRef.current);
  }, [verifiedServiceId, linkKey, currentPage]);
  const tableRef = useRef(null);
  useEffect(() => {
    if (!verifiedServiceId && tableRef.current) tableRef.current.scrollTop = 0;
  }, [currentPage, searchTerm, statusFilter, sortBy, verifiedServiceId]);

  return (
    <div className="admin-services flex h-full min-h-0 bg-[#080808] text-white relative overflow-hidden font-sans">
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

      <div className="services-main flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden relative z-10">
        
        {/* ── Header ── */}
        <div className="services-header px-8 pt-7 pb-6 border-b border-white/[0.06] flex-shrink-0 z-20 relative bg-[#080808]">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-3xl font-black tracking-tight text-white">Services</h1>
                <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-[10px] font-black text-yellow-300"><Wrench size={12} /> Service Manager</div>
              </div>
              <p className="text-sm text-gray-400 mt-1">Manage extra parking services, pricing, time cost, and availability.</p>
            </div>
            <button
              onClick={() => openModal()}
              className="services-add inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold"
            >
              <Plus size={16} />
              Add New Service
            </button>
          </div>

          {/* ── KPI Cards ── */}
          <div className="services-metrics mt-6 border-y border-white/10 bg-[#080808]">
            <div className="grid grid-cols-2 lg:grid-cols-4">
              <StatCard index={0} icon={Package} label="Total Services" value={totalServices} sub="All created services" toneClass="bg-blue-500/10 text-blue-300" loading={loading} />
              <StatCard index={1} icon={CheckCircle} label="Active Services" value={activeServices} sub="Currently available" toneClass="bg-emerald-500/10 text-emerald-300" loading={loading} />
              <StatCard index={2} icon={Eye} label="Inactive Services" value={inactiveServices} sub="Hidden from customers" toneClass="bg-red-500/10 text-red-300" loading={loading} />
              <StatCard index={3} icon={DollarSign} label="Average Price" value={avgPrice} sub="Per service" toneClass="bg-purple-500/10 text-purple-300" loading={loading} isCurrency />
            </div>
          </div>
        </div>

        {/* ── Control Bar ── */}
        <div className="services-toolbar flex flex-wrap items-center justify-between gap-4 px-8 py-4 flex-shrink-0 bg-[#080808] border-b border-white/[0.04] z-40 relative">
          <div className="services-search relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#ffe083]/75 pointer-events-none" />
            <input 
              type="text" 
              placeholder="Search extra services..." 
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
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
                          <button onClick={() => { setStatusFilter(v); setPage(1); }}
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
                          <button onClick={() => { setSortBy(v); setPage(1); }}
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


          </div>
        </div>

        {/* ── Main Layout: Split ── */}
        <div ref={tableRef} className="services-table-scroll" tabIndex={0} role="region" aria-label="Services list">
          {linkKey && serviceLink.key === linkKey && ['missing', 'error', 'unavailable'].includes(serviceLink.status) && <p role="status" className="px-4 py-3 text-sm text-amber-200">{serviceLink.status === 'missing' ? 'Service not found.' : 'Unable to load the requested service.'}</p>}
          <table>
            <thead><tr>{['Service', 'Price', 'Duration', 'Status', 'Actions'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>
              {loading && services.length === 0 ? <tr><td colSpan={5} className="services-empty" role="status">Loading services...</td></tr> : pageServices.length === 0 ? <tr><td colSpan={5} className="services-empty">
                <p>{services.length ? 'No matching services' : 'No extra services yet'}</p>
                <button type="button" onClick={() => openModal()} className="mt-3 text-[#e8d5ad]">Add New Service</button>
              </td></tr> : pageServices.map((service) => <tr key={service._id} ref={String(service._id).toLowerCase() === verifiedServiceId?.toLowerCase() ? linkedRowRef : undefined} className="services-row" onClick={() => openViewModal(service)}>
                <td><div className="flex min-w-0 items-center gap-3">
                  {service.imageUrl ? <img src={service.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <Package size={20} className="shrink-0 text-white/40" aria-hidden="true" />}
                  <span className="truncate text-white" title={service.name}>{service.name}</span>
                </div></td>
                <td className="text-[#e8d5ad]">{service.price.toLocaleString('vi-VN')} VND</td>
                <td>{service.timeCost} min</td>
                <td><span className={`services-status inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${service.isActive ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/5 text-white/50'}`}><span className={`h-1.5 w-1.5 rounded-full ${service.isActive ? 'bg-emerald-400' : 'bg-white/30'}`} />{service.isActive ? 'Active' : 'Inactive'}</span></td>
                <td onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => openViewModal(service)} className="services-view" aria-label={`View Panel for ${service.name}`}><Eye size={14} aria-hidden="true" /></button>
                  <button type="button" onClick={() => openModal(service)} title="Edit" aria-label={`Edit ${service.name}`} className="services-icon text-[#e8d5ad]"><Pencil size={14} /></button>
                  <button type="button" onClick={() => confirmDelete(service)} title="Delete" aria-label={`Delete ${service.name}`} className="services-icon text-red-400"><Trash2 size={14} /></button>
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <nav className="services-pagination" aria-label="Service pages">
          <span className="text-xs text-white/30">Page {currentPage} of {totalPages} {'\u00b7'} {visibleServices.length} results</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/6 disabled:opacity-25 disabled:cursor-not-allowed transition-all">&larr; Prev</button>
            {getPaginationPages(currentPage, totalPages).map((nextPage) => typeof nextPage === 'number' ? <button type="button" key={nextPage} onClick={() => setPage(nextPage)} aria-current={nextPage === currentPage ? 'page' : undefined} className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${nextPage === currentPage ? 'bg-[#ffd555] text-black' : 'text-white/40 hover:text-white hover:bg-white/6'}`}>{nextPage}</button> : <span key={nextPage} aria-hidden="true">...</span>)}
            <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/6 disabled:opacity-25 disabled:cursor-not-allowed transition-all">Next &rarr;</button>
          </div>
        </nav>
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
              className="service-profile absolute inset-y-0 right-0 z-[70] flex w-full max-w-[520px] flex-col overflow-hidden"
              role="dialog" aria-modal="true" aria-labelledby="service-profile-title"
            >
              <header className="service-profile-header">
                <h3 id="service-profile-title">Service Profile</h3>
                <button type="button" onClick={() => setIsViewModalOpen(false)} className="service-profile-close" aria-label="Close Service Profile"><X size={18} aria-hidden="true" /></button>
              </header>
              <div className="service-profile-content">
                <div className="service-profile-identity">
                  <img src={viewingService.imageUrl} alt={viewingService.name} />
                  <div className="min-w-0">
                    <h2>{viewingService.name}</h2>
                    {viewingService.isActive ? (
                      <span className="service-profile-status inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Active Status</span>
                    ) : (
                      <span className="service-profile-status inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-white/50"><span className="h-1.5 w-1.5 rounded-full bg-white/30" />Inactive</span>
                    )}
                  </div>
                </div>
                <div className="service-profile-facts">
                  <div><p className="service-profile-label"><DollarSign size={15} className="text-[#e8d5ad]" aria-hidden="true" />Pricing</p><p className="service-profile-price">{viewingService.price.toLocaleString('vi-VN')} VND</p></div>
                  <div><p className="service-profile-label"><Clock size={15} className="text-slate-400" aria-hidden="true" />Duration</p><p className="service-profile-duration">{viewingService.timeCost}<span>min</span></p></div>
                </div>
                <section className="service-profile-description">
                  <h4>Service Description</h4>
                  <div><p>{viewingService.description}</p></div>
                </section>
                <section className="service-profile-system">
                  <h4>System Info</h4>
                  <div className="service-profile-system-rows">
                    <div><span><Calendar size={14} aria-hidden="true" />Added Date</span><time dateTime={viewingService.createdAt}>{new Date(viewingService.createdAt).toLocaleDateString()}</time></div>
                    {viewingService.updatedAt && <div><span><Pencil size={14} aria-hidden="true" />Last Updated</span><time dateTime={viewingService.updatedAt}>{new Date(viewingService.updatedAt).toLocaleDateString()}</time></div>}
                  </div>
                </section>
              </div>
              <footer className="service-profile-footer">
                <button type="button" onClick={() => { setIsViewModalOpen(false); openModal(viewingService); }} className="service-profile-edit"><Pencil size={16} aria-hidden="true" />Edit Settings</button>
                <button type="button" onClick={() => confirmDelete(viewingService)} className="service-profile-delete"><Trash2 size={16} aria-hidden="true" />Delete</button>
              </footer>
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



