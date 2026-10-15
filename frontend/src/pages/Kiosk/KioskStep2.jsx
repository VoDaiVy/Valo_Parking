import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CarFront, CreditCard, X } from 'lucide-react';
import ParkingMapViewer from '../../components/ParkingMapViewer';
import { API_BASE } from '../../services/api';
import { getAvailableBookingSlots, getActiveHolds } from '../../services/bookingService';

export default function KioskStep2({ formData, updateFormData, onNext, onBack, isHoldingSlot = false }) {
  const [floors, setFloors] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dbSlots, setDbSlots] = useState([]);
  const [availableSlots, setAvailableSlots] = useState(null);
  const [activeHolds, setActiveHolds] = useState([]);
  const [checkingSlots, setCheckingSlots] = useState(false);

  const bookingMode = formData.bookingMode || 'hourly';
  const [pricingConfig, setPricingConfig] = useState(null);

  const calculateCurrentHourlyRate = () => {
    if (!pricingConfig || !pricingConfig.timeBlocks) return 10000;
    const now = new Date();
    const currentHour = now.getHours();
    const block = pricingConfig.timeBlocks.find(b => {
      if (b.startHour < b.endHour) {
        return currentHour >= b.startHour && currentHour < b.endHour;
      } else {
        return currentHour >= b.startHour || currentHour < b.endHour;
      }
    });
    return block ? block.price : 10000;
  };
  
  const appliedPricing = formData.pricingPackage || { name: 'Standard' };
  const hourlyRate = formData.pricingPackage?.price ? Number(formData.pricingPackage.price) : calculateCurrentHourlyRate();

  useEffect(() => {
    const fetchDbSlots = async () => {
      if (!currentFloorId) {
        setDbSlots([]);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/parking-floors/${currentFloorId}/slots`);
        const data = await res.json();
        if (data.success) {
          setDbSlots(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch slots', err);
      }
    };

    fetchDbSlots();
  }, [currentFloorId]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const floorRes = await fetch(`${API_BASE}/parking-floors`);
        const floorData = await floorRes.json();
        if (floorData.success) {
          setFloors(floorData.data);
          if (floorData.data.length > 0) {
            setCurrentFloorId(floorData.data[0]._id);
          }
        } else {
          setError(floorData.message);
        }

        const pricingRes = await fetch(`${API_BASE}/bookings/pricing-config`);
        const pricingData = await pricingRes.json();
        if (pricingData.success) {
          setPricingConfig(pricingData.data);
        }

        const sessionRes = await fetch(`${API_BASE}/sessions/active-status`);
        const sessionData = await sessionRes.json();
        if (sessionData.success) {
          setActiveSessions(sessionData.data);
        }
      } catch {
        setError('Failed to fetch data. Please check network.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(async () => {
      try {
        const sessionRes = await fetch(`${API_BASE}/sessions/active-status`);
        const sessionData = await sessionRes.json();
        if (sessionData.success) {
          setActiveSessions(sessionData.data);
        }
        
        const holdsRes = await getActiveHolds();
        if (holdsRes.ok && holdsRes.data?.data) {
          setActiveHolds(holdsRes.data.data);
        }
      } catch (err) {
        console.error('Kiosk polling error', err);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchAvailable = async () => {
      setCheckingSlots(true);
      try {
        const effectiveHours = Number(formData.durationHours || (bookingMode === 'daily' ? 24 : 1));
        const startTimeStr = new Date().toISOString();
        const endTimeStr = new Date(Date.now() + effectiveHours * 60 * 60 * 1000).toISOString();

        const availableRes = await getAvailableBookingSlots({
          startTime: startTimeStr,
          endTime: endTimeStr,
        });

        if (availableRes.ok && availableRes.data?.data?.slots) {
          setAvailableSlots(availableRes.data.data.slots);
        }

        const holdsRes = await getActiveHolds();
        if (holdsRes.ok && holdsRes.data?.data) {
          setActiveHolds(holdsRes.data.data);
        }
      } catch (err) {
        console.error('Failed to fetch available slots', err);
        setAvailableSlots([]);
      } finally {
        setCheckingSlots(false);
      }
    };

    fetchAvailable();
  }, [formData.durationHours, bookingMode]);

  const closePanel = () => {
    updateFormData({ selectedSlot: null, floorId: null });
  };

  return (
    <div className="flex flex-col flex-1 w-full mx-auto pb-0 relative h-full">
      <div className="flex-1 rounded-[32px] overflow-hidden relative flex flex-col w-full min-h-0 pt-0 pb-0 shadow-sm border border-[#0b0e16]">
        <div className="flex-1 w-full relative overflow-hidden bg-[#0b0e16] shadow-inner flex items-center justify-center">
          <div className="absolute top-6 left-0 right-0 flex justify-center gap-2 z-30 px-6 pointer-events-auto">
            {floors.map((floor) => (
              <button
                key={floor._id}
                onClick={() => setCurrentFloorId(floor._id)}
                className={`px-8 py-2 rounded-full font-bold text-sm transition-all shadow-sm ${
                  currentFloorId === floor._id
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                    : 'bg-[#181c23]/80 border border-white/10 text-gray-400 hover:text-white hover:bg-[#1f242d]/80 backdrop-blur'
                }`}
              >
                {floor.name}
              </button>
            ))}
          </div>

          {loading || checkingSlots ? (
            <div className="flex-1 flex flex-col items-center justify-center z-10 bg-[#0b0e16]/80 backdrop-blur-sm absolute inset-0">
              <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
              <div className="text-cyan-400 font-bold text-xl tracking-widest">{checkingSlots ? 'CHECKING SLOTS...' : 'LOADING MAP...'}</div>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-red-400 gap-4 z-10">
              <AlertCircle size={48} />
              <div className="font-bold">{error}</div>
            </div>
          ) : (
            <ParkingMapViewer
              floors={floors}
              currentFloorId={currentFloorId}
              onFloorSelect={setCurrentFloorId}
              activeSessions={activeSessions}
              dbSlots={dbSlots}
              availableSlots={availableSlots}
              activeHolds={activeHolds}
              selectedSlotId={formData.selectedSlot}
              onSelectSlot={(slot, floorId) => updateFormData({ selectedSlot: slot.id, floorId })}
              is2DMode={true}
              hideUI={true}
              theme="dark"
              initialZoom={0.5}
            />
          )}

          <div className="absolute bottom-6 left-0 right-0 flex justify-center z-30 pointer-events-none px-4">
            <div className="bg-[#181c23]/80 backdrop-blur border border-white/10 px-6 py-3 rounded-full flex items-center gap-4 shadow-lg pointer-events-auto">
              <p className="text-cyan-400 font-black text-[10px] uppercase tracking-widest pr-2 hidden sm:block">Status Legend</p>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded-sm bg-white border border-gray-300"></div>
                <span className="text-[10px] text-gray-300 font-bold tracking-wide">Available</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded-sm bg-red-500/20 border border-red-500"></div>
                <span className="text-[10px] text-gray-300 font-bold tracking-wide">Occupied</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded-sm bg-cyan-500 border border-cyan-400"></div>
                <span className="text-[10px] text-gray-300 font-bold tracking-wide">Selected</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded-sm bg-yellow-100 border border-yellow-500"></div>
                <span className="text-[10px] text-yellow-500 font-bold tracking-wide">VIP Pass</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-3.5 h-3.5 rounded-sm bg-red-200 border border-red-500"
                  style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.2) 4px, rgba(127, 29, 29, 0.3) 4px, rgba(127, 29, 29, 0.3) 8px)' }}
                ></div>
                <span className="text-[10px] text-gray-300 font-bold tracking-wide">Maintenance</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3.5 h-3.5 rounded-sm bg-orange-100 border border-orange-500"></div>
                <span className="text-[10px] text-orange-500 font-bold tracking-wide">Hold</span>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-500 z-40 rounded-[32px]
        ${formData.selectedSlot ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          onClick={closePanel}
        ></div>

        <div className="absolute top-0 right-0 h-full z-50 overflow-hidden rounded-r-[32px] pointer-events-none">
          <div
            className={`relative w-[400px] h-full bg-white shadow-[-20px_0_40px_rgba(0,0,0,0.15)] flex flex-col transition-transform duration-500 ease-out pointer-events-auto
          ${formData.selectedSlot ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <div className="flex justify-between items-center p-6 border-b border-gray-100">
              <h3 className="text-sm font-black text-[#0f172a] tracking-widest uppercase flex items-center gap-2">
                Booking Details
              </h3>
              <button onClick={closePanel} className="text-gray-400 hover:text-[#0f172a] bg-gray-50 hover:bg-gray-100 p-2 rounded-full transition-all">
                <X size={18} strokeWidth={3} />
              </button>
            </div>

            <div className="p-6 flex-1 flex flex-col overflow-y-auto">
              <div className="bg-[#0f172a] rounded-[24px] p-6 mb-6 text-white shadow-xl relative overflow-hidden shrink-0">
                <div className="absolute -top-10 -right-10 opacity-10 pointer-events-none">
                  <CarFront size={120} />
                </div>

                <div className="flex justify-between items-start mb-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Selected Slot</p>
                  <div className="bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider">
                    Available
                  </div>
                </div>
                <p className="text-[46px] font-black tracking-tight leading-none mb-4">{formData.selectedSlot || '--'}</p>

                <div className="flex justify-between items-end border-t border-white/10 pt-4 mt-2">
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium">Applied Pricing</p>
                    <p className="font-bold text-sm">
                      {formData.isVipReallocation ? 'VIP Subscription' : appliedPricing.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 font-medium">Rate</p>
                    <p className="font-bold text-sm text-[#FFDF00]">
                      {formData.isVipReallocation ? '0 VND / hr' : `${hourlyRate.toLocaleString('vi-VN')} VND / hr`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-auto">
                <div className="border-t-2 border-dashed border-gray-200 pt-6 pb-2">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-gray-500 font-medium">
                      {formData.isVipReallocation ? 'Temporary VIP Slot' : 'Standard Rate'}
                    </span>
                    <span className="text-sm font-bold text-gray-700">
                      {formData.isVipReallocation ? '0 VND / hr' : `${hourlyRate.toLocaleString('vi-VN')} VND / hr`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xs text-gray-500 font-medium">Taxes & Fees</span>
                    <span className="text-sm font-bold text-gray-700">Included</span>
                  </div>

                  <div className="flex justify-between items-end bg-gray-50 p-4 rounded-2xl">
                    <div className="flex items-center gap-2 text-[#0f172a]">
                      <CreditCard size={20} />
                      <span className="text-xs font-bold uppercase tracking-widest">
                        {formData.isVipReallocation ? 'Included in VIP' : 'Pay at Exit'}
                      </span>
                    </div>
                    {!formData.isVipReallocation && (
                      <div className="flex flex-col items-end">
                        <span className="text-3xl font-black text-[#0f172a] leading-none">{hourlyRate.toLocaleString('vi-VN')}</span>
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">VND / hr</span>
                      </div>
                    )}
                    {formData.isVipReallocation && (
                      <div className="flex flex-col items-end">
                        <span className="text-3xl font-black text-emerald-500 leading-none">FREE</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 text-center mt-3 font-medium">
                    {formData.isVipReallocation
                      ? '* This slot is temporarily assigned to you as a replacement for your occupied VIP slot. No extra charges apply.'
                      : '* Price is calculated from the member package configured by admin; no package selection is needed at the kiosk.'}
                  </p>
                </div>

                <div className="flex justify-between items-center gap-3 mt-4">
                  <button
                    onClick={onBack}
                    className="flex-1 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-bold py-4 rounded-2xl transition-all"
                  >
                    Back
                  </button>
                  <button
                    onClick={onNext}
                    disabled={!formData.selectedSlot || isHoldingSlot}
                    className={`flex-[2] flex items-center justify-center gap-2 text-lg font-bold py-4 rounded-2xl transition-all ${
                      !formData.selectedSlot || isHoldingSlot
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-[#FFDF00] text-[#0f172a] hover:bg-[#e6c800] shadow-[0_8px_20px_rgba(255,223,0,0.3)] active:scale-95'
                    }`}
                  >
                    {isHoldingSlot ? 'Holding Slot...' : 'Next Step'}
                    {!isHoldingSlot && <ArrowRight size={20} strokeWidth={3} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`mt-6 flex justify-center z-50 transition-all duration-500 shrink-0 ${formData.selectedSlot ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <button
          onClick={onBack}
          className="bg-[#0f172a] hover:bg-black text-white font-bold text-lg px-14 py-4 rounded-full transition-all active:scale-95"
        >
          Back
        </button>
      </div>
    </div>
  );
}
