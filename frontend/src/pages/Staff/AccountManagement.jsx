import { useState, useEffect, Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, Mail, Phone, Calendar, Users, User, Shield, UserX,
  ChevronDown, Edit3,
  AlertTriangle, Check, Clock, UserPlus,
  RefreshCw, Eye, Lock
} from 'lucide-react';
import { apiFetch } from '../../services/api';
import {
  getOperationalViewState,
  getResponseAvailability,
} from '../../utils/staffOperationalAvailability';

// --- Constants ---------------------------------------------------------------
const ROLES = {
  customer: {
    label: 'Customer',
    gradient: 'from-[#ffd555] to-amber-500',
    bg: 'bg-[#ffd555]/15',
    border: 'border-[#ffd555]/40',
    text: 'text-[#ffd555]',
    glow: 'rgba(255,213,85,0.4)',
    dot: 'bg-[#ffd555]',
    permissions: ['View parking spots', 'Create reservations', 'Manage own bookings', 'Payment history'],
  },
  staff: {
    label: 'Staff',
    gradient: 'from-cyan-400 to-blue-500',
    bg: 'bg-cyan-500/15',
    border: 'border-cyan-400/40',
    text: 'text-cyan-300',
    glow: 'rgba(34,211,238,0.4)',
    dot: 'bg-cyan-400',
    permissions: ['All customer permissions', 'Manage parking lots', 'Handle support tickets', 'View reports'],
  },
  admin: {
    label: 'Admin',
    gradient: 'from-rose-400 to-red-500',
    bg: 'bg-rose-500/15',
    border: 'border-rose-400/40',
    text: 'text-rose-300',
    glow: 'rgba(244,63,94,0.4)',
    dot: 'bg-rose-400',
    permissions: ['Full system access', 'Manage all accounts', 'System configuration', 'View all analytics', 'Assign roles'],
  },
};

const PAGE_SIZE = 10;

// --- Animated Counter ---------------------------------------------------------
function AnimatedCounter({ target, duration = 1200 }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!target) return;
    let frame;
    const start = performance.now();
    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return <span>{count}</span>;
}

