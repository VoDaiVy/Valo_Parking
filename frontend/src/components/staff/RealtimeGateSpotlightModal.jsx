import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, AlertTriangle, X, ExternalLink, Radio,
  Camera, CheckCircle2, AlertCircle, Car
} from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { useGateCameraConfig } from '../../hooks/useGateCameraConfig';
import LaneCameraPreview from '../LaneCameraPreview';

/**
 * Format Vietnamese license plate standard (e.g. 77C14399 -> 77C - 143.99, 20D56298 -> 20D - 562.98)
 */
function formatVietnamesePlate(raw = '') {
  if (!raw) return '';
  const clean = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return '';

  let province, series, numbers;
  if (clean.length === 9) {
    if (/^\d{2}[A-Z]\d\d{5}$/.test(clean) || /^\d{2}[A-Z]{2}\d{5}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 4);
      numbers = clean.slice(4);
    }
  } else if (clean.length === 8) {
    if (/^\d{2}[A-Z]\d{5}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 3);
      numbers = clean.slice(3);
    } else if (/^\d{2}[A-Z]\d\d{4}$/.test(clean) || /^\d{2}[A-Z]{2}\d{4}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 4);
      numbers = clean.slice(4);
    }
  } else if (clean.length === 7) {
    if (/^\d{2}[A-Z]\d{4}$/.test(clean)) {
      province = clean.slice(0, 2);
      series = clean.slice(2, 3);
      numbers = clean.slice(3);
    }
  }

  if (province && series && numbers) {
    let formattedNumbers = numbers;
    if (numbers.length === 5) formattedNumbers = `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
    const isMotorbike = /\d/.test(series);
    return isMotorbike ? `${province}-${series} ${formattedNumbers}` : `${province}${series} - ${formattedNumbers}`;
  }
  return clean;
}

/**
 * Gentle alert chime when vehicle is detected
 */
function playGateAlertChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14); // A5

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}

/**
 * Electronic arrival whoosh/ping when modal arrives at sidebar Gate Control
 */
function playArrivalChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.26); // D6

    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (_) {}
}

export default function RealtimeGateSpotlightModal() {
  const socket = useSocket();
  const location = useLocation();
  const navigate = useNavigate();
  const { cameraConfig } = useGateCameraConfig();

  // Multi-lane detection: holds parallel events for entry and exit gates
  const [laneEvents, setLaneEvents] = useState({
    entry: null,
    exit: null,
  });

  const [cameraActive, setCameraActive] = useState(false);

  // Separate video refs for dual camera feeds
  const entryVideoRef = useRef(null);
  const exitVideoRef = useRef(null);
  const entryStreamRef = useRef(null);
  const exitStreamRef = useRef(null);

  const modalRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const isFlyingRef = useRef(false);

  // Suppress modal if staff is already on Gate Control page
  const isOnGatePage = location.pathname === '/staff/gate';

  const hasEntry = Boolean(laneEvents.entry);
  const hasExit = Boolean(laneEvents.exit);
  const bothLanesActive = hasEntry && hasExit;
  const isAnyActive = hasEntry || hasExit;

  // ─── CAMERA STREAM CONTROLLER (Robust multi-lane streaming) ───
  const startLaneCamera = useCallback(async (lane) => {
    try {
      const preferredDeviceId = lane === 'exit'
        ? localStorage.getItem('valo_exit_cam')
        : localStorage.getItem('valo_entry_cam');

      const otherStream = lane === 'exit' ? entryStreamRef.current : exitStreamRef.current;
      const otherDeviceId = lane === 'exit'
        ? localStorage.getItem('valo_entry_cam')
        : localStorage.getItem('valo_exit_cam');

      // If both lanes use the same physical camera, share the stream
      if (otherStream && preferredDeviceId === otherDeviceId) {
        if (lane === 'entry' && entryVideoRef.current) {
          entryVideoRef.current.srcObject = otherStream;
          await entryVideoRef.current.play().catch(() => {});
          entryStreamRef.current = otherStream;
        } else if (lane === 'exit' && exitVideoRef.current) {
          exitVideoRef.current.srcObject = otherStream;
          await exitVideoRef.current.play().catch(() => {});
          exitStreamRef.current = otherStream;
        }
        setCameraActive(true);
        return;
      }

      const constraintSteps = [
        {
          video: {
            ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : {}),
            width: { min: 960, ideal: 1280 },
            height: { min: 540, ideal: 720 },
          },
          audio: false,
        },
        {
          video: {
            ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : { facingMode: 'environment' }),
          },
          audio: false,
        },
        { video: true, audio: false },
      ];

      let stream = null;
      let lastErr = null;
      for (const constraints of constraintSteps) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!stream) throw lastErr || new Error('No camera stream accessible');

      if (lane === 'entry') {
        entryStreamRef.current = stream;
        if (entryVideoRef.current) {
          entryVideoRef.current.srcObject = stream;
          await entryVideoRef.current.play().catch(() => {});
        }
      } else {
        exitStreamRef.current = stream;
        if (exitVideoRef.current) {
          exitVideoRef.current.srcObject = stream;
          await exitVideoRef.current.play().catch(() => {});
        }
      }
      setCameraActive(true);
    } catch (err) {
      console.info(`[Spotlight Modal] Camera fallback for ${lane}:`, err?.message || err);
    }
  }, []);

  const stopCameras = useCallback(() => {
    if (entryStreamRef.current) {
      entryStreamRef.current.getTracks().forEach((t) => t.stop());
      entryStreamRef.current = null;
    }
    if (exitStreamRef.current && exitStreamRef.current !== entryStreamRef.current) {
      exitStreamRef.current.getTracks().forEach((t) => t.stop());
      exitStreamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // ─── PARABOLIC "ADD TO CART" FLY TO GATE CONTROL ANIMATION (Refined & Slower: ~1.15s) ───
  const triggerFlySequence = useCallback(() => {
    if (isFlyingRef.current) return;
    isFlyingRef.current = true;

    const navEl = document.getElementById('sidebar-nav-gate');
    const modalEl = modalRef.current;

    // Capture geometry before closing React modal state
    let modalRect = null;
    let navRect = null;
    if (modalEl) modalRect = modalEl.getBoundingClientRect();
    if (navEl) navRect = navEl.getBoundingClientRect();

    // Immediately close modal state & stop camera to free resources
    stopCameras();
    setLaneEvents({ entry: null, exit: null });

    if (!navEl || !modalRect || !navRect) {
      isFlyingRef.current = false;
      return;
    }

    // Create a standalone flying ghost element for true 60fps parabolic animation
    const ghost = document.createElement('div');
    ghost.style.position = 'fixed';
    ghost.style.left = `${modalRect.left}px`;
    ghost.style.top = `${modalRect.top}px`;
    ghost.style.width = `${modalRect.width}px`;
    ghost.style.height = `${modalRect.height}px`;
    ghost.style.borderRadius = '24px';
    ghost.style.border = '2px solid rgba(16, 185, 129, 0.95)';
    ghost.style.backgroundColor = '#0c131f';
    ghost.style.backgroundImage = 'radial-gradient(circle at center, rgba(16, 185, 129, 0.5) 0%, rgba(12, 19, 31, 0.98) 75%)';
    ghost.style.boxShadow = '0 0 60px rgba(16, 185, 129, 0.9), 0 0 120px rgba(52, 211, 153, 0.6)';
    ghost.style.zIndex = '99999';
    ghost.style.pointerEvents = 'none';
    ghost.style.overflow = 'hidden';
    ghost.style.display = 'flex';
    ghost.style.alignItems = 'center';
    ghost.style.justifyContent = 'center';
    ghost.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#34d399;font-weight:900;font-family:sans-serif;">
        <div style="display:flex;align-items:center;gap:8px;font-size:14px;letter-spacing:1px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;box-shadow:0 0 14px #10b981;"></span>
          <span>VALO GATE CONTROL</span>
        </div>
        <div style="font-size:11px;font-weight:600;color:#94a3b8;letter-spacing:0.5px;">Syncing telemetry...</div>
      </div>
    `;
    document.body.appendChild(ghost);

    const startCenterX = modalRect.left + modalRect.width / 2;
    const startCenterY = modalRect.top + modalRect.height / 2;
    const endCenterX = navRect.left + navRect.width / 2;
    const endCenterY = navRect.top + navRect.height / 2;
    const dx = endCenterX - startCenterX;
    const dy = endCenterY - startCenterY;

    // Slower, graceful parabolic flight curve (1150ms for clear and majestic visibility)
    const animation = ghost.animate([
      {
        transform: 'translate(0px, 0px) scale(1) rotate(0deg)',
        opacity: 1,
        borderRadius: '24px',
        boxShadow: '0 0 60px rgba(16, 185, 129, 0.9), 0 0 120px rgba(52, 211, 153, 0.6)',
      },
      {
        transform: `translate(${dx * 0.25}px, ${dy * 0.1 - 70}px) scale(0.65) rotate(-5deg)`,
        opacity: 0.95,
        borderRadius: '22px',
        boxShadow: '0 0 65px rgba(16, 185, 129, 0.85), 0 0 130px rgba(52, 211, 153, 0.7)',
        offset: 0.28,
      },
      {
        transform: `translate(${dx * 0.65}px, ${dy * 0.5 - 30}px) scale(0.35) rotate(-10deg)`,
        opacity: 0.9,
        borderRadius: '18px',
        boxShadow: '0 0 70px rgba(16, 185, 129, 0.9), 0 0 140px rgba(52, 211, 153, 0.8)',
        offset: 0.68,
      },
      {
        transform: `translate(${dx * 0.92}px, ${dy * 0.88}px) scale(0.12) rotate(-14deg)`,
        opacity: 0.75,
        borderRadius: '12px',
        offset: 0.9,
      },
      {
        transform: `translate(${dx}px, ${dy}px) scale(0.04) rotate(-18deg)`,
        opacity: 0,
        borderRadius: '50%',
        boxShadow: '0 0 80px rgba(52, 211, 153, 1)',
      }
    ], {
      duration: 1150, // Slower, comfortable flight pace
      easing: 'cubic-bezier(0.25, 0.9, 0.25, 1)',
      fill: 'forwards'
    });

    animation.onfinish = () => {
      ghost.remove();
      isFlyingRef.current = false;
      playArrivalChime();
      navEl.classList.add('sidebar-gate-pulse-glow');
      setTimeout(() => {
        navEl.classList.remove('sidebar-gate-pulse-glow');
      }, 1800);
    };
  }, [stopCameras]);

  // ─── HANDLERS FOR EVENTS ───
  const handleVehicleDetected = useCallback((payload) => {
    if (!payload || !payload.licensePlate) return;
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    isFlyingRef.current = false;

    const lane = (payload.mode === 'exit' || payload.gate === 'EXIT_1') ? 'exit' : 'entry';

    setLaneEvents((prev) => {
      const isNew = !prev[lane] || prev[lane].licensePlate !== payload.licensePlate;
      if (isNew) {
        playGateAlertChime();
      }
      return {
        ...prev,
        [lane]: {
          ...payload,
          timestamp: Date.now(),
        },
      };
    });

    startLaneCamera(lane);
  }, [startLaneCamera]);

  const handleVehicleCleared = useCallback((payload) => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);

    const clearedGate = payload?.gate || (payload?.lane === 'exit' ? 'EXIT_1' : payload?.lane === 'entry' ? 'ENTRY_1' : null);
    const clearedLane = clearedGate === 'EXIT_1' ? 'exit' : clearedGate === 'ENTRY_1' ? 'entry' : null;

    setLaneEvents((prev) => {
      const next = { ...prev };
      if (clearedLane) {
        next[clearedLane] = null;
      } else {
        next.entry = null;
        next.exit = null;
      }

      // If BOTH gates do not detect any vehicle, auto-close modal with parabolic flight!
      if (!next.entry && !next.exit) {
        setTimeout(() => triggerFlySequence(), 0);
        return { entry: null, exit: null };
      }
      return next;
    });
  }, [triggerFlySequence]);

  const handleBarrierControl = useCallback((barrierState) => {
    if (!barrierState) return;
    const gate = barrierState.gate || '';
    const closedLane = gate.includes('EXIT') ? 'exit' : 'entry';

    if (barrierState.open === false) {
      closeTimeoutRef.current = setTimeout(() => {
        setLaneEvents((prev) => {
          const next = { ...prev, [closedLane]: null };
          if (!next.entry && !next.exit) {
            setTimeout(() => triggerFlySequence(), 0);
            return { entry: null, exit: null };
          }
          return next;
        });
      }, 550);
    }
  }, [triggerFlySequence]);

  // ─── BROADCAST CHANNEL LISTENER ───
  useEffect(() => {
    if (isOnGatePage) return undefined;

    let ch = null;
    try {
      ch = new BroadcastChannel('valo_gate_channel');
      ch.onmessage = (event) => {
        const { type, payload, barrierState } = event.data || {};
        if (type === 'VEHICLE_DETECTED' && payload) {
          handleVehicleDetected(payload);
        } else if (type === 'VEHICLE_CLEARED') {
          handleVehicleCleared(event.data);
        } else if (type === 'BARRIER_CONTROL' && barrierState) {
          handleBarrierControl(barrierState);
        }
      };
    } catch (_) {}

    return () => {
      if (ch) ch.close();
    };
  }, [isOnGatePage, handleVehicleDetected, handleVehicleCleared, handleBarrierControl]);

  // ─── SOCKET LISTENERS ───
  useEffect(() => {
    if (!socket || isOnGatePage) return;

    const handleSyncedEntry = (payload) => {
      if (!payload || !payload.licensePlate) return;
      const data = payload.verifyData || {};
      handleVehicleDetected({
        gate: 'ENTRY_1',
        mode: 'entry',
        licensePlate: payload.licensePlate,
        vehicleModelInfo: data.vehicleModelInfo || 'Vehicle at Entry Gate',
        registeredOwnerName: data.registeredOwnerName || null,
        phone: data.phone || null,
        assignedSlot: data.assignedSlot || data.originalSlot || 'C1',
        floorName: data.assignedFloorName || 'Floor 1',
        isPreBooked: Boolean(data.hasPreBooking),
        isRegisteredVehicle: Boolean(data.isRegisteredVehicle),
        hasWallet: Boolean(data.hasWallet),
        entryImageBase64: payload.entryImageBase64,
        timestamp: Date.now(),
      });
    };

    socket.on('gate:vehicle_detected', handleVehicleDetected);
    socket.on('kiosk:entry_plate_synced', handleSyncedEntry);
    socket.on('gate:barrier_control', handleBarrierControl);
    socket.on('gate:vehicle_cleared', handleVehicleCleared);

    return () => {
      socket.off('gate:vehicle_detected', handleVehicleDetected);
      socket.off('kiosk:entry_plate_synced', handleSyncedEntry);
      socket.off('gate:barrier_control', handleBarrierControl);
      socket.off('gate:vehicle_cleared', handleVehicleCleared);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, [socket, isOnGatePage, handleVehicleDetected, handleVehicleCleared, handleBarrierControl]);

  // Escape key triggers parabolic fly animation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        triggerFlySequence();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      stopCameras();
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, [triggerFlySequence, stopCameras]);

  // Open in Gate Control with smart dual-lane prefilling
  const handleGoToGate = () => {
    stopCameras();

    const entryEvent = laneEvents.entry;
    const exitEvent = laneEvents.exit;

    const params = new URLSearchParams();

    // If both cars are present, pre-fill BOTH Entry and Exit lanes!
    if (entryEvent && exitEvent) {
      params.set('entryPlate', entryEvent.licensePlate || '');
      if (entryEvent.phone) params.set('entryPhone', entryEvent.phone);
      if (entryEvent.assignedSlot) params.set('entrySlot', entryEvent.assignedSlot);

      params.set('exitPlate', exitEvent.licensePlate || '');
    } else if (entryEvent) {
      params.set('lane', 'entry');
      params.set('plate', entryEvent.licensePlate || '');
      if (entryEvent.phone) params.set('phone', entryEvent.phone);
      if (entryEvent.assignedSlot) params.set('slot', entryEvent.assignedSlot);
    } else if (exitEvent) {
      params.set('lane', 'exit');
      params.set('plate', exitEvent.licensePlate || '');
    }

    setLaneEvents({ entry: null, exit: null });
    navigate(`/staff/gate?${params.toString()}`);
  };

  if (isOnGatePage || !isAnyActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="spotlight-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[999] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        onClick={triggerFlySequence}
      >
        {/* Hidden video elements for hardware camera decoding */}
        <video
          ref={entryVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
        />
        <video
          ref={exitVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
        />

        {/* Spotlight Modal Box */}
        <motion.div
          ref={modalRef}
          key="spotlight-card"
          initial={{ scale: 0.92, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className={`w-full ${
            bothLanesActive ? 'max-w-5xl' : 'max-w-xl'
          } bg-[#0c131f]/95 border border-emerald-500/35 rounded-3xl overflow-hidden relative p-4 sm:p-6 shadow-[0_0_65px_rgba(16,185,129,0.22)] transition-[max-width] duration-300`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button - Clicking triggers the smooth Add-to-Cart fly animation */}
          <button
            onClick={triggerFlySequence}
            className="absolute top-4 right-4 z-30 w-8 h-8 rounded-full bg-black/60 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors border border-white/15"
            title="Dismiss (Esc)"
          >
            <X size={18} />
          </button>

          {/* Dual-lane grid: ONLY renders lanes that actually have a vehicle detected */}
          <motion.div
            layout
            transition={{ layout: { duration: 0.42, ease: [0.16, 1, 0.3, 1] } }}
            className={`grid gap-5 ${
              bothLanesActive ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            <AnimatePresence mode="popLayout">
              {/* ══════════ ENTRY GATE CARD (Only rendered when vehicle detected) ══════════ */}
              {hasEntry && (
                <LaneGateCard
                  key="lane-entry"
                  lane="entry"
                  event={laneEvents.entry}
                  videoRef={entryVideoRef}
                  cameraActive={cameraActive}
                  cameraConfig={cameraConfig}
                  isSingle={!bothLanesActive}
                  onOpenGate={handleGoToGate}
                />
              )}

              {/* ══════════ EXIT GATE CARD (Only rendered when vehicle detected) ══════════ */}
              {hasExit && (
                <LaneGateCard
                  key="lane-exit"
                  lane="exit"
                  event={laneEvents.exit}
                  videoRef={exitVideoRef}
                  cameraActive={cameraActive}
                  cameraConfig={cameraConfig}
                  isSingle={!bothLanesActive}
                  onOpenGate={handleGoToGate}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Single Gate Column Card designed top-to-bottom:
 * 1. Gate Header (Name + Live indicator)
 * 2. Gate Camera Frame (object-contain with zero letterbox cropping)
 * 3. License Plate Badge + Status (VIP, Pre-booked, Registered, Walk-in, Violations)
 * 4. Action Button (Open in Gate Control)
 */
function LaneGateCard({
  lane = 'entry',
  event,
  videoRef,
  cameraActive,
  cameraConfig,
  isSingle = false,
  onOpenGate,
}) {
  const isEntry = lane === 'entry';
  const hasAnomaly = event.hasSession === false || Boolean(event.errorMessage);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.3 } }}
      transition={{ layout: { duration: 0.42, ease: [0.16, 1, 0.3, 1] } }}
      className="flex flex-col justify-between bg-black/40 rounded-2xl border border-white/10 p-4 relative overflow-hidden"
    >
      <div>
        {/* ─── 1. GATE NAME & LIVE TELEMETRY (TOP) ─── */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase flex items-center gap-1.5 ${
                isEntry
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
              {isEntry ? 'ENTRY GATE' : 'EXIT GATE'}
            </span>
            <span className="text-[11px] font-bold text-gray-400 flex items-center gap-1">
              <Radio size={12} className="text-red-400 animate-ping" />
              LIVE CAMERA
            </span>
          </div>

          <span className="text-[11px] font-semibold text-gray-400 truncate max-w-[170px]">
            {event.vehicleModelInfo || (isEntry ? 'Vehicle at Entry Gate' : 'Vehicle at Exit Gate')}
          </span>
        </div>

        {/* ─── 2. CAMERA FRAME AS IN GATE CONTROL (object-contain, no cropping) ─── */}
        <div
          className={`relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-white/15 flex items-center justify-center shadow-inner ${
            isSingle ? 'max-h-[340px]' : 'max-h-[250px]'
          }`}
        >
          {cameraActive ? (
            <LaneCameraPreview
              videoRef={videoRef}
              lane={lane}
              cameraConfig={cameraConfig}
              active={cameraActive}
              className="relative z-10 w-full h-full object-contain bg-black"
            />
          ) : event.exitImageBase64 || event.entryImageBase64 ? (
            <img
              src={event.exitImageBase64 || event.entryImageBase64}
              alt="Vehicle Scan"
              className="relative z-10 w-full h-full object-contain bg-black"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-gray-500">
              <Camera size={38} className="text-emerald-400/50 animate-pulse" />
              <p className="text-xs font-medium text-gray-400">Connecting to gate camera feed...</p>
            </div>
          )}

          {/* Corner HUD reticle */}
          <div className="absolute inset-2.5 pointer-events-none z-20 flex flex-col justify-between">
            <div className="flex justify-between">
              <div className="w-3.5 h-3.5 border-t-2 border-l-2 border-emerald-400/80" />
              <div className="w-3.5 h-3.5 border-t-2 border-r-2 border-emerald-400/80" />
            </div>
            <div className="flex justify-between">
              <div className="w-3.5 h-3.5 border-b-2 border-l-2 border-emerald-400/80" />
              <div className="w-3.5 h-3.5 border-b-2 border-r-2 border-emerald-400/80" />
            </div>
          </div>
        </div>

        {/* ─── 3. LICENSE PLATE + VEHICLE STATUS (BOTTOM) ─── */}
        <div className="mt-3.5 space-y-2.5">
          {/* Authentic Kiosk-style License Plate Badge */}
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-3.5 py-1.5 font-mono font-black text-base sm:text-lg tracking-wider text-slate-950 shadow-[0_4px_16px_rgba(250,204,21,0.3)] border border-amber-300 select-none">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-900/40" />
              <span>{formatVietnamesePlate(event.licensePlate)}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-900/40" />
            </div>

            <div className="flex items-center gap-1.5 bg-emerald-500/15 text-emerald-300 px-2.5 py-1 rounded-lg text-xs font-bold border border-emerald-500/30">
              <ShieldCheck size={14} />
              <span>99.4% AI Match</span>
            </div>
          </div>

          {/* Clean Professional Status (No crown icon) */}
          {isEntry ? (
            /* ENTRY STATUS */
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-gray-400 font-semibold">Status:</span>
                <span className="text-emerald-300 font-bold">
                  {event.isPreBooked
                    ? `VIP Reservation · Slot ${event.assignedSlot || 'C1'} (${event.floorName || 'Floor 1'})`
                    : event.isRegisteredVehicle
                    ? `Registered Vehicle · Slot ${event.assignedSlot || 'C1'}`
                    : `Walk-in Guest · Slot ${event.assignedSlot || 'C1'} (${event.floorName || 'Floor 1'})`}
                </span>
              </div>
              {event.phone && (
                <span className="text-[11px] text-gray-400 font-mono hidden sm:inline">
                  {event.phone}
                </span>
              )}
            </div>
          ) : (
            /* EXIT STATUS */
            hasAnomaly ? (
              <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/35 text-xs text-red-200 flex items-center gap-2">
                <AlertCircle size={16} className="text-red-400 shrink-0" />
                <span className="font-bold">
                  {event.errorMessage || 'No active parking session found for this vehicle.'}
                </span>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <span className="text-gray-400 font-semibold">Duration:</span>
                  <span className="text-white font-bold">{event.parkingDuration || '1 hrs'}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-gray-400 block uppercase">Total Due</span>
                  <span className="text-emerald-400 font-black">
                    {Number(event.amountToPay || 0).toLocaleString('vi-VN')} ₫
                  </span>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* ─── 4. OPEN IN GATE CONTROL BUTTON ─── */}
      <div className="mt-3.5 pt-3 border-t border-white/10">
        <button
          onClick={onOpenGate}
          className="w-full py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-500/20 active:scale-[0.98]"
        >
          <span>Open in Gate Control</span>
          <ExternalLink size={14} />
        </button>
      </div>
    </motion.div>
  );
}
