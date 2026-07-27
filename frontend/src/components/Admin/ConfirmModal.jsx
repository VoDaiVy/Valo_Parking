import { X, AlertTriangle } from 'lucide-react';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", cancelText = "Cancel", isDestructive = true }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            {isDestructive && <AlertTriangle className="text-red-500" size={20} />}
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">{title}</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-gray-300 text-[15px] leading-relaxed">
            {message}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-4 border-t border-white/5 bg-black/20">
          <button 
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl font-bold text-sm text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-all uppercase tracking-wide"
          >
            {cancelText}
          </button>
          <button 
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm text-black transition-all uppercase tracking-wide ${
              isDestructive 
                ? "bg-red-500 hover:bg-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]" 
                : "bg-[#ffd555] hover:bg-[#ffe58a] shadow-[0_0_15px_rgba(255,213,85,0.2)]"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