// --- Role Badge --------------------------------------------------
function RoleBadge({ role }) {
  const cfg = ROLES[role] || ROLES.customer;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.bg} ${cfg.border} ${cfg.text} select-none`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// --- Status Badge -------------------------------------------------------------
function StatusBadge({ status }) {
  if (status === true || status === 'active')
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Active
      </span>
    );
  if (status === 'pending')
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 border border-amber-400/30 text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Pending
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 border border-red-500/30 text-red-300">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />Blocked
    </span>
  );
}

// --- Skeleton Row -------------------------------------------------------------
function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {[40, 180, 140, 90, 80, 80, 90, 60].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded-lg bg-white/5 animate-skeleton" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// --- Overview Card ------------------------------------------------------------
function StatCard({ icon: Icon, label, value, gradient, glow, loading, unavailable }) {
  return (
    <div
      className="relative rounded-xl p-3 overflow-hidden cursor-default group transition-all duration-300 hover:scale-[1.02]"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 40px ${glow}, 0 0 0 1px rgba(255,255,255,0.12)`; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.3)'; }}
    >
      {/* sweep shimmer */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.04) 50%, transparent 60%)' }} />
      {/* gradient blob */}
      <div className={`absolute -top-6 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-10 group-hover:opacity-20 transition-opacity duration-300 blur-xl`} />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-widest font-semibold mb-1">{label}</p>
          <p className="text-2xl font-bold text-white">
            {loading
              ? <span className="inline-block w-12 h-8 rounded bg-white/10 animate-skeleton" />
              : unavailable
                ? '—'
                : <AnimatedCounter target={value} />}
          </p>
        </div>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export default function AccountManagement() {
  const authHeader = { Authorization: `Bearer ${localStorage.getItem('accessToken')}` };

  // -- State --
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const filterRole = 'customer'; // Always customer for Staff
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [panelUser, setPanelUser] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saveState, setSaveState] = useState('idle'); // idle | saving | success | error
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [sortOrder, setSortOrder] = useState('newest');
  const [toast, setToast] = useState(null);
  const accountState = getOperationalViewState({ loading, error: loadError });

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // ── Data ──
  const fetchUsers = async () => {
    try {
      setLoading(true);
      setLoadError('');
      const res = await apiFetch('/staff/users', { headers: authHeader });
      const responseState = getResponseAvailability(res, 'Unable to load customer accounts.');
      if (!responseState.isAvailable) {
        setUsers([]);
        setPanelUser(null);
        setLoadError(responseState.error);
        return;
      }
      // Strict Data Filtering: ONLY fetch and display accounts where role === 'customer'
      const customersOnly = (responseState.data || []).filter(u => u.role === 'customer');
      setUsers(customersOnly);
    } catch (e) {
      console.error(e);
      setUsers([]);
      setPanelUser(null);
      setLoadError(e?.message || 'Unable to load customer accounts.');
    }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      fetchUsers();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  const handleBlockToggle = async (userId, currentStatus) => {
    const userToBlock = users.find(u => u._id === userId);
    // Action Restrictions: Staff cannot block higher or equal roles.
    if (userToBlock && userToBlock.role !== 'customer') {
      showToast('You do not have permission to block this account.', 'error');
      return;
    }

    try {
      const newStatus = !currentStatus;
      const res = await apiFetch(`/staff/users/${userId}/status`, {
        method: 'PUT', headers: authHeader, body: JSON.stringify({ status: newStatus })
      });
      if (res.ok && res.data?.success) {
        setUsers(prev => prev.map(u => u._id === userId ? { ...u, status: newStatus } : u));
        if (panelUser?._id === userId) setPanelUser(p => ({ ...p, status: newStatus }));
        showToast(newStatus ? 'Account unblocked successfully' : 'Account blocked successfully', 'success');
      } else {
        showToast('Failed to update account status', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('An error occurred', 'error');
    }
  };

  const openPanel = (u) => { 
    // Action Restrictions: Staff cannot view details of higher or equal roles.
    if (u.role !== 'customer') {
      showToast('You do not have permission to view this account.', 'error');
      return;
    }
    setPanelUser(u); setIsEditing(false); setBlockConfirm(false); setSaveState('idle'); 
  };
  const closePanel = () => { setPanelUser(null); setIsEditing(false); setBlockConfirm(false); };

  const startEdit = (u) => {
    // Prevent React SyntheticEvent from overwriting the user object
    const isEvent = u && u.nativeEvent;
    const passedUser = (u && !isEvent) ? u : null;
    const userToEdit = passedUser || panelUser;
    
    // Action Restrictions: Staff cannot edit higher or equal roles.
    if (userToEdit && userToEdit.role !== 'customer') {
      showToast('You do not have permission to edit this account.', 'error');
      return;
    }

    if (passedUser) setPanelUser(passedUser);
    
    // Combine names or fallback to username
    let fName = userToEdit?.profile?.firstName || '';
    let lName = userToEdit?.profile?.lastName || '';
    let fullName = `${fName} ${lName}`.trim();
    
    if (!fullName) {
      fullName = userToEdit?.username || '';
    }

    setEditForm({
      fullName: fullName,
      phone: userToEdit?.profile?.phone || '',
      role: 'customer', // Force strictly customer in UI form state
    });
    setIsEditing(true); setSaveState('idle');
  };

  const handleSave = async () => {
    const fn = editForm.fullName?.trim() || '';

    if (!fn) {
      showToast('Full Name is required', 'error');
      return;
    }
    
    if (fn.length > 50) {
      showToast('Name cannot exceed 50 characters', 'error');
      return;
    }
    
    const nameRegex = /^[\p{L}\s]+$/u;
    if (!nameRegex.test(fn)) {
      showToast('Name cannot contain numbers or special characters', 'error');
      return;
    }

    if (editForm.phone) {
      const cleanPhone = editForm.phone.replace(/[\s-]/g, '');
      if (!/^(03|05|07|08|09)\d{8}$/.test(cleanPhone)) {
        showToast('Please enter a valid Vietnamese phone number', 'error');
        return;
      }
    }

    setSaveState('saving');
    try {
      // Split the single full name into first and last right before API call
      const parts = fn.split(' ');
      const fName = parts[0];
      const lName = parts.slice(1).join(' ') || '';

      // API Payload Preparation: Strictly force role to 'customer' to prevent malicious privilege escalation
      const payload = {
        role: 'customer', 
        phone: editForm.phone,
        firstName: fName,
        lastName: lName
      };
      
      const res = await apiFetch(`/staff/users/${panelUser._id}`, {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok && res.data?.success) {
        const upd = res.data.data;
        setUsers(prev => prev.map(u => u._id === upd._id ? upd : u));
        setPanelUser(upd); setIsEditing(false); setSaveState('success');
        showToast('Account updated successfully', 'success');
        setTimeout(() => setSaveState('idle'), 2000);
        
        // Global state sync in case edited themselves
        const raw = sessionStorage.getItem('valo_user');
        if (raw) {
          const currentUser = JSON.parse(raw);
          if (currentUser._id === upd._id || currentUser.id === upd._id) {
            sessionStorage.setItem('valo_user', JSON.stringify({ ...currentUser, ...upd, name: `${upd.profile?.firstName || ''} ${upd.profile?.lastName || ''}`.trim() || upd.username }));
            window.dispatchEvent(new Event('valo_auth_change'));
          }
        }
      } else {
        setSaveState('error');
        showToast('Failed to update account', 'error');
        setTimeout(() => setSaveState('idle'), 2500);
      }
    } catch {
      setSaveState('error');
      showToast('An error occurred', 'error');
      setTimeout(() => setSaveState('idle'), 2500);
    }
  };

  // -- Derived Data --
  const totalAccounts = users.length;
  const newThisMonth = users.filter(u => {
    const d = new Date(u.createdAt); const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const blockedCount = users.filter(u => !u.status).length;
  const pendingCount = users.filter(u => u.emailVerified === false).length;

  let filtered = users.filter(u => {
    const term = searchTerm.toLowerCase();
    const name = `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.toLowerCase();
    const matchSearch = !term || name.includes(term) || (u.email || '').toLowerCase().includes(term) || (u.profile?.phone || '').includes(term);
    const matchRole = filterRole === 'all' || u.role === filterRole;
    const matchStatus = filterStatus === 'all' || (filterStatus === 'active' && u.status === true) || (filterStatus === 'blocked' && u.status === false);
    return matchSearch && matchRole && matchStatus;
  });

  filtered.sort((a, b) => {
    let diff = new Date(b.createdAt) - new Date(a.createdAt);
    return sortOrder === 'newest' ? diff : -diff;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageUsers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const formatDate = (d) => !d ? 'N/A' : new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const displayName = (u) => `${u?.profile?.firstName || ''} ${u?.profile?.lastName || ''}`.trim() || u?.username || u?.email || '-';
  const initials = (u) => displayName(u).charAt(0).toUpperCase();
  const avatarGrad = (u) => (ROLES[u?.role] || ROLES.customer).gradient;

  return (
    <div className="flex h-[calc(100vh-70px)] bg-[#080808] text-white relative overflow-hidden">
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
        @keyframes tooltipIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.95); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        .animate-tooltip-in { animation: tooltipIn 0.18s ease forwards; }
        @keyframes panelIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .panel-slide-in { animation: panelIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards; }
        @keyframes bulkIn {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
        }
        .bulk-slide-in { animation: bulkIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards; }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        .fade-in { animation: fadeIn 0.2s ease forwards; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .row-hover { transition: background 0.18s, transform 0.18s, box-shadow 0.18s; }
        .row-hover:hover { background: rgba(255,255,255,0.035); transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
        .btn-glow-gold:hover { box-shadow: 0 0 20px rgba(255,213,85,0.45); }
        .btn-glow-red:hover  { box-shadow: 0 0 20px rgba(239,68,68,0.4); }
        .btn-glow-green:hover{ box-shadow: 0 0 20px rgba(16,185,129,0.4); }
        .header-sweep {
          background: linear-gradient(135deg, #0d0d0d 0%, #111 40%, #161410 70%, #0d0d0d 100%);
          position: relative; overflow: hidden;
        }
        .header-sweep::before {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(105deg, transparent 30%, rgba(255,213,85,0.04) 50%, transparent 70%);
          animation: sweepAnim 4s ease-in-out infinite;
        }
        @keyframes sweepAnim {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>

      {/* ═══════════════ LEFT: MAIN PANEL ═══════════════ */}
      <div className={`flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-300`}>

        {/* -- Header -- */}
        <div className="bg-[#080808] px-8 pt-7 pb-6 border-b border-white/[0.06] flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[#ffd555] tracking-tight">Customer Management</h1>
              <p className="text-sm text-white/40 mt-0.5">Manage customer accounts and access permissions</p>
            </div>
            <button onClick={fetchUsers} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/8 transition-all text-sm">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {/* -- Stat Cards -- */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <StatCard icon={Users} label="Total Customers" value={totalAccounts} gradient="from-cyan-400 to-blue-500" glow="rgba(6,182,212,0.3)" loading={loading} unavailable={!accountState.isAvailable && !loading} />
            <StatCard icon={UserPlus} label="New This Month" value={newThisMonth} gradient="from-violet-400 to-purple-600" glow="rgba(167,139,250,0.3)" loading={loading} unavailable={!accountState.isAvailable && !loading} />
            <StatCard icon={UserX} label="Blocked Customers" value={blockedCount} gradient="from-rose-500 to-red-600" glow="rgba(239,68,68,0.3)" loading={loading} unavailable={!accountState.isAvailable && !loading} />
            <StatCard icon={Clock} label="Pending Verify" value={pendingCount} gradient="from-amber-400 to-orange-500" glow="rgba(251,191,36,0.3)" loading={loading} unavailable={!accountState.isAvailable && !loading} />
          </div>
        </div>

        {/* -- Controls Bar -- */}
        <div className="flex flex-wrap items-center gap-4 px-8 py-4 flex-shrink-0 bg-[#080808]">
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
            <input
              value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
              placeholder="Search name, email, phone..."
              className="w-full bg-[#111] border border-white/[0.08] rounded-full py-2.5 pl-10 pr-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#ffd555]/50 focus:ring-1 focus:ring-[#ffd555]/30 transition-all shadow-inner"
            />
          </div>

          <div className="flex items-center gap-3">
            {/* Note: Role filter removed entirely as requested by user to prevent privilege escalation / confusion, since only Customer is valid. */}
            
            {/* Status Filter */}
            <Menu as="div" className="relative inline-block text-left z-30">
              <Menu.Button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#111] border border-white/[0.08] text-sm text-white/70 hover:border-white/20 hover:text-white hover:bg-white/[0.02] transition-all shadow-sm">
                <Eye size={14} className="text-white/40" />
                <span className="font-medium">{filterStatus === 'all' ? 'All Status' : filterStatus === 'active' ? 'Active' : 'Blocked'}</span>
                <ChevronDown size={14} className="text-white/40" />
              </Menu.Button>
              <Transition as={Fragment} enter="transition ease-out duration-200" enterFrom="opacity-0 translate-y-1" enterTo="opacity-100 translate-y-0" leave="transition ease-in duration-150" leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-1">
                <Menu.Items className="absolute left-0 mt-2 w-40 origin-top-left rounded-xl bg-[#111] border border-white/10 shadow-2xl backdrop-blur-xl focus:outline-none overflow-hidden">
                  <div className="p-1.5">
                    {[['all','All Status'],['active','Active'],['blocked','Blocked']].map(([v,l]) => (
                      <Menu.Item key={v}>
                        {({ active }) => (
                          <button onClick={() => { setFilterStatus(v); setPage(1); }}
                            className={`${active ? 'bg-white/10 text-white' : 'text-white/70'} group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors`}>
                            {filterStatus === v ? <Check size={14} className="text-[#ffd555]" /> : <div className="w-3.5" />}
                            {l}
                          </button>
                        )}
                      </Menu.Item>
                    ))}
                  </div>
                </Menu.Items>
              </Transition>
            </Menu>

            {/* Sort Filter */}
            <Menu as="div" className="relative inline-block text-left z-30">
              <Menu.Button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#111] border border-white/[0.08] text-sm text-white/70 hover:border-white/20 hover:text-white hover:bg-white/[0.02] transition-all shadow-sm">
                <Clock size={14} className="text-white/40" />
                <span className="font-medium"> {sortOrder === 'newest' ? 'Newest' : 'Oldest'}</span>
                <ChevronDown size={14} className="text-white/40" />
              </Menu.Button>
              <Transition as={Fragment} enter="transition ease-out duration-200" enterFrom="opacity-0 translate-y-1" enterTo="opacity-100 translate-y-0" leave="transition ease-in duration-150" leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-1">
                <Menu.Items className="absolute left-0 mt-2 w-40 origin-top-left rounded-xl bg-[#111] border border-white/10 shadow-2xl backdrop-blur-xl focus:outline-none overflow-hidden">
                  <div className="p-1.5">
                    {[['newest','Newest First'],['oldest','Oldest First']].map(([v,l]) => (
                      <Menu.Item key={v}>
                        {({ active }) => (
                          <button onClick={() => { setSortOrder(v); setPage(1); }}
                            className={`${active ? 'bg-white/10 text-white' : 'text-white/70'} group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors`}>
                            {sortOrder === v ? <Check size={14} className="text-[#ffd555]" /> : <div className="w-3.5" />}
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

          <div className="ml-auto text-sm font-medium text-white/40 tracking-wide">
            {accountState.isAvailable
              ? `${filtered.length} of ${users.length} accounts`
              : 'Customer counts unavailable'}
          </div>
        </div>

        {/* -- Table -- */}
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full min-w-[800px] border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#14120c] border-b border-[#ffd555]/20">
                <th className="w-6"></th>
                {['Account','Email','Phone','Role','Status','Joined Date'].map(label => (
                  <th key={label} className="px-4 py-4 text-left">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#ffd555]/70">{label}</span>
                  </th>
                ))}
                <th className="px-4 py-4 text-center text-[11px] font-bold uppercase tracking-widest text-[#ffd555]/70">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
              {!loading && loadError && (
                <tr><td colSpan="8" className="py-20 text-center">
                  <div className="flex flex-col items-center gap-3 text-red-300" role="alert">
                    <AlertTriangle size={36} />
                    <span className="text-sm font-medium">Customer data unavailable</span>
                    <span className="max-w-md text-xs text-red-200/70">{loadError}</span>
                  </div>
                </td></tr>
              )}
              {!loading && !loadError && pageUsers.length === 0 && (
                <tr><td colSpan="8" className="py-20 text-center">
                  <div className="flex flex-col items-center gap-3 text-white/30">
                    <UserX size={36} />
                    <span className="text-sm">No customers match your filters</span>
                  </div>
                </td></tr>
              )}
              {!loading && pageUsers.map(u => {
                const isActive = panelUser?._id === u._id;
                return (
                  <tr key={u._id} className={`group border-b border-white/[0.04] cursor-pointer hover:bg-white/[0.02] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 ease-out ${isActive ? 'bg-[#ffd555]/[0.04]' : 'even:bg-white/[0.01]'}`}
                    onClick={() => openPanel(u)}>
                    <td className="w-4"></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          {u.profile?.avatar
                            ? <img src={u.profile.avatar} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-white/10" />
                            : <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarGrad(u)} flex items-center justify-center text-white text-sm font-bold shadow-lg`}>{initials(u)}</div>
                          }
                          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#080808] ${u.status ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-white truncate">{displayName(u)}</p>
                          <p className="text-[11px] text-white/40 truncate">{u.username || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-white/55 max-w-[180px] truncate">{u.email}</td>
                    <td className="px-4 py-3 text-[13px] text-white/55">{u.profile?.phone || '-'}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3 text-[12px] text-white/35">{formatDate(u.createdAt)}</td>
                    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center">
                        <button onClick={(e) => { e.stopPropagation(); startEdit(u); }}
                          title="Edit account" className="w-8 h-8 rounded-xl border border-[#ffd555]/10 bg-[#ffd555]/[0.02] hover:bg-[#ffd555]/10 hover:border-[#ffd555]/30 hover:text-[#ffd555] text-[#ffd555]/70 flex items-center justify-center transition-all duration-200 hover:scale-105">
                          <Edit3 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* -- Pagination -- */}
        <div className="flex items-center justify-between px-8 py-4 border-t border-white/[0.05] bg-[#080808] flex-shrink-0">
          <span className="text-xs text-white/30">
            {accountState.isAvailable
              ? `Page ${page} of ${totalPages} · ${filtered.length} results`
              : 'Page — of — · — results'}
          </span>
          <div className="flex items-center gap-1">
            <button disabled={!accountState.isAvailable || page === 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/6 disabled:opacity-25 disabled:cursor-not-allowed transition-all">&larr; Prev</button>
            {Array.from({ length: accountState.isAvailable ? Math.min(totalPages, 7) : 0 }, (_, i) => {
              const p = i + 1;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${p === page ? 'bg-[#ffd555] text-black shadow-[0_0_12px_rgba(255,213,85,0.4)]' : 'text-white/40 hover:text-white hover:bg-white/6'}`}>
                  {p}
                </button>
              );
            })}
            <button disabled={!accountState.isAvailable || page === totalPages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/6 disabled:opacity-25 disabled:cursor-not-allowed transition-all">Next &rarr;</button>
          </div>
        </div>
      </div>


      {/* ════════════════════ RIGHT: DETAIL PANEL ════════════════════ */}
      <AnimatePresence>
        {panelUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closePanel}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 z-50 w-[440px] flex flex-col bg-[#1B2027] border-l border-white/[0.05] shadow-2xl"
            >
              {/* Panel Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.05] flex-shrink-0">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  {isEditing ? 'Edit Customer' : 'Customer Detail'}
                </h3>
                <button onClick={closePanel} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-all">
                  <X size={15} />
                </button>
              </div>

              {/* Panel Body */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-5 space-y-5">
                  {/* Avatar & Header Info */}
                  <div className="flex flex-col items-center text-center">
                    <div className="relative mb-3 group cursor-pointer">
                      <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${avatarGrad(panelUser)} opacity-20 blur-xl scale-125 group-hover:opacity-40 transition-opacity duration-300`} />
                      {panelUser.profile?.avatar
                        ? <img src={panelUser.profile.avatar} alt="" className="relative w-20 h-20 rounded-full object-cover ring-4 ring-[#1B2027] shadow-xl" />
                        : <div className={`relative w-20 h-20 rounded-full bg-gradient-to-br ${avatarGrad(panelUser)} flex items-center justify-center text-white text-3xl font-bold shadow-xl ring-4 ring-[#1B2027]`}>{initials(panelUser)}</div>
                      }
                      <span className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-[3px] border-[#1B2027] ${panelUser.status ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]'}`} />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-0.5">{displayName(panelUser)}</h2>
                    <p className="text-sm text-white/40 mb-3">@{panelUser.username || (panelUser.email || '').split('@')[0]}</p>
                    <div className="flex items-center gap-2">
                      <RoleBadge role={panelUser.role} />
                      <StatusBadge status={panelUser.status} />
                    </div>
                  </div>

                  {!isEditing ? (
                    <div className="space-y-4">
                      <div className="bg-[#171B20] rounded-2xl p-4 border border-white/[0.03] space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-[#ffd555]/80 mb-1">Basic Info</h4>
                        {[
                          { icon: Mail, label: 'Email Address', val: panelUser.email },
                          { icon: Phone, label: 'Phone Number', val: panelUser.profile?.phone || 'Not provided' },
                          { icon: Calendar, label: 'Join Date', val: formatDate(panelUser.createdAt) },
                        ].map(({ icon: Ic, label, val }) => (
                          <div key={label} className="flex items-center gap-3 group">
                            <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center text-white/40 group-hover:bg-[#ffd555]/10 group-hover:text-[#ffd555] transition-colors">
                              <Ic size={14} />
                            </div>
                            <div>
                              <p className="text-[10px] text-white/40 uppercase tracking-wider">{label}</p>
                              <p className="text-sm text-white/90">{val}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="bg-[#171B20] rounded-2xl p-4 border border-white/[0.03]">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-[#ffd555]/80 mb-3">Account Activity</h4>
                        <div className="relative pl-3 border-l border-white/10 space-y-4">
                          {[
                            { label: 'Account Created', date: panelUser.createdAt, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                            { label: 'Last Updated', date: panelUser.updatedAt, color: 'text-[#ffd555]', bg: 'bg-[#ffd555]/10' },
                          ].map(({ label, date, color, bg }, i) => (
                            <div key={i} className="relative">
                              <div className={`absolute -left-[21px] w-6 h-6 rounded-full border-[3px] border-[#1B2027] flex items-center justify-center ${bg}`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${color.replace('text-', 'bg-')}`} />
                              </div>
                              <div className="pl-3">
                                <p className="text-sm font-medium text-white">{label}</p>
                                <p className="text-xs text-white/40 mt-0.5">{formatDate(date)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-[#ffd555]/80 mb-1">Edit Basic Info</h4>
                        <div className="grid grid-cols-1 gap-3">
                          <div>
                            <label className="block text-[10px] font-medium text-white/50 mb-1">Full Name</label>
                            <div className="relative group">
                              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-[#ffd555] transition-colors" />
                              <input type="text" value={editForm.fullName || ''} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} placeholder="e.g. John Doe"
                                className="w-full bg-[#171B20] border border-white/[0.05] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#ffd555]/50 focus:ring-1 focus:ring-[#ffd555]/30 focus:shadow-[0_0_15px_rgba(255,213,85,0.15)] transition-all" />
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-white/50 mb-1">Phone Number</label>
                          <div className="relative group">
                            <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-[#ffd555] transition-colors" />
                            <input type="text" value={editForm.phone || ''} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="e.g. 0901234567"
                              className="w-full bg-[#171B20] border border-white/[0.05] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#ffd555]/50 focus:ring-1 focus:ring-[#ffd555]/30 focus:shadow-[0_0_15px_rgba(255,213,85,0.15)] transition-all" />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 pt-3 border-t border-white/[0.05]">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-[#ffd555]/80 mb-1">Role & Access</h4>
                        <div>
                          <label className="block text-[10px] font-medium text-white/50 mb-1">User Role</label>
                          {/* Frontend Validation: Role dropdown completely removed. Replaced with a hardcoded, uneditable disabled display to prevent privilege escalation. */}
                          <div className="w-full bg-[#171B20]/50 border border-white/[0.05] rounded-xl px-3 py-2.5 flex items-center justify-between text-sm text-white/60 cursor-not-allowed">
                            <div className="flex items-center gap-2">
                              <Shield size={14} className="text-[#ffd555]/60" />
                              <span className="capitalize">customer</span>
                            </div>
                            <Lock size={14} className="text-white/20" />
                          </div>
                          <p className="text-[10px] text-white/30 mt-1.5 ml-1">Staff can only assign and manage the 'Customer' role.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Panel Footer */}
              <div className="p-4 border-t border-white/[0.05] bg-[#171B20]/50 backdrop-blur-md flex-shrink-0">
                {saveState === 'success' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-center gap-2 text-emerald-400 text-sm font-medium mb-3 bg-emerald-400/10 py-1.5 rounded-lg">
                    <Check size={16} /> Changes saved successfully!
                  </motion.div>
                )}
                {saveState === 'error' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-center gap-2 text-rose-400 text-sm font-medium mb-3 bg-rose-500/10 py-1.5 rounded-lg">
                    <AlertTriangle size={16} /> Failed to save changes.
                  </motion.div>
                )}

                {!blockConfirm ? (
                  <div className="flex gap-3">
                    {isEditing ? (
                      <>
                        <button onClick={() => { setIsEditing(false); setSaveState('idle'); }}
                          className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-medium hover:bg-white/5 hover:text-white transition-all active:scale-95">
                          Cancel
                        </button>
                        <button onClick={handleSave} disabled={saveState === 'saving'}
                          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#ffd555] to-[#f59e0b] text-black text-sm font-bold shadow-[0_0_20px_rgba(255,213,85,0.2)] hover:shadow-[0_0_25px_rgba(255,213,85,0.4)] transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 relative overflow-hidden group">
                          {saveState === 'saving' ? (
                            <><RefreshCw size={16} className="animate-spin" /> Saving...</>
                          ) : (
                            <>
                              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                              <span className="relative z-10 flex items-center gap-2">Save Changes <Check size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" /></span>
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={startEdit}
                          className="flex-1 py-2.5 rounded-xl border border-[#ffd555]/30 text-[#ffd555] text-sm font-medium hover:bg-[#ffd555]/10 hover:shadow-[0_0_15px_rgba(255,213,85,0.15)] transition-all active:scale-95">
                          Edit Customer
                        </button>
                        {panelUser.status ? (
                          <button onClick={() => setBlockConfirm(true)}
                            className="flex-1 py-2.5 rounded-xl border border-rose-500/30 text-rose-400 text-sm font-medium hover:bg-rose-500/10 hover:shadow-[0_0_15px_rgba(244,63,94,0.2)] transition-all active:scale-95">
                            Block Customer
                          </button>
                        ) : (
                          <button onClick={() => handleBlockToggle(panelUser._id, panelUser.status)}
                            className="flex-1 py-2.5 rounded-xl border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-500/10 hover:shadow-[0_0_15px_rgba(52,211,153,0.2)] transition-all active:scale-95">
                            Unblock Customer
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
                    <div className="flex items-start gap-3 p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
                      <AlertTriangle size={18} className="text-rose-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-rose-200/80 leading-relaxed">
                        Are you sure you want to block <strong className="text-white">{displayName(panelUser)}</strong>? They will lose access to their account.
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => setBlockConfirm(false)} className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-sm font-medium transition-all">Cancel</button>
                      <button onClick={() => { handleBlockToggle(panelUser._id, panelUser.status); setBlockConfirm(false); }} className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all">Confirm Block</button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ════════════════════ TOAST ════════════════════ */}
      {toast && (
        <div
          className={`
            fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]
            flex items-center gap-2.5 px-5 py-2.5 rounded-full
            text-sm font-semibold shadow-2xl backdrop-blur-md border
            transition-all duration-300
            ${
              toast.type === "saving"
                ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
                : toast.type === "success"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-red-500/15 text-red-300 border-red-500/30"
            }
          `}
        >
          {toast.type === "saving" && (
            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          {toast.type === "success" && <Check size={16} className="shrink-0" />}
          {toast.type === "error" && <AlertTriangle size={16} className="shrink-0" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
