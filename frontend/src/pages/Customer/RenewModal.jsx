import { useState } from 'react';
import { X, CreditCard, Wallet, Loader2, AlertCircle, CalendarClock } from 'lucide-react';
import { API_BASE } from '../../services/api';

export default function RenewModal({ isOpen, onClose, membership, onSuccess }) {
  const [paymentMethod, setPaymentMethod] = useState('PAYOS');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen || !membership) return null;

  const handleRenew = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const token = localStorage.getItem("accessToken");
      const res = await fetch(`${API_BASE}/subscriptions/renew`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          subscriptionId: membership.subscriptionId, // We need to make sure this is available in profile.membership
          paymentMethod 
        })
      });
      const data = await res.json();
      
      if (!data.success) {
        setErrorMsg(data.message || 'Failed to renew subscription.');
        setLoading(false);
        return;
      }

      if (paymentMethod === 'WALLET') {
        onSuccess();
      } else if (paymentMethod === 'PAYOS' && data.data.checkoutUrl) {
        window.location.href = data.data.checkoutUrl;
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Network error while processing renewal.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#181c23] border border-white/10 shadow-2xl rounded-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center border border-yellow-500/30">
              <CalendarClock size={16} className="text-yellow-400" />
            </div>
            <div>
              <h3 className="text-white font-bold tracking-wide uppercase text-sm">Renew VIP Pass</h3>
              <p className="text-xs text-gray-400 font-mono">Keep your reserved slots</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white bg-black/20 hover:bg-black/40 p-2 rounded-full transition-colors border border-white/5">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {errorMsg && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg flex items-center gap-2">
              <AlertCircle size={16} />
              {errorMsg}
            </div>
          )}

          <div className="bg-black/40 border border-white/5 rounded-xl p-5 mb-6">
            <p className="text-sm text-gray-400 mb-2">Current Expiration</p>
            <p className="text-lg font-bold text-yellow-400 mb-4">
              {new Date(membership.expireAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <p className="text-xs text-gray-500">
              Renewing will extend your current subscription duration. The exact price depends on your original package.
            </p>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Select Payment Method</label>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setPaymentMethod('PAYOS')}
                className={`flex items-center justify-between p-4 rounded-xl border transition-all ${paymentMethod === 'PAYOS' ? 'border-yellow-500 bg-yellow-500/10' : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/40'}`}
              >
                <div className="flex items-center gap-3">
                  <CreditCard size={20} className={paymentMethod === 'PAYOS' ? 'text-yellow-400' : 'text-gray-400'} />
                  <span className={`font-semibold ${paymentMethod === 'PAYOS' ? 'text-white' : 'text-gray-300'}`}>PayOS (VNPay / Card)</span>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 ${paymentMethod === 'PAYOS' ? 'border-yellow-500 bg-yellow-400' : 'border-gray-500'}`} />
              </button>

              <button
                onClick={() => setPaymentMethod('WALLET')}
                className={`flex items-center justify-between p-4 rounded-xl border transition-all ${paymentMethod === 'WALLET' ? 'border-yellow-500 bg-yellow-500/10' : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/40'}`}
              >
                <div className="flex items-center gap-3">
                  <Wallet size={20} className={paymentMethod === 'WALLET' ? 'text-yellow-400' : 'text-gray-400'} />
                  <span className={`font-semibold ${paymentMethod === 'WALLET' ? 'text-white' : 'text-gray-300'}`}>Valo Wallet</span>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 ${paymentMethod === 'WALLET' ? 'border-yellow-500 bg-yellow-400' : 'border-gray-500'}`} />
              </button>
            </div>
          </div>

          <button 
            onClick={handleRenew}
            disabled={loading}
            className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-extrabold uppercase tracking-wider py-4 rounded-xl transition-all shadow-[0_0_20px_rgba(234,179,8,0.2)] flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : 'Confirm Renewal'}
          </button>
        </div>
      </div>
    </div>
  );
}
