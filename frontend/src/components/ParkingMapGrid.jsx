import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Car, Zap, Maximize, TreePine, ArrowRight, Accessibility, Navigation, Layers, MonitorSmartphone } from "lucide-react";

const SlotElement = React.memo(({ el, floorId, style, isHovered, session, isMaintenance, isReserved, isHeld, aiStatus, canViewLicensePlate, onMouseEnter, onMouseLeave, onClick }) => {
  const slotZ = 5;
  const slotTransition = 'all 0.2s ease-in-out';
  const hasName = !!el.name && el.name.trim() !== '';
  const isWrongSlot = Boolean(
    aiStatus?.status === 'WRONG_SLOT_VIOLATION' || 
    aiStatus?.status === 'UNAUTHORIZED_OCCUPANCY' || 
    aiStatus?.violationType === 'WRONG_SLOT_VIOLATION' || 
    aiStatus?.isViolation
  );
  const detectedPlate = aiStatus?.plate || aiStatus?.detectedPlate || session?.licensePlate || null;

  const handleClick = (e, type) => {
    e.stopPropagation();
    if (!hasName) return;
    if (onClick) {
      onClick({ id: el.name || el.id, type, session, floorId, isReserved, isHeld, aiStatus, isWrongSlot, booking: el.booking });
    }
  };

  const maintenanceStyle = isMaintenance ? {
    backgroundImage: 'repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.2) 10px, rgba(127, 29, 29, 0.3) 10px, rgba(127, 29, 29, 0.3) 20px)'
  } : {};

  const isOccupied = Boolean(session || aiStatus?.occupied);

  if (el.type === 'slot') {
    let bgColor = '#ffffff';
    let borderColor = '#94a3b8';
    let vipBg = '#fef08a';
    let vipBorder = '#eab308';
    
    // Admin specific VIP display
    if (isReserved) {
       if (canViewLicensePlate && el.subscriptionType === 'monthly') {
          vipBg = '#fef08a'; // yellow background
          vipBorder = '#eab308'; // yellow border
       } else if (canViewLicensePlate && el.subscriptionType === 'yearly') {
          vipBg = '#fef08a'; // yellow background
          vipBorder = '#a855f7'; // purple border
       } else {
          // Default VIP or Customer view
          vipBg = '#fef08a'; 
          vipBorder = '#eab308';
       }
    }

    if (isWrongSlot) { bgColor = '#fef2f2'; borderColor = '#ef4444'; }
    else if (isMaintenance) { bgColor = '#fee2e2'; borderColor = '#ef4444'; }
    else if (isReserved) { bgColor = vipBg; borderColor = vipBorder; }
    else if (isOccupied) { bgColor = '#fecdd3'; borderColor = '#e11d48'; } 
    else if (isHeld) { bgColor = '#ffedd5'; borderColor = '#f97316'; }
    else if (isHovered) { bgColor = '#67e8f9'; borderColor = '#06b6d4'; }

    return (
      <div style={{...style, ...maintenanceStyle, opacity: hasName ? 1 : 0.3, cursor: hasName ? 'pointer' : 'not-allowed', transform: `translateZ(${slotZ}px) rotateZ(${el.rot || 0}deg)`, borderColor, backgroundColor: bgColor, transition: slotTransition }} className={`border-[2px] border-solid rounded-lg shadow-sm flex flex-col items-center justify-center group ${isWrongSlot ? 'animate-pulse ring-2 ring-red-500 shadow-[0_0_15px_rgba(239,68,68,0.7)]' : ''}`}
           onMouseEnter={() => onMouseEnter(el.id)}
           onMouseLeave={onMouseLeave}
           onClick={(e) => handleClick(e, 'hourly')}>
        <span className={`text-[10px] font-bold ${isOccupied ? 'mb-0.5' : 'mb-1'} ${isWrongSlot ? 'text-red-700' : isMaintenance ? 'text-red-700' : isReserved ? 'text-purple-700' : isHeld ? 'text-orange-700' : isOccupied ? 'text-rose-700' : 'text-slate-500 group-hover:text-[#0891b2]'}`} style={{ transform: 'translateZ(2px)' }}>
          {hasName ? el.name : ''}
        </span>
        {isOccupied && canViewLicensePlate && detectedPlate && (
           <div className={`px-1 py-0.5 mx-1 rounded-[3px] text-[7px] font-black uppercase tracking-tighter shadow-sm mb-0.5 w-[90%] text-center overflow-hidden text-ellipsis whitespace-nowrap ${isWrongSlot ? 'bg-red-600 text-white border border-red-700' : 'bg-white border border-gray-400 text-black'}`} style={{ transform: 'translateZ(3px)' }}>
             {isWrongSlot ? `⚠️ ${detectedPlate}` : detectedPlate}
           </div>
        )}
        <Car size={isOccupied && canViewLicensePlate ? 16 : 20} className={isWrongSlot ? 'text-red-600 animate-bounce' : isMaintenance ? 'text-red-500' : isReserved ? 'text-purple-500' : isHeld ? 'text-orange-500' : isOccupied ? 'text-rose-500' : 'text-slate-400 group-hover:text-[#06b6d4]'} style={{ transform: 'translateZ(5px)' }} />
      </div>
    );
  }

  if (el.type === 'slot-ev') {
    let bgColor = '#ecfdf5';
    let borderColor = '#10b981';
    let vipBg = '#fef08a';
    let vipBorder = '#eab308';
    if (isReserved) {
       if (canViewLicensePlate && el.subscriptionType === 'monthly') {
          vipBg = '#fef08a'; vipBorder = '#eab308';
       } else if (canViewLicensePlate && el.subscriptionType === 'yearly') {
          vipBg = '#fef08a'; vipBorder = '#a855f7';
       }
    }
    if (isWrongSlot) { bgColor = '#fef2f2'; borderColor = '#ef4444'; }
    else if (isMaintenance) { bgColor = '#fee2e2'; borderColor = '#ef4444'; }
    else if (isReserved) { bgColor = vipBg; borderColor = vipBorder; }
    else if (isOccupied) { bgColor = '#fecdd3'; borderColor = '#e11d48'; }
    else if (isHeld) { bgColor = '#ffedd5'; borderColor = '#f97316'; }
    else if (isHovered) { bgColor = '#6ee7b7'; borderColor = '#059669'; }
    return (
      <div style={{...style, ...maintenanceStyle, opacity: hasName ? 1 : 0.3, cursor: hasName ? 'pointer' : 'not-allowed', transform: `translateZ(${slotZ}px) rotateZ(${el.rot || 0}deg)`, borderColor, backgroundColor: bgColor, transition: slotTransition }} className={`border-[2px] border-solid rounded-lg shadow-sm flex flex-col items-center justify-center group ${isWrongSlot ? 'animate-pulse ring-2 ring-red-500 shadow-[0_0_15px_rgba(239,68,68,0.7)]' : ''}`}
           onMouseEnter={() => onMouseEnter(el.id)}
           onMouseLeave={onMouseLeave}
           onClick={(e) => handleClick(e, 'ev')}>
        <span className={`text-[10px] font-bold ${isOccupied ? 'mb-0.5' : 'mb-1'} ${isWrongSlot ? 'text-red-700' : isMaintenance ? 'text-red-700' : isReserved ? 'text-purple-700' : isHeld ? 'text-orange-700' : isOccupied ? 'text-rose-700' : 'text-emerald-600'}`} style={{ transform: 'translateZ(2px)' }}>
          {hasName ? el.name : ''}
        </span>
        {isOccupied && canViewLicensePlate && detectedPlate && (
           <div className={`px-1 py-0.5 mx-1 rounded-[3px] text-[7px] font-black uppercase tracking-tighter shadow-sm mb-0.5 w-[90%] text-center overflow-hidden text-ellipsis whitespace-nowrap ${isWrongSlot ? 'bg-red-600 text-white border border-red-700' : 'bg-white border border-gray-400 text-black'}`} style={{ transform: 'translateZ(3px)' }}>
             {isWrongSlot ? `⚠️ ${detectedPlate}` : detectedPlate}
           </div>
        )}
        <Zap size={isOccupied && canViewLicensePlate ? 16 : 20} className={isWrongSlot ? 'text-red-600 animate-bounce' : isMaintenance ? 'text-red-500' : isReserved ? 'text-purple-500' : isHeld ? 'text-orange-500' : isOccupied ? 'text-rose-500' : 'text-emerald-500'} style={{ transform: 'translateZ(5px)' }} />
      </div>
    );
  }

  if (el.type === 'slot-handicap') {
    let bgColor = '#eff6ff';
    let borderColor = '#3b82f6';
    let vipBg = '#fef08a';
    let vipBorder = '#eab308';
    if (isReserved) {
       if (canViewLicensePlate && el.subscriptionType === 'monthly') {
          vipBg = '#fef08a'; vipBorder = '#eab308';
       } else if (canViewLicensePlate && el.subscriptionType === 'yearly') {
          vipBg = '#fef08a'; vipBorder = '#a855f7';
       }
    }
    if (isWrongSlot) { bgColor = '#fef2f2'; borderColor = '#ef4444'; }
    else if (isMaintenance) { bgColor = '#fee2e2'; borderColor = '#ef4444'; }
    else if (isReserved) { bgColor = vipBg; borderColor = vipBorder; }
    else if (isOccupied) { bgColor = '#fecdd3'; borderColor = '#e11d48'; }
    else if (isHeld) { bgColor = '#ffedd5'; borderColor = '#f97316'; }
    else if (isHovered) { bgColor = '#93c5fd'; borderColor = '#2563eb'; }
    return (
      <div style={{...style, ...maintenanceStyle, opacity: hasName ? 1 : 0.3, cursor: hasName ? 'pointer' : 'not-allowed', transform: `translateZ(${slotZ}px) rotateZ(${el.rot || 0}deg)`, borderColor, backgroundColor: bgColor, transition: slotTransition }} className={`border-[2px] border-solid rounded-lg shadow-sm flex flex-col items-center justify-center group ${isWrongSlot ? 'animate-pulse ring-2 ring-red-500 shadow-[0_0_15px_rgba(239,68,68,0.7)]' : ''}`}
           onMouseEnter={() => onMouseEnter(el.id)}
           onMouseLeave={onMouseLeave}
           onClick={(e) => handleClick(e, 'handicap')}>
        <span className={`text-[10px] font-bold ${isOccupied ? 'mb-0.5' : 'mb-1'} ${isWrongSlot ? 'text-red-700' : isMaintenance ? 'text-red-700' : isReserved ? 'text-purple-700' : isHeld ? 'text-orange-700' : isOccupied ? 'text-rose-700' : 'text-blue-600'}`} style={{ transform: 'translateZ(2px)' }}>
          {hasName ? el.name : ''}
        </span>
        {isOccupied && canViewLicensePlate && detectedPlate && (
           <div className={`px-1 py-0.5 mx-1 rounded-[3px] text-[7px] font-black uppercase tracking-tighter shadow-sm mb-0.5 w-[90%] text-center overflow-hidden text-ellipsis whitespace-nowrap ${isWrongSlot ? 'bg-red-600 text-white border border-red-700' : 'bg-white border border-gray-400 text-black'}`} style={{ transform: 'translateZ(3px)' }}>
             {isWrongSlot ? `⚠️ ${detectedPlate}` : detectedPlate}
           </div>
        )}
        <Accessibility size={isOccupied && canViewLicensePlate ? 16 : 20} className={isWrongSlot ? 'text-red-600 animate-bounce' : isMaintenance ? 'text-red-500' : isReserved ? 'text-purple-500' : isHeld ? 'text-orange-500' : isOccupied ? 'text-rose-500' : 'text-blue-500'} style={{ transform: 'translateZ(5px)' }} />
      </div>
    );
  }

  return null;
});

