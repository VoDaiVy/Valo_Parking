import { Scanner } from '@yudiel/react-qr-scanner';
import { X } from 'lucide-react';

export default function KioskQrScannerModal({ isOpen, onClose, onScan }) {
  if (!isOpen) return null;

  const handleScan = (result) => {
    console.log('KioskQrScannerModal handleScan result:', result);
    if (result && result.length > 0 && result[0] && result[0].rawValue) {
      onScan(result[0].rawValue);
    }
  };

  const handleError = (error) => {
    console.error('KioskQrScannerModal onError:', error);
    if (error && error.name === 'NotAllowedError') {
      alert('Camera access denied! Please allow camera access in your browser settings.');
    } else if (error && error.message) {
      alert('Camera error: ' + error.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="bg-[#111827] w-full max-w-[500px] rounded-3xl overflow-hidden border-2 border-[#FFDF00] shadow-[0_0_50px_rgba(255,223,0,0.15)] flex flex-col relative animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="p-4 bg-[#FFDF00] text-[#0f172a] flex items-center justify-between">
          <h3 className="font-bold text-lg tracking-widest uppercase flex items-center gap-2">
            SCAN VIP / BOOKING QR
          </h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-full hover:bg-black/10 transition-colors"
          >
            <X size={24} strokeWidth={2.5} />
          </button>
        </div>

        {/* Scanner Body */}
        <div className="p-6 flex flex-col items-center">
          <p className="text-gray-400 text-center mb-6 text-sm">
            Please place your VIP membership or pre-booking QR code in front of the camera.
          </p>
          
          <div className="w-full aspect-square rounded-2xl overflow-hidden border-4 border-dashed border-[#FFDF00]/50 relative bg-black flex items-center justify-center">
            <Scanner
              onScan={handleScan}
              onError={handleError}
              scanDelay={300}
              constraints={{ facingMode: 'user' }}
              styles={{ video: { height: '100%', width: '100%', objectFit: 'cover' } }}
            />
            {/* Corner brackets overlay */}
            <div className="absolute inset-4 pointer-events-none z-10">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#FFDF00] rounded-tl-xl"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#FFDF00] rounded-tr-xl"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#FFDF00] rounded-bl-xl"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#FFDF00] rounded-br-xl"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