export default function ParkingMapGrid({ 
  floors = [], 
  currentFloorId = null, 
  onFloorSelect, 
  onSlotClick,
  onZoneClick,
  activeSessions = [], 
  dbSlots = [], 
  availableSlots = null, 
  activeHolds = [],
  activeBookings = [],
  aiSlotStatuses = [],
  loading = false,
  is2DMode = false,
}) {
  const [camera, setCamera] = useState(
    is2DMode 
      ? { rotX: 0, rotZ: 0, panX: 0, panY: 0, zoom: 0.65 }
      : { rotX: 60, rotZ: -30, panX: 0, panY: 0, zoom: 0.7 }
  );
  const [dragStart, setDragStart] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredSlotId, setHoveredSlotId] = useState(null);
  const containerRef = useRef(null);

  // O(1) Lookup Maps for Performance Optimization
  const sessionMap = useMemo(() => {
    return activeSessions.reduce((acc, curr) => {
      acc[`${curr.floorId}-${curr.parkingSlot}`] = curr;
      return acc;
    }, {});
  }, [activeSessions]);

  const dbSlotMap = useMemo(() => {
    return dbSlots.reduce((acc, curr) => {
      acc[`${curr.floorID}-${curr.slotNumber}`] = curr;
      return acc;
    }, {});
  }, [dbSlots]);

  const availableSlotMap = useMemo(() => {
    if (!availableSlots) return null;
    return availableSlots.reduce((acc, curr) => {
      acc[`${curr.floorId}-${curr.slotCode}`] = true;
      return acc;
    }, {});
  }, [availableSlots]);

  const aiSlotMap = useMemo(() => {
    if (!Array.isArray(aiSlotStatuses)) return {};
    return aiSlotStatuses.reduce((acc, curr) => {
      if (curr.slotCode) {
        acc[String(curr.slotCode).trim().toUpperCase()] = curr;
      }
      return acc;
    }, {});
  }, [aiSlotStatuses]);

  const canViewLicensePlate = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('valo_user');
      if (raw) {
        const user = JSON.parse(raw);
        return user.role === 'admin' || user.role === 'staff';
      }
    } catch (e) {
      return false;
    }
    return false;
  }, []);

  const handleMouseEnterSlot = useCallback((id) => setHoveredSlotId(id), []);
  const handleMouseLeaveSlot = useCallback(() => setHoveredSlotId(null), []);

  useEffect(() => {
    const container = containerRef.current;
    const handleWheelNative = (e) => {
      e.preventDefault();
      setCamera((prev) => ({
        ...prev,
        zoom: Math.max(0.1, Math.min(prev.zoom - e.deltaY * 0.002, 3))
      }));
    };
    if (container) {
      container.addEventListener("wheel", handleWheelNative, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheelNative);
      }
    };
  }, []);

  const handleMouseDown = (e) => {
    setIsDragging(true);
    let action = 'orbit';
    if (e.button === 2 || e.button === 1 || e.shiftKey) {
      action = 'pan';
    }
    setDragStart({ x: e.clientX, y: e.clientY, action, startCamera: { ...camera } });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart) return;
    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;
    
    if (dragStart.action === 'orbit' && !is2DMode) {
      setCamera({
        ...dragStart.startCamera,
        rotZ: dragStart.startCamera.rotZ + deltaX * 0.5,
        rotX: Math.max(0, Math.min(90, dragStart.startCamera.rotX - deltaY * 0.5))
      });
    } else if (dragStart.action === 'pan' || (dragStart.action === 'orbit' && is2DMode)) {
      setCamera({
        ...dragStart.startCamera,
        panX: dragStart.startCamera.panX + deltaX,
        panY: dragStart.startCamera.panY + deltaY
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStart(null);
  };

  const handleContextMenu = (e) => e.preventDefault();

  const renderDynamicElements = (elements, floorId) => {
    if (!elements) return null;
    return elements.map(el => {
      const style = {
        position: 'absolute',
        left: `${el.x}px`,
        top: `${el.y}px`,
        width: `${el.w}px`,
        height: `${el.h}px`,
        transform: `translateZ(1px) rotateZ(${el.rot || 0}deg)`,
        transformStyle: 'preserve-3d'
      };

      if (el.type === 'zone') {
        const themeColor = el.color || 'purple';
        const borderColors = { purple: '#a855f7', emerald: '#10b981', blue: '#3b82f6', amber: '#f59e0b' };
        const bgColors = { purple: 'rgba(168,85,247,0.1)', emerald: 'rgba(16,185,129,0.1)', blue: 'rgba(59,130,246,0.1)', amber: 'rgba(245,158,11,0.1)' };
        
        return (
          <div
            key={el.id}
            style={{...style, transform: `translateZ(2px) rotateZ(${el.rot || 0}deg)`, borderColor: borderColors[themeColor] || '#a855f7', backgroundColor: bgColors[themeColor] || 'rgba(168,85,247,0.1)' }}
            className="border-[2px] border-solid shadow-md rounded-xl cursor-pointer hover:brightness-125 transition"
            title={`${el.name || el.id}: Zone details`}
            onClick={(e) => {
              e.stopPropagation();
              if (onZoneClick) {
                onZoneClick({
                  id: el.id,
                  name: el.name || el.id,
                  type: 'zone',
                  floorId,
                });
              }
            }}
          >
             {el.name && el.name.trim() !== '' && (
               <div className="absolute -top-4 left-4 px-3 py-1 bg-white border-[2px] border-solid rounded-full shadow-md flex items-center justify-center" style={{ borderColor: borderColors[themeColor] || '#a855f7', transform: 'translateZ(10px)' }}>
                  <span className="font-black tracking-widest text-[10px] uppercase leading-none" style={{ color: borderColors[themeColor] || '#a855f7' }}>{el.name}</span>
               </div>
             )}
          </div>
        );
      }

      if (el.type.startsWith('slot')) {
        const isHovered = hoveredSlotId === el.id;
        const session = sessionMap[`${floorId}-${el.name || el.id}`];
        const dbSlot = dbSlotMap[`${floorId}-${el.name || el.id}`];
        const isMaintenance = dbSlot?.status === 'maintenance';
        
        const hasName = !!el.name && el.name.trim() !== '';
        // Only evaluate if it has a valid name (real slot). Phantom unnamed slots are not reserved.
        const isAvailable = (hasName && availableSlotMap) ? !!availableSlotMap[`${floorId}-${el.name}`] : (hasName ? false : true);
        
        let isHeld = false;
        if (activeHolds && hasName) {
          isHeld = activeHolds.some(h => String(h.floorId) === String(floorId) && String(h.slotCode).toUpperCase() === String(el.name).toUpperCase());
        }

        const isReserved = !!dbSlot?.subscriptionType;
        const aiStatus = aiSlotMap[String(el.name || el.id).trim().toUpperCase()];

        // If a slot is booked but a car hasn't physically checked in (no session), it's unavailable.
        // We render it as 'Held' (Orange) to distinguish from 'Occupied' (Red).
        let booking = null;
        if (hasName && availableSlotMap && !isAvailable && !session && !isMaintenance && !isReserved) {
          isHeld = true;
          if (activeBookings) {
            booking = activeBookings.find(b => String(b.floorId) === String(floorId) && String(b.parkingSlot).toUpperCase() === String(el.name).toUpperCase());
          }
        }

        return (
          <SlotElement 
            key={el.id}
            el={{ ...el, subscriptionType: dbSlot?.subscriptionType, booking }}
            floorId={floorId}
            style={style} 
            isHovered={isHovered}
            session={session}
            isMaintenance={isMaintenance}
            isReserved={isReserved}
            isHeld={isHeld}
            aiStatus={aiStatus}
            canViewLicensePlate={canViewLicensePlate}
            onMouseEnter={handleMouseEnterSlot}
            onMouseLeave={handleMouseLeaveSlot}
            onClick={onSlotClick}
          />
        );
      }

      // Other static elements (gate, planter, wall, road, etc)
      if (el.type === 'gate') {
         return (
           <div key={el.id} style={{...style, transform: `translateZ(10px) rotateZ(${el.rot || 0}deg)`, borderColor: '#22c55e', backgroundColor: '#dcfce7', color: '#15803d' }} className="flex items-center justify-center text-xs font-black rounded border-[2px] border-solid shadow-md tracking-wider">
             {el.name || 'GATE'}
           </div>
         );
      }
      if (el.type === 'planter') {
        return (
          <div key={el.id} style={{...style, transform: `translateZ(15px) rotateZ(${el.rot || 0}deg)`, borderColor: '#34d399', backgroundColor: '#d1fae5' }} className="flex flex-col items-center justify-evenly border-[2px] border-solid rounded-full shadow-md">
            <TreePine size={18} className="text-[#059669]" style={{ transform: 'translateZ(10px)' }} />
            <TreePine size={18} className="text-[#059669]" style={{ transform: 'translateZ(15px)' }} />
          </div>
        );
      }
      if (el.type === 'wall') {
        return (
          <div key={el.id} style={{...style, transform: `translateZ(15px) rotateZ(${el.rot || 0}deg)`, backgroundColor: '#475569', borderColor: '#334155'}} className="border-[2px] border-solid shadow-md flex items-center justify-center overflow-hidden rounded">
             <div className="w-full h-full" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.2) 10px, rgba(0,0,0,0.2) 20px)' }}></div>
          </div>
        );
      }
      if (el.type === 'road') {
        return (
          <div key={el.id} style={{...style, transform: `translateZ(1px) rotateZ(${el.rot || 0}deg)`}} className="flex items-center justify-center opacity-60 pointer-events-none">
             <div className="text-[#f59e0b] font-black tracking-widest text-xl flex items-center gap-2 drop-shadow-md">
                <ArrowRight size={32} />
                <span className="uppercase">{el.name}</span>
             </div>
          </div>
        );
      }
      if (el.type === 'bump') {
        return (
          <div key={el.id} style={{...style, transform: `translateZ(2px) rotateZ(${el.rot || 0}deg)`}} className="flex items-center justify-center rounded overflow-hidden shadow-sm">
             <div className="w-full h-full" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #fbbf24, #fbbf24 10px, #000 10px, #000 20px)' }}></div>
          </div>
        );
      }
      if (el.type === 'pillar') {
         return (
           <div key={el.id} style={{...style, transform: `translateZ(40px) rotateZ(${el.rot || 0}deg)`, backgroundColor: '#cbd5e1', borderColor: '#94a3b8'}} className="border-[2px] border-solid shadow-2xl flex items-center justify-center text-[10px] font-bold text-slate-600 rounded-sm">
             {el.name}
           </div>
         );
      }
      if (el.type === 'sign') {
         return (
           <div key={el.id} style={{...style, transform: `translateZ(30px) rotateZ(${el.rot || 0}deg)`}} className="flex flex-col items-center justify-center">
             <div className="w-full h-full bg-[#ef4444] rounded-full border-[3px] border-white flex items-center justify-center shadow-lg text-white font-black text-[10px] text-center p-1 leading-tight z-10">
                {el.name}
             </div>
             <div className="w-1 h-8 bg-slate-400 absolute -bottom-6 z-0"></div>
           </div>
         );
      }
      if (el.type === 'ramp') {
         return (
           <div key={el.id} style={{...style, transform: `translateZ(5px) rotateZ(${el.rot || 0}deg)`, backgroundImage: 'linear-gradient(to top, #94a3b8, #cbd5e1)'}} className="border-[2px] border-[#64748b] border-solid shadow-md flex items-center justify-center text-xs font-bold text-slate-700 rounded-sm overflow-hidden">
             <div className="flex flex-col items-center gap-2">
                <Navigation size={24} className="text-slate-600" />
                <span>{el.name}</span>
             </div>
           </div>
         );
      }
      if (el.type === 'elevator') {
         return (
           <div key={el.id} style={{...style, transform: `translateZ(50px) rotateZ(${el.rot || 0}deg)`, backgroundColor: '#f8fafc', borderColor: '#cbd5e1'}} className="border-[4px] border-double shadow-2xl flex flex-col items-center justify-center text-[10px] font-bold text-slate-500 rounded">
             <Layers size={24} className="text-slate-400 mb-1" />
             {el.name}
           </div>
         );
      }
      if (el.type === 'kiosk') {
         return (
           <div key={el.id} style={{...style, transform: `translateZ(20px) rotateZ(${el.rot || 0}deg)`, backgroundColor: '#1e293b', borderColor: '#0ea5e9'}} className="border-[2px] border-solid shadow-xl flex flex-col items-center justify-center text-[8px] font-bold text-sky-400 rounded-sm">
             <MonitorSmartphone size={16} className="text-sky-400 mb-1" />
             {el.name}
           </div>
         );
      }
      if (el.type === 'group') {
         return (
           <div key={el.id} style={{...style, transform: `translateZ(0px) rotateZ(${el.rot || 0}deg)`, transformStyle: 'preserve-3d'}} className="pointer-events-none">
             {el.children && renderDynamicElements(el.children)}
           </div>
         );
      }
      return null;
    });
  };

  return (
    <>
      {!is2DMode && (
        <div className="absolute top-4 right-8 z-50 text-white/40 text-xs text-right pointer-events-none">
          <p><strong>Left Click + Drag</strong>: Orbit 3D Space</p>
          <p><strong>Shift + Drag / Right Click</strong>: Pan</p>
          <p><strong>Mouse Wheel</strong>: Zoom</p>
        </div>
      )}

      <div 
        ref={containerRef}
        className={`flex-1 overflow-hidden relative p-8 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} w-full h-full`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      >
        <style dangerouslySetInnerHTML={{__html: `
          .floor-plane { transform-style: preserve-3d; transition: filter 0.3s; }
        `}} />

        <div className="absolute top-1/2 left-1/2" style={{ perspective: '2000px', transformStyle: 'preserve-3d' }}>
          <div style={{
            transformStyle: 'preserve-3d',
            transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom}) rotateX(${camera.rotX}deg) rotateZ(${camera.rotZ}deg)`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}>
            {loading ? (
              <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 text-cyan-400 font-bold text-xl">Loading layout...</div>
            ) : (
              <>
                {floors.map((floor, idx) => {
                  const currentFloorIndex = currentFloorId ? floors.findIndex(f => f._id === currentFloorId) : -1;
                  const isOverview = currentFloorIndex === -1;
                  const isCurrent = idx === currentFloorIndex;
                  const isAbove = !isOverview && idx > currentFloorIndex;
                  const isBelow = !isOverview && idx < currentFloorIndex;
                  
                  let targetZ;
                  let targetOpacity = 1;
                  let pointerEvents = 'auto';

                  if (is2DMode) {
                      if (isOverview) {
                          targetZ = -800;
                          targetOpacity = 0;
                          pointerEvents = 'none';
                      } else {
                          if (isAbove) {
                              targetZ = 800;
                              targetOpacity = 0;
                              pointerEvents = 'none';
                          } else if (isBelow) {
                              targetZ = -800;
                              targetOpacity = 0;
                              pointerEvents = 'none';
                          } else {
                              targetZ = 0;
                          }
                      }
                  } else {
                      if (isOverview) {
                          const centerIndex = (floors.length - 1) / 2;
                          targetZ = (idx - centerIndex) * 200;
                      } else {
                          targetZ = (idx - currentFloorIndex) * 150;
                          if (isAbove) {
                              targetZ += 500;
                              targetOpacity = 0;
                              pointerEvents = 'none';
                          } else if (isBelow) {
                              targetOpacity = 0.2;
                          }
                      }
                  }
                  
                  return (
                    <div 
                      key={floor._id}
                      className="absolute floor-plane group"
                      style={{
                        transformStyle: 'preserve-3d',
                        transform: `translate(-50%, -50%) translateZ(${targetZ}px)`,
                        width: floor.layoutData?.width || 1000,
                        height: floor.layoutData?.height || 600,
                        backgroundColor: isCurrent ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.7)',
                        border: isCurrent ? '2px solid rgba(6,182,212,0.8)' : '1px solid rgba(255,255,255,0.5)',
                        borderRadius: '2rem',
                        boxShadow: isCurrent ? '0 0 50px rgba(6,182,212,0.2)' : '0 0 30px rgba(0,0,0,0.2)',
                        backdropFilter: 'blur(8px)',
                        opacity: targetOpacity,
                        pointerEvents: pointerEvents,
                        transition: 'transform 1.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 1.2s ease, background-color 1s ease'
                      }}
                      onClick={(e) => {
                         if (!isCurrent && onFloorSelect) {
                            e.stopPropagation();
                            onFloorSelect(floor._id);
                         } else if (e.target === e.currentTarget && onFloorSelect) {
                            onFloorSelect(floor._id);
                         }
                      }}
                    >
                      {!is2DMode && (
                        <div className="absolute -top-12 left-10 text-cyan-400/80 font-black text-3xl tracking-widest uppercase drop-shadow-xl transition-all duration-1000 pointer-events-none" 
                             style={{ transform: 'translateZ(20px)', opacity: isCurrent ? 1 : 0.5 }}>
                          {floor.name} {isCurrent && <span className="text-sm bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded-full ml-4">SELECTED</span>}
                        </div>
                      )}
                      
                      <div className="absolute inset-0 rounded-[2rem] pointer-events-none opacity-20"
                           style={{ backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />

                      <div className="absolute inset-0" style={{ pointerEvents: !isCurrent ? 'none' : 'auto', transformStyle: 'preserve-3d' }}>
                        {renderDynamicElements(floor.layoutData?.elements, floor._id)}
                      </div>
                      
                      {floor.layoutData?.elements?.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-white/30 font-bold text-xl tracking-widest uppercase pointer-events-none">
                          <p>Empty Layout</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        <div className="absolute bottom-14 right-8 flex flex-row gap-2 z-50">
          <button onClick={() => setCamera(is2DMode ? { rotX: 0, rotZ: 0, panX: 0, panY: 0, zoom: 0.65 } : { rotX: 60, rotZ: -30, panX: 0, panY: 0, zoom: 0.7 })} className="p-3 bg-[#181c23]/80 hover:bg-white/10 backdrop-blur border border-white/10 rounded-xl text-white shadow-xl transition-all"><Maximize size={20} /></button>
        </div>
      </div>
    </>
  );
}
