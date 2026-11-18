import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Camera, Car, ShieldCheck, Sparkles, RefreshCw, CheckCircle2,
  AlertTriangle, ArrowRight, DollarSign, QrCode, Lock, Unlock,
  Pause, PauseCircle, Play, Activity, Radio, Clock, User, Zap, ChevronRight,
  Upload, Eye, AlertCircle, Check, Loader2, Maximize2,
  RotateCw, ArrowLeftRight, ScanLine, SlidersHorizontal, ZoomIn, ZoomOut, X,
  Wallet, Banknote, CreditCard
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { API_BASE, apiFetch } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { useGateCameraConfig } from '../../hooks/useGateCameraConfig';
import { getAllFloors, getFloorSlots } from '../../services/parkingFloorService';
import {
  createBookingHold,
  getActiveHolds,
  getActiveMapBookings,
  releaseBookingHold,
} from '../../services/bookingService';
import { getAllSessions, getActiveSessions } from '../../services/sessionService';
import { normalizeLicensePlate } from '../../utils/licensePlate';
import {
  captureVideoLaneBase64,
  computeLaneFrameSignature,
  cropImageDataUrlForLane,
  hasLaneMotionChanged,
  resolveLaneTransform,
} from '../../utils/cameraLaneCapture';
import LaneCameraPreview from '../../components/LaneCameraPreview';
import AIPlateResolutionModal from './components/AIPlateResolutionModal';
import { STAFF_THEME } from './components/staffTheme';

const normalizeSlotCodeLocal = (code) => String(code || '').replace(/[^A-Z0-9-]/gi, '').trim().toUpperCase();

const formatFloorName = (name) => {
  if (!name) return 'Floor 1';
  const str = String(name).trim();
  return /^(floor|tầng)\b/i.test(str) ? str : `Floor ${str}`;
};

const formatShortCurrency = (val) => {
  const num = Number(val);
  if (isNaN(num)) return '';
  if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}tr`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}k`;
  return `${num}`;
};

const getQuickCashSuggestions = (amount) => {
  const num = Number(amount);
  if (!num || num <= 0) return [];
  const suggestions = [];
  const next50k = Math.ceil(num / 50000) * 50000;
  if (next50k > num) suggestions.push(next50k);

  [100000, 200000, 500000].forEach((bill) => {
    if (bill > num && !suggestions.includes(bill)) {
      suggestions.push(bill);
    }
  });
  return suggestions.slice(0, 3);
};

function classifyFloorSlot(slot, floorId, activeSessions, activeBookings, activeHolds, entryVerifyData) {
  const code = normalizeSlotCodeLocal(slot.slotNumber);
  const floorStr = String(floorId || '');
  const isVipSlot = Boolean(
    slot.subscriptionType || slot.subscriptionDetail || slot.slotType === 'vip' || slot.zoneID?.zoneType === 'vip'
  );
  const isEvSlot = slot.slotType === 'ev';
  const assignedCode = normalizeSlotCodeLocal(entryVerifyData?.assignedSlot);
  const isAssignedMatch = Boolean(
    assignedCode &&
    assignedCode === code &&
    (!entryVerifyData?.assignedFloorId || String(entryVerifyData.assignedFloorId) === floorStr)
  );

  const sessionMatch = activeSessions.find(
    (s) => String(s.floorId?._id || s.floorId || '') === floorStr && normalizeSlotCodeLocal(s.parkingSlot) === code
  );
  const bookingMatch = activeBookings.find(
    (b) => String(b.floorId?._id || b.floorId || '') === floorStr && normalizeSlotCodeLocal(b.parkingSlot) === code
  );
  const holdMatch = activeHolds.find(
    (h) => String(h.floorId?._id || h.floorId || '') === floorStr && normalizeSlotCodeLocal(h.slotCode) === code
  );

  const isPhysicallyOccupied = slot.status === 'occupied' || Boolean(slot.aiObservation?.occupied);
  const hasVipPassOwner = Boolean(slot.subscriptionType || slot.subscriptionDetail);

  let state = 'available';
  let statusLabel = 'Available';
  let detail = slot.zoneID?.zoneName || (isVipSlot ? 'VIP Zone' : isEvSlot ? 'EV Zone' : 'Standard');
  let selectable = true;

  if (slot.status === 'maintenance') {
    state = 'maintenance';
    statusLabel = 'Maintenance';
    detail = 'Unavailable';
    selectable = false;
  } else if (sessionMatch || isPhysicallyOccupied) {
    state = 'occupied';
    statusLabel = 'Occupied';
    detail = sessionMatch?.licensePlate || slot.aiObservation?.detectedPlate || 'Vehicle inside';
    selectable = false;
  } else if (hasVipPassOwner && !isAssignedMatch) {
    state = 'vip_reserved';
    statusLabel = 'VIP Reserved';
    detail = slot.subscriptionDetail?.user?.username || 'Monthly Pass';
    selectable = false;
  } else if (bookingMatch && !isAssignedMatch) {
    state = 'booked';
    statusLabel = 'Booked';
    detail = bookingMatch.licensePlate || 'Pre-booked';
    selectable = false;
  } else if (holdMatch) {
    state = 'held';
    statusLabel = 'On Hold';
    detail = holdMatch.maskedPlate || 'Locked';
    selectable = false;
  } else if (isAssignedMatch) {
    state = 'assigned';
    statusLabel = entryVerifyData?.isMonthly ? 'VIP Match' : entryVerifyData?.isPausedResume ? 'Resumed Spot' : 'Booked Spot';
    detail = entryVerifyData?.isPausedResume ? 'Resumed session spot' : 'Assigned to vehicle';
    selectable = true;
  }

  return {
    id: slot._id || code,
    code,
    rawCode: slot.slotNumber,
    isVipSlot,
    isEvSlot,
    state,
    statusLabel,
    detail,
    selectable,
  };
}

function ViolationStatusRow({ violations, violationDetails, formatCurrency, t }) {
  const pendingCount = Number(violations?.pendingFineCount || 0);
  const totalFine = Number(violations?.totalPendingFine || 0);
  const slotViolations = Array.isArray(violations?.slotViolations) ? violations.slotViolations : [];
  const hasViolation = Boolean(violations?.hasViolations || violationDetails || pendingCount > 0 || slotViolations.length > 0);

  if (!hasViolation) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">
        <CheckCircle2 size={12} className="shrink-0" />
        <span>{t ? t('gateControlUi.violationsClean') : 'No violations detected'}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[10px] text-red-200 space-y-1">
      <div className="flex items-center gap-1.5 font-bold text-red-300">
        <AlertTriangle size={12} className="shrink-0" />
        <span>
          {t('gateControlUi.violationsDetected')}
          {pendingCount > 0 ? ` · ${pendingCount} Pending Fine(s) (${formatCurrency(totalFine)})` : ''}
          {slotViolations.length > 0 ? ` · ${slotViolations.length} Slot Issue(s)` : ''}
        </span>
      </div>
      {violationDetails && (
        <p className="text-red-200/90 leading-snug">{violationDetails}</p>
      )}
      {slotViolations.slice(0, 2).map((sv, idx) => (
        <p key={sv._id || idx} className="text-amber-200/90 leading-snug">
          • {sv.violationMessage || `Wrong-slot alert on plate ${sv.detectedPlate || ''}`}
        </p>
      ))}
    </div>
  );
}

export default function GateControl() {
  const { t } = useTranslation();
  const socket = useSocket();

  // ─── HARDWARE & BARRIER STATE ───
  const [gatesState, setGatesState] = useState({
    ENTRY_1: { open: false, holdOpen: false, gate: 'ENTRY_1', licensePlate: '', timestamp: Date.now() },
    EXIT_1: { open: false, holdOpen: false, gate: 'EXIT_1', licensePlate: '', timestamp: Date.now() }
  });
  const [isEspOnline, setIsEspOnline] = useState(false);
  const [isBridgeRunning, setIsBridgeRunning] = useState(false);
  const [showCameraSetup, setShowCameraSetup] = useState(false);
  const [expandedCamera, setExpandedCamera] = useState(null); // 'entry' | 'exit' | null
  const [modalZoom, setModalZoom] = useState(1);
  const [floors, setFloors] = useState([]);
  const [activeSessionsList, setActiveSessionsList] = useState([]);

  // ─── ENTRY LANE STATE ───
  const [entryPlate, setEntryPlate] = useState('');
  const [entryPhone, setEntryPhone] = useState('');
  const [entryVehicleType, setEntryVehicleType] = useState('car');
  const [entryFloorId, setEntryFloorId] = useState('');
  const [entrySlotCode, setEntrySlotCode] = useState('');
  const [floorSlotsData, setFloorSlotsData] = useState([]);
  const [activeHoldsList, setActiveHoldsList] = useState([]);
  const [activeMapBookings, setActiveMapBookings] = useState([]);
  const [isLoadingFloorSlots, setIsLoadingFloorSlots] = useState(false);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [slotFilterMode, setSlotFilterMode] = useState('available');
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [entryVerifyData, setEntryVerifyData] = useState(null);
  const [isEntryScanning, setIsEntryScanning] = useState(false);
  const [isEntryCheckingIn, setIsEntryCheckingIn] = useState(false);
  const [entryCameraActive, setEntryCameraActive] = useState(true);

  // ─── EXIT LANE STATE ───
  const [exitPlate, setExitPlate] = useState('');
  const [exitSnapshot, setExitSnapshot] = useState(null);
  const [exitInvoiceData, setExitInvoiceData] = useState(null);
  const [exitStatusInfo, setExitStatusInfo] = useState(null);
  const [isExitScanning, setIsExitScanning] = useState(false);
  const [isExitCheckingOut, setIsExitCheckingOut] = useState(false);
  const [exitCameraActive, setExitCameraActive] = useState(true);
  const [cashReceivedAmount, setCashReceivedAmount] = useState('');
  const [depositChangeToWallet, setDepositChangeToWallet] = useState(false);
  const [dismissSameOwnerBooking, setDismissSameOwnerBooking] = useState(false);

  // ─── BARRIER OVERRIDE AUDIT MODAL ───
  const [overrideModal, setOverrideModal] = useState(null); // { action, gate, plate, slot }
  const [overrideReason, setOverrideReason] = useState('OCR_ERROR');
  const [overrideNotes, setOverrideNotes] = useState('');

  // ─── AI RESOLUTION MODAL STATE ───
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiTargetLane, setAiTargetLane] = useState('entry'); // 'entry' | 'exit'
  const [aiModalInitialPlate, setAiModalInitialPlate] = useState('');
  const [aiModalInitialImage, setAiModalInitialImage] = useState(null);

  // ─── REFS CHO WEBCAM ───
  const entryVideoRef = useRef(null);
  const entryCanvasRef = useRef(null);
  const entryStreamRef = useRef(null);

  const exitVideoRef = useRef(null);
  const exitCanvasRef = useRef(null);
  const exitStreamRef = useRef(null);
  const streamPoolRef = useRef({});
  const pendingStreamMapRef = useRef({});

  // ─── 1. FETCH STATUS VÀ SOCKET LẮNG NGHE ───
  const fetchBarrierStatus = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/iot/barrier-status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.success && data.gates) {
        setGatesState(prev => ({ ...prev, ...data.gates }));
        if (data.espStatus) {
          setIsEspOnline(Boolean(data.espStatus.espOnline));
          setIsBridgeRunning(Boolean(data.espStatus.bridgeOnline));
        } else {
          setIsEspOnline(false);
          setIsBridgeRunning(false);
        }
      } else {
        setIsEspOnline(false);
        setIsBridgeRunning(false);
      }
    } catch {
      setIsEspOnline(false);
      setIsBridgeRunning(false);
    }
  }, []);

  const refreshActiveSessions = useCallback(async () => {
    try {
      const res = await getAllSessions({ cache: 'no-store' });
      let list = [];
      if (res?.ok && res.data?.success && Array.isArray(res.data.data)) {
        list = res.data.data;
      } else {
        const fallbackRes = await getActiveSessions();
        if (fallbackRes?.ok && fallbackRes.data?.success && Array.isArray(fallbackRes.data.data)) {
          list = fallbackRes.data.data;
        }
      }

      if (Array.isArray(list)) {
        const active = list.filter((s) => {
          const st = String(s.status || '').toLowerCase();
          return st === 'active' || (!s.checkOutTime && st !== 'completed' && st !== 'cancelled');
        });
        setActiveSessionsList(active);
      }
    } catch (e) {
      console.error('Error refreshing active sessions:', e);
    }
  }, []);

  const fetchFloorsAndSessions = useCallback(async () => {
    try {
      const floorRes = await getAllFloors();
      if (floorRes.ok && floorRes.data?.data) {
        setFloors(floorRes.data.data);
        if (floorRes.data.data.length > 0 && !entryFloorId) {
          setEntryFloorId(floorRes.data.data[0]._id);
        }
      }
    } catch (e) {
      console.error('Error fetching floors:', e);
    }

    await refreshActiveSessions();
  }, [entryFloorId, refreshActiveSessions]);

  const fetchFloorSlotOptions = useCallback(async (targetFloorId) => {
    if (!targetFloorId) {
      setFloorSlotsData([]);
      return;
    }
    setIsLoadingFloorSlots(true);
    try {
      const [slotsRes, holdsRes, bookingsRes] = await Promise.all([
        getFloorSlots(targetFloorId),
        getActiveHolds().catch(() => ({ ok: false })),
        getActiveMapBookings().catch(() => ({ ok: false })),
      ]);
      if (slotsRes?.ok && Array.isArray(slotsRes.data?.data)) {
        setFloorSlotsData(slotsRes.data.data);
      }
      if (holdsRes?.ok && Array.isArray(holdsRes.data?.data)) {
        setActiveHoldsList(holdsRes.data.data);
      }
      if (bookingsRes?.ok && Array.isArray(bookingsRes.data?.data)) {
        setActiveMapBookings(bookingsRes.data.data);
      }
      await refreshActiveSessions();
    } catch (e) {
      console.error('Error fetching floor slots:', e);
    } finally {
      setIsLoadingFloorSlots(false);
    }
  }, [refreshActiveSessions]);

  useEffect(() => {
    if (!entryFloorId) return;
    const timer = setTimeout(() => {
      fetchFloorSlotOptions(entryFloorId);
    }, 0);
    return () => clearTimeout(timer);
  }, [entryFloorId, fetchFloorSlotOptions]);

  useEffect(() => {
    fetchBarrierStatus();
    fetchFloorsAndSessions();
    const interval = setInterval(() => {
      fetchBarrierStatus();
      refreshActiveSessions();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchBarrierStatus, fetchFloorsAndSessions, refreshActiveSessions]);

  useEffect(() => {
    if (!socket) return;
    const handleBarrierControl = (data) => {
      if (data?.gate) {
        const normGate = (data.gate || 'ENTRY_1').toUpperCase();
        setGatesState(prev => ({
          ...prev,
          [normGate]: {
            ...prev[normGate],
            ...data
          }
        }));
      }
    };

    socket.on('gate:barrier_control', handleBarrierControl);
    return () => socket.off('gate:barrier_control', handleBarrierControl);
  }, [socket]);

  // ─── MULTI-CAMERA DEVICE ENUMERATION & SHARED CONFIG ───
  const [availableCameras, setAvailableCameras] = useState([]);
  const [entryDeviceId, setEntryDeviceId] = useState(() => localStorage.getItem('valo_entry_cam') || '');
  const [exitDeviceId, setExitDeviceId] = useState(() => localStorage.getItem('valo_exit_cam') || '');
  const [autoScanDual, setAutoScanDual] = useState(false);
  const { cameraConfig, updateCameraConfig } = useGateCameraConfig();
  const cameraConfigRef = useRef(cameraConfig);
  useEffect(() => {
    cameraConfigRef.current = cameraConfig;
  }, [cameraConfig]);

  const dualLaneSplitMode = cameraConfig.splitMode;
  const entryTransform = resolveLaneTransform('entry', cameraConfig);
  const exitTransform = resolveLaneTransform('exit', cameraConfig);

  const entryMotionSigRef = useRef(null);
  const exitMotionSigRef = useRef(null);
  const lastAutoEntryAtRef = useRef(0);
  const lastAutoExitAtRef = useRef(0);
  const entryScanLockRef = useRef(false);
  const exitScanLockRef = useRef(false);

  const enumerateAllCameras = useCallback(async () => {
    try {
      // Yêu cầu quyền truy cập trước để lấy đầy đủ nhãn thiết bị
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableCameras(videoDevices);

      if (videoDevices.length > 0) {
        if (!entryDeviceId) {
          const firstId = videoDevices[0].deviceId;
          setEntryDeviceId(firstId);
          localStorage.setItem('valo_entry_cam', firstId);
        }
        if (!exitDeviceId) {
          // Nếu có từ 2 camera trở lên, ưu tiên gán camera thứ 2 cho làn ra
          const secondId = videoDevices.length > 1 ? videoDevices[1].deviceId : videoDevices[0].deviceId;
          setExitDeviceId(secondId);
          localStorage.setItem('valo_exit_cam', secondId);
        }
      }
    } catch (e) {
      console.warn('Cannot enumerate cameras:', e);
    }
  }, [entryDeviceId, exitDeviceId]);

  // ─── 2. WEBCAM STREAM CONTROLLERS (DEDUPLICATED STREAM POOL PER DEVICE) ───
  const isStreamInUseByOtherLane = (stream, excludingLane) => {
    if (!stream) return false;
    const other = excludingLane === 'entry' ? exitStreamRef.current : entryStreamRef.current;
    return other === stream;
  };

  const acquireCameraStream = useCallback(async (targetDeviceId = '') => {
    const key = targetDeviceId || '__default__';
    const cached = streamPoolRef.current[key];
    if (cached && cached.active && cached.getVideoTracks().some((t) => t.readyState === 'live')) {
      return cached;
    }

    if (targetDeviceId) {
      const existingMatch = Object.values(streamPoolRef.current).find((s) =>
        s &&
        s.active &&
        s.getVideoTracks().some((t) => t.readyState === 'live' && t.getSettings?.().deviceId === targetDeviceId)
      );
      if (existingMatch) {
        streamPoolRef.current[key] = existingMatch;
        return existingMatch;
      }
    }

    if (pendingStreamMapRef.current[key]) {
      return pendingStreamMapRef.current[key];
    }

    const requestPromise = (async () => {
      const deviceTarget = targetDeviceId ? { deviceId: { exact: targetDeviceId } } : { facingMode: { ideal: 'environment' } };
      const constraintSteps = [
        {
          video: {
            ...deviceTarget,
            width: { min: 960, ideal: 1280 },
            height: { min: 540, ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        },
        {
          video: {
            ...deviceTarget,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        },
        {
          video: {
            ...(targetDeviceId ? { deviceId: { exact: targetDeviceId } } : true),
          },
          audio: false,
        },
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
      if (!stream) throw lastErr || new Error('Unable to access camera stream');

      const track = stream.getVideoTracks?.()[0];
      if (track?.applyConstraints) {
        await track.applyConstraints({ width: 1280, height: 720, aspectRatio: 16 / 9 }).catch(() => {});
      }

      streamPoolRef.current[key] = stream;
      return stream;
    })();

    pendingStreamMapRef.current[key] = requestPromise;
    try {
      return await requestPromise;
    } finally {
      delete pendingStreamMapRef.current[key];
    }
  }, []);

  const startCamera = useCallback(async (lane, deviceId = null) => {
    try {
      const targetDeviceId = deviceId || (lane === 'entry' ? entryDeviceId : exitDeviceId);
      const stream = await acquireCameraStream(targetDeviceId);

      if (lane === 'entry') {
        const prev = entryStreamRef.current;
        entryStreamRef.current = stream;
        if (prev && prev !== stream && !isStreamInUseByOtherLane(prev, 'entry')) {
          prev.getTracks().forEach((t) => t.stop());
        }
        if (entryVideoRef.current) {
          if (entryVideoRef.current.srcObject !== stream) {
            entryVideoRef.current.srcObject = stream;
          }
          await entryVideoRef.current.play().catch(() => {});
        }
        setEntryCameraActive(true);
      } else {
        const prev = exitStreamRef.current;
        exitStreamRef.current = stream;
        if (prev && prev !== stream && !isStreamInUseByOtherLane(prev, 'exit')) {
          prev.getTracks().forEach((t) => t.stop());
        }
        if (exitVideoRef.current) {
          if (exitVideoRef.current.srcObject !== stream) {
            exitVideoRef.current.srcObject = stream;
          }
          await exitVideoRef.current.play().catch(() => {});
        }
        setExitCameraActive(true);
      }
    } catch (err) {
      console.warn(`Camera for ${lane} not available:`, err);
      if (lane === 'entry') setEntryCameraActive(false);
      else setExitCameraActive(false);
    }
  }, [acquireCameraStream, entryDeviceId, exitDeviceId]);

  const stopCamera = (lane) => {
    if (lane === 'entry' && entryStreamRef.current) {
      const prev = entryStreamRef.current;
      if (entryVideoRef.current) entryVideoRef.current.srcObject = null;
      entryStreamRef.current = null;
      if (!isStreamInUseByOtherLane(prev, 'entry')) {
        prev.getTracks().forEach((t) => t.stop());
      }
      setEntryCameraActive(false);
    } else if (lane === 'exit' && exitStreamRef.current) {
      const prev = exitStreamRef.current;
      if (exitVideoRef.current) exitVideoRef.current.srcObject = null;
      exitStreamRef.current = null;
      if (!isStreamInUseByOtherLane(prev, 'exit')) {
        prev.getTracks().forEach((t) => t.stop());
      }
      setExitCameraActive(false);
    }
  };

  useEffect(() => {
    enumerateAllCameras();
  }, [enumerateAllCameras]);

  useEffect(() => {
    startCamera('entry', entryDeviceId);
  }, [entryDeviceId, startCamera]);

  useEffect(() => {
    startCamera('exit', exitDeviceId);
  }, [exitDeviceId, startCamera]);

  useEffect(() => {
    const pool = streamPoolRef.current;
    return () => {
      Object.values(pool).forEach((s) => {
        s?.getTracks?.().forEach((t) => t.stop());
      });
    };
  }, []);

  const captureFrame = (lane) => {
    const video = lane === 'entry' ? entryVideoRef.current : exitVideoRef.current;
    const canvas = lane === 'entry' ? entryCanvasRef.current : exitCanvasRef.current;
    const dataUrl = captureVideoLaneBase64(video, canvas, lane, cameraConfigRef.current);
    if (!dataUrl) return null;

    if (lane === 'entry') setEntrySnapshot(dataUrl);
    else setExitSnapshot(dataUrl);

    return dataUrl;
  };

  // ─── 3. LÀN VÀO (ENTRY ACTIONS) ───
  const handleEntryScanPlate = async (manualImage = null) => {
    if (entryScanLockRef.current) return;
    entryScanLockRef.current = true;
    try {
      const rawImage = manualImage
        ? await cropImageDataUrlForLane(manualImage, 'entry', cameraConfigRef.current)
        : captureFrame('entry');
      if (manualImage) setEntrySnapshot(rawImage);
      const imageToScan = rawImage;
      if (!imageToScan) {
        toast.error('Please enable the camera or upload a photo to scan.');
        return;
      }

      setIsEntryScanning(true);
      try {
        // 1. Run AI OCR plate recognition
        const scanRes = await fetch(`${API_BASE}/ai/scan-plate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          },
          body: JSON.stringify({ image: imageToScan })
        });
        const scanData = await scanRes.json();

        let detectedPlate = '';
        const plateVal = scanData.data?.licensePlate || scanData.data?.plate || scanData.plate || scanData.licensePlate;
        if (scanData.success && plateVal) {
          detectedPlate = normalizeLicensePlate(plateVal);
          setEntryPlate(detectedPlate);
          toast.success(`Detected entry plate: ${detectedPlate}`);
        } else {
          toast.error('Plate unclear. Enter manually or use AI Plate Assistant.');
        }

        if (detectedPlate) {
          await verifyEntryPlate(detectedPlate, imageToScan);
        }
      } catch (err) {
        console.error('Scan plate error:', err);
        toast.error('Failed to scan license plate.');
      } finally {
        setIsEntryScanning(false);
      }
    } finally {
      entryScanLockRef.current = false;
    }
  };

  const emitKioskEntrySync = (payload) => {
    if (!payload?.licensePlate) return;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel('valo_kiosk_entry_sync');
        ch.postMessage(payload);
        ch.close();
      } catch {
        // Ignore broadcast error
      }
    }

    const token = localStorage.getItem('accessToken');
    fetch(`${API_BASE}/iot/kiosk-entry-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  };

  const syncVipOrBookingToEntryKiosk = (licensePlate, verifyData, imageBase64 = null) => {
    if (!verifyData || verifyData.isActive) return;
    if (!(verifyData.isMonthly || verifyData.hasPreBooking || verifyData.isVIP)) return;

    emitKioskEntrySync({
      mode: 'verified',
      licensePlate,
      verifyData,
      entryImageBase64: imageBase64 || null,
    });
  };

  const verifyEntryPlate = async (plateToCheck, imageOverride = null, isSilent = false, phoneToCheck = null) => {
    const cleanPlate = normalizeLicensePlate(plateToCheck || entryPlate);
    if (!cleanPlate) return;

    try {
      const activePhone = phoneToCheck !== null ? phoneToCheck : entryPhone;
      const res = await fetch(`${API_BASE}/sessions/verify-plate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({
          licensePlate: cleanPlate,
          phone: activePhone || undefined,
        })
      });
      const data = await res.json();
      if (data.success && data.data) {
        const v = data.data;
        setEntryVerifyData(v);
        const resolvedPhone = v.phone || v.registeredVehicleInfo?.phone || '';
        if (resolvedPhone) setEntryPhone(resolvedPhone);
        if (v.assignedSlot) setEntrySlotCode(v.assignedSlot);
        if (v.assignedFloorId) setEntryFloorId(v.assignedFloorId);

        if (!v.isActive && (v.isMonthly || v.hasPreBooking || v.isVIP)) {
          syncVipOrBookingToEntryKiosk(cleanPlate, v, imageOverride || entrySnapshot);
        }

        if (v.isActive) {
          toast.error('Warning: Vehicle already has an active session in the lot.');
        } else if (v.isPausedResume) {
          if (v.slotAutoReallocated) {
            toast.success(`Paused booking resumed! Replacement slot ${v.assignedSlot} auto-assigned (${v.remainingHours || 0}h ${v.remainingMinutes || 0}m left).`);
          } else {
            toast.success(`Paused booking resumed! Slot ${v.assignedSlot} retained (${v.remainingHours || 0}h ${v.remainingMinutes || 0}m left).`);
          }
        } else if (v.isMonthly) {
          toast.success(`VIP Member (${v.membershipType || 'Monthly Pass'}) verified — synced to Entry Kiosk.`);
        } else if (v.hasPreBooking) {
          toast.success(`Pre-booking found (Slot: ${v.assignedSlot || 'Reallocate'}) — synced to Entry Kiosk.`);
        } else if (v.isVIP) {
          toast.success('VIP Member verified — synced to Entry Kiosk.');
        } else if (!isSilent) {
          toast('Valid walk-in vehicle (No booking). Ready to assign slot.');
        }
      }
    } catch (e) {
      console.error('Verify plate error:', e);
    }
  };

  const handleEntryCheckIn = async (overridePlate = null, overrideVerify = null) => {
    const plate = overridePlate || normalizeLicensePlate(entryPlate);
    let verify = overrideVerify || entryVerifyData;

    if (!plate) {
      toast.error('Please enter or scan the entry license plate.');
      return;
    }

    const targetFloorId = entryFloorId || verify?.assignedFloorId || (floors[0]?._id) || '';
    const targetSlotCode = (entrySlotCode || verify?.assignedSlot || '').trim().toUpperCase();

    if (!targetSlotCode) {
      toast.error('Please select an available parking slot before check-in.');
      setSlotPickerOpen(true);
      if (targetFloorId) fetchFloorSlotOptions(targetFloorId);
      return;
    }

    setIsEntryCheckingIn(true);
    let acquiredHoldId = null;

    const acquireSlotHold = async (bookingSource = 'KIOSK_WALK_IN', reallocateBookingId = null) => {
      const now = new Date();
      const end = new Date(now.getTime() + 60 * 60 * 1000);
      const holdRes = await createBookingHold(
        {
          floorId: targetFloorId,
          slotCode: targetSlotCode,
          licensePlate: plate,
          startTime: now.toISOString(),
          endTime: end.toISOString(),
          bookingSource,
          ...(reallocateBookingId ? { reallocateBookingId } : {}),
        },
        { anonymous: true }
      );
      if (!holdRes?.ok || !holdRes?.data?.data?._id) {
        throw new Error(holdRes?.data?.message || 'Unable to lock this slot temporarily for check-in.');
      }
      return holdRes.data.data._id;
    };

    const callKioskEntry = async (holdId) => {
      const res = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          'Idempotency-Key': `staff-entry:${plate}:${Date.now()}`,
        },
        body: JSON.stringify({
          licensePlate: plate,
          phone: entryPhone || verify?.phone || '',
          vehicleType: entryVehicleType,
          parkingSlot: targetSlotCode,
          floorId: targetFloorId,
          durationHours: 2,
          entryImageBase64: entrySnapshot || null,
          entryCamera: 'CAM_GATE_ENTRY_01',
          entryGate: 'ENTRY_1',
          ...(holdId ? { bookingHoldId: holdId } : {}),
          ...(verify?.bookingId ? { bookingId: verify.bookingId } : {}),
          ...(verify?.slotAutoReallocated ? { isAutoReallocated: true } : {}),
        })
      });
      return res.json();
    };

    try {
      if (!verify) {
        try {
          const vRes = await fetch(`${API_BASE}/sessions/verify-plate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
            },
            body: JSON.stringify({ licensePlate: plate }),
          });
          const vData = await vRes.json();
          if (vData?.success && vData?.data) {
            verify = vData.data;
            setEntryVerifyData(verify);
            if (verify.isActive) {
              toast.error('Warning: Vehicle already has an active session in the lot.');
              return;
            }
          }
        } catch {
          // Proceed with direct check-in flow if pre-verify lookup fails transiently
        }
      }

      const hasDirectAssignedAccess = Boolean(
        (verify?.hasPreBooking && !verify?.requiresSlotReallocation && !verify?.tooEarly) ||
        (verify?.isMonthly && !verify?.quotaExhausted)
      );

      if (!hasDirectAssignedAccess && targetFloorId) {
        const source = verify?.requiresSlotReallocation ? 'KIOSK_REALLOCATION' : 'KIOSK_WALK_IN';
        acquiredHoldId = await acquireSlotHold(
          source,
          verify?.requiresSlotReallocation ? verify?.bookingId : null
        );
      }

      let data = await callKioskEntry(acquiredHoldId);

      if (!data.success && data.code === 'HOLD_REQUIRED' && !acquiredHoldId && targetFloorId) {
        const source = verify?.requiresSlotReallocation ? 'KIOSK_REALLOCATION' : 'KIOSK_WALK_IN';
        acquiredHoldId = await acquireSlotHold(
          source,
          verify?.requiresSlotReallocation ? verify?.bookingId : null
        );
        data = await callKioskEntry(acquiredHoldId);
      }

      if (!data.success && data.code === 'BOOKING_NOT_AVAILABLE' && targetFloorId && targetSlotCode) {
        if (!acquiredHoldId) {
          acquiredHoldId = await acquireSlotHold('KIOSK_WALK_IN', null);
        }
        const retryRes = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
            'Idempotency-Key': `staff-entry-walkin:${plate}:${Date.now()}`,
          },
          body: JSON.stringify({
            licensePlate: plate,
            phone: entryPhone || verify?.phone || '',
            vehicleType: entryVehicleType,
            parkingSlot: targetSlotCode,
            floorId: targetFloorId,
            durationHours: 2,
            entryImageBase64: entrySnapshot || null,
            entryCamera: 'CAM_GATE_ENTRY_01',
            entryGate: 'ENTRY_1',
            ...(acquiredHoldId ? { bookingHoldId: acquiredHoldId } : {}),
          })
        });
        data = await retryRes.json();
      }

      if (data.success) {
        toast.success(`Checked in ${plate} at Slot ${targetSlotCode}. Opening entry barrier...`);
        if (data.data) {
          emitKioskEntrySync({
            mode: 'checked_in',
            licensePlate: plate,
            session: {
              ...data.data,
              pass: data.pass || null,
              vipRedirected: data.vipRedirected,
              originalVipSlot: data.originalVipSlot,
              bookingSlotReallocated: data.bookingSlotReallocated,
              originalBookingSlot: data.originalBookingSlot,
            },
            entryImageBase64: entrySnapshot || null,
          });
        }
        await triggerBarrier('open', 'ENTRY_1', plate, targetSlotCode);
        setEntryPlate('');
        setEntryPhone('');
        setEntrySlotCode('');
        setEntryVerifyData(null);
        setEntrySnapshot(null);
        setSlotPickerOpen(false);
        fetchFloorsAndSessions();
        if (targetFloorId) fetchFloorSlotOptions(targetFloorId);
      } else {
        if (acquiredHoldId) {
          await releaseBookingHold(acquiredHoldId, {
            licensePlate: plate,
            floorId: targetFloorId,
            slotCode: targetSlotCode,
          }).catch(() => null);
        }
        toast.error(data.message || 'Check-in failed.');
      }
    } catch (err) {
      if (acquiredHoldId) {
        await releaseBookingHold(acquiredHoldId, {
          licensePlate: plate,
          floorId: targetFloorId,
          slotCode: targetSlotCode,
        }).catch(() => null);
      }
      console.error('Check-in error:', err);
      toast.error(err?.message || 'Server error during check-in.');
    } finally {
      setIsEntryCheckingIn(false);
    }
  };

  // ─── 4. LÀN RA (EXIT ACTIONS) ───
  const handleExitScanPlate = async (manualImage = null) => {
    if (exitScanLockRef.current) return;
    exitScanLockRef.current = true;
    try {
      const rawImage = manualImage
        ? await cropImageDataUrlForLane(manualImage, 'exit', cameraConfigRef.current)
        : captureFrame('exit');
      if (manualImage) setExitSnapshot(rawImage);
      const imageToScan = rawImage;
      if (!imageToScan) {
        toast.error('Please enable the camera or upload a photo.');
        return;
      }

      setIsExitScanning(true);
      try {
        const scanRes = await fetch(`${API_BASE}/ai/scan-plate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageToScan })
        });
        const scanData = await scanRes.json();

        let detectedPlate = '';
        const plateVal = scanData.data?.licensePlate || scanData.data?.plate || scanData.plate || scanData.licensePlate;
        if (scanData.success && plateVal) {
          detectedPlate = normalizeLicensePlate(plateVal);
          setExitPlate(detectedPlate);
          toast.success(`Detected exit plate: ${detectedPlate}`);
        } else {
          toast.error('Exit plate unclear. Enter manually or use AI Plate Assistant.');
        }

        if (detectedPlate) {
          await lookupExitSession(detectedPlate, imageToScan);
        }
      } catch (err) {
        console.error('Exit scan plate error:', err);
        toast.error('Failed to scan exit license plate.');
      } finally {
        setIsExitScanning(false);
      }
    } finally {
      exitScanLockRef.current = false;
    }
  };

  const handleDualScanBothLanes = async () => {
    setEntrySnapshot(null);
    setExitSnapshot(null);
    await Promise.allSettled([handleEntryScanPlate(), handleExitScanPlate()]);
  };

  const handleScanBothRef = useRef({ entry: null, exit: null });
  useEffect(() => {
    handleScanBothRef.current = {
      entry: handleEntryScanPlate,
      exit: handleExitScanPlate,
    };
  });

  useEffect(() => {
    if (!autoScanDual) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      const tasks = [];

      const entryVideo = entryVideoRef.current;
      if (
        entryVideo &&
        entryVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !entryScanLockRef.current &&
        now - lastAutoEntryAtRef.current >= 3500
      ) {
        const sig = computeLaneFrameSignature(entryVideo, 'entry', cameraConfigRef.current);
        if (!entryMotionSigRef.current || hasLaneMotionChanged(entryMotionSigRef.current, sig)) {
          entryMotionSigRef.current = sig;
          lastAutoEntryAtRef.current = now;
          tasks.push(handleScanBothRef.current.entry?.());
        }
      }

      const exitVideo = exitVideoRef.current;
      if (
        exitVideo &&
        exitVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !exitScanLockRef.current &&
        now - lastAutoExitAtRef.current >= 3500
      ) {
        const sig = computeLaneFrameSignature(exitVideo, 'exit', cameraConfigRef.current);
        if (!exitMotionSigRef.current || hasLaneMotionChanged(exitMotionSigRef.current, sig)) {
          exitMotionSigRef.current = sig;
          lastAutoExitAtRef.current = now;
          tasks.push(handleScanBothRef.current.exit?.());
        }
      }

      if (tasks.length > 0) {
        Promise.allSettled(tasks);
      }
    }, 900);

    return () => clearInterval(timer);
  }, [autoScanDual]);

  const lookupExitSession = async (plateToLookup, imageOverride = null) => {
    const cleanPlate = normalizeLicensePlate(plateToLookup || exitPlate);
    if (!cleanPlate) return;

    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': `staff-exit-scan:${cleanPlate}`,
        },
        body: JSON.stringify({ licensePlate: cleanPlate, exitImageBase64: imageOverride || exitSnapshot || null })
      });
      const data = await res.json();
      if (data.success) {
        const invoice = data.data || data;
        setExitInvoiceData({
          ...invoice,
          checkoutToken: invoice.checkoutToken || data.checkoutToken || null,
          totalAmount: Number(invoice.amountToPay || 0),
          parkingFee: Number(invoice.totalPrice || 0),
        });
        setExitStatusInfo({
          found: true,
          licensePlate: cleanPlate,
          sessionType: invoice.session?.type || 'WALK_IN',
          bookingId: invoice.session?.bookingId || null,
          parkingSlot: invoice.session?.parkingSlot || null,
          violationDetails: invoice.violationDetails || null,
          violations: invoice.violations || null,
        });
        setCashReceivedAmount('');
        toast.success(`Found active session for ${cleanPlate}.`);
      } else {
        setExitInvoiceData(null);
        const errorText = res.status === 404
          ? `No active parking session found for ${cleanPlate}.`
          : data.code === 'EXIT_PLATE_MISMATCH'
            ? `Exit plate does not match active session for ${cleanPlate}.`
            : (data.message || 'No active parking session found.');
        setExitStatusInfo({
          found: false,
          licensePlate: cleanPlate,
          code: data.code || (res.status === 404 ? 'NOT_FOUND' : 'ERROR'),
          message: errorText,
          violations: data.violations || null,
        });
        toast.error(errorText);
      }
    } catch (e) {
      console.error('Lookup exit session error:', e);
      toast.error('Failed to look up parking session.');
    }
  };

  // Auto-verify entry plate on typing (debounced)
  useEffect(() => {
    setDismissSameOwnerBooking(false);
    const clean = normalizeLicensePlate(entryPlate);
    if (!clean || clean.length < 5) {
      if (!clean) {
        setEntryVerifyData(null);
        setEntryPhone('');
      }
      return;
    }
    const timer = setTimeout(() => {
      verifyEntryPlate(clean, null, true);
    }, 400);
    return () => clearTimeout(timer);
  }, [entryPlate]);

  // Auto-lookup exit session on typing (debounced)
  useEffect(() => {
    const clean = normalizeLicensePlate(exitPlate);
    if (!clean || clean.length < 5) {
      if (!clean) {
        setExitInvoiceData(null);
        setExitStatusInfo(null);
      }
      return;
    }
    const timer = setTimeout(() => {
      lookupExitSession(clean);
    }, 450);
    return () => clearTimeout(timer);
  }, [exitPlate]);

  // Read query parameters from URL (e.g. from Realtime Gate Spotlight Modal)
  const [searchParams] = useSearchParams();
  const searchHandledRef = useRef('');

  useEffect(() => {
    const lane = searchParams.get('lane');
    const plate = searchParams.get('plate');
    const phone = searchParams.get('phone');
    const slot = searchParams.get('slot');

    const multiEntryPlate = searchParams.get('entryPlate') || (lane === 'entry' ? plate : null);
    const multiExitPlate = searchParams.get('exitPlate') || (lane === 'exit' ? plate : null);
    const entryPhoneParam = searchParams.get('entryPhone') || (lane === 'entry' ? phone : null);
    const entrySlotParam = searchParams.get('entrySlot') || (lane === 'entry' ? slot : null);

    const key = `${multiEntryPlate || ''}_${multiExitPlate || ''}`;
    if (!key || key === '_' || searchHandledRef.current === key) return;
    searchHandledRef.current = key;

    // 1. Pre-fill & verify Entry lane if present
    if (multiEntryPlate) {
      const cleanEntry = normalizeLicensePlate(multiEntryPlate);
      if (cleanEntry) {
        setEntryPlate(cleanEntry);
        if (entryPhoneParam) setEntryPhone(entryPhoneParam);
        if (entrySlotParam) setEntrySlotCode(entrySlotParam);
        verifyEntryPlate(cleanEntry, null, false, entryPhoneParam || null);
      }
    }

    // 2. Pre-fill & look up Exit lane if present
    if (multiExitPlate) {
      const cleanExit = normalizeLicensePlate(multiExitPlate);
      if (cleanExit) {
        setExitPlate(cleanExit);
        lookupExitSession(cleanExit);
      }
    }
  }, [searchParams]);

  const handleExitCheckOut = async (overrideInvoice = null, keepPausedChoice = false, paymentMethodChoice = null) => {
    const inv = overrideInvoice || exitInvoiceData;
    if (!inv || !inv.session) {
      toast.error('No active parking session selected for check-out.');
      return;
    }

    const dueAmount = Number(inv.totalAmount || 0);
    const chosenMethod = paymentMethodChoice || (cashReceivedAmount ? 'cash' : dueAmount === 0 ? 'cash' : (inv.canAutoPay ? 'wallet' : 'vietqr'));
    const isCash = chosenMethod === 'cash';
    const isWallet = chosenMethod === 'wallet';

    if (isCash && dueAmount > 0 && Number(cashReceivedAmount) < dueAmount) {
      toast.error(`Please collect at least ${formatCurrency(dueAmount)} in cash.`);
      return;
    }

    setIsExitCheckingOut(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/sessions/kiosk-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': `staff-checkout:${inv.session._id}:${chosenMethod}:${cashReceivedAmount || 'auto'}:${keepPausedChoice ? 'paused' : 'ended'}`,
        },
        body: JSON.stringify({
          sessionId: inv.session._id,
          exitImageBase64: exitSnapshot || null,
          paymentMethod: chosenMethod,
          cashReceivedAmount: isCash && dueAmount > 0 ? Number(cashReceivedAmount) : null,
          depositChangeToWallet: isCash && depositChangeToWallet,
          checkoutToken: inv.checkoutToken || null,
          exitCamera: 'CAM_GATE_EXIT_01',
          exitGate: 'EXIT_1',
          keepPaused: keepPausedChoice,
        })
      });
      const data = await res.json();
      if (data.success) {
        const changeMessage = data.data?.depositChangeToWallet
          ? ` Deposited ${formatCurrency(data.data.changeDepositedAmount)} change into customer's Valo Wallet.`
          : data.data?.changeAmount != null
            ? ` Change: ${formatCurrency(data.data.changeAmount)}.`
            : '';
        const paymentMethodNote = isWallet ? ' (Paid via Valo Wallet)' : '';
        if (keepPausedChoice) {
          toast.success(`Session PAUSED for ${inv.session.licensePlate}. Slot ${inv.session.parkingSlot} retained!${paymentMethodNote}${changeMessage} Opening exit barrier...`);
        } else {
          toast.success(`Checked out ${inv.session.licensePlate}.${paymentMethodNote}${changeMessage} Opening exit barrier...`);
        }
        await triggerBarrier('open', 'EXIT_1', inv.session.licensePlate, '', 'CHECKOUT_SUCCESS', 'Checkout completed');
        setExitPlate('');
        setExitInvoiceData(null);
        setExitStatusInfo(null);
        setExitSnapshot(null);
        setCashReceivedAmount('');
        setDepositChangeToWallet(false);
        fetchFloorsAndSessions();
      } else {
        toast.error(data.message || 'Check-out failed.');
      }
    } catch (err) {
      console.error('Check-out error:', err);
      toast.error('Server error during check-out.');
    } finally {
      setIsExitCheckingOut(false);
    }
  };

  // ─── 5. BARRIER DIRECT CONTROLS ───
  const triggerBarrier = async (action, gate = 'ENTRY_1', plate = '', slot = '', reason = '', notes = '') => {
    try {
      let endpoint = '/iot/open-barrier';
      let payload = {
        gate,
        licensePlate: plate || 'STAFF-OVERRIDE',
        slotCode: slot,
        reason: reason || undefined,
        notes: notes || undefined,
      };

      if (action === 'hold') {
        endpoint = '/iot/hold-barrier';
        payload = {
          gate,
          hold: !gatesState[gate]?.holdOpen,
          reason: reason || undefined,
          notes: notes || undefined,
        };
      } else if (action === 'close') {
        endpoint = '/iot/close-barrier';
        payload = { gate };
      }

      const token = localStorage.getItem('accessToken');
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload)
      });
      if (res.ok && res.data?.success) {
        toast.success(`Barrier ${action.toUpperCase()} command sent to ${gate}.`);
        fetchBarrierStatus();
      } else {
        toast.error(res.data?.message || `Failed to control barrier ${gate}.`);
      }
    } catch (e) {
      console.error('Barrier command error:', e);
      toast.error(`Failed to control barrier ${gate}.`);
    }
  };

  // ─── 6. AI MODAL SELECTION CALLBACK ───
  const handleSelectAiPlate = (selectedPlate) => {
    setShowAiModal(false);
    if (aiTargetLane === 'entry') {
      setEntryPlate(selectedPlate);
      verifyEntryPlate(selectedPlate);
    } else {
      setExitPlate(selectedPlate);
      lookupExitSession(selectedPlate);
    }
    toast.success(`Selected plate from AI Assistant: ${selectedPlate}`);
  };

  // Format Helpers
  const formatCurrency = (val) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(val || 0));
  const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');

  return (
    <div className={`p-4 sm:p-6 lg:p-8 ${STAFF_THEME.page}`}>
      <Toaster position="top-right" />

      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER & STREAMLINED TOOLBAR
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-6 flex flex-col gap-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-tight text-[#ffd555]">
                {t('gateControlUi.title')}
              </h1>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                {t('gateControlUi.live')}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium text-white/45">
              {t('gateControlUi.subtitle')}
            </p>
          </div>

          {/* Primary Operational Bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* ESP32 Bridge Status */}
            <div
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#111111] px-3 py-2"
              title={
                isEspOnline
                  ? 'ESP32 hardware connected via USB Serial bridge'
                  : isBridgeRunning
                    ? 'Python bridge is running without physical ESP32 plugged in (Simulation mode)'
                    : 'ESP32 hardware and Python bridge are disconnected'
              }
            >
              <Radio
                size={14}
                className={
                  isEspOnline
                    ? 'text-emerald-400 animate-pulse'
                    : isBridgeRunning
                      ? 'text-amber-400'
                      : 'text-red-400'
                }
              />
              <div className="leading-tight">
                <p className="text-[9px] font-black uppercase tracking-wider text-white/40">{t('gateControlUi.espBridge')}</p>
                <p
                  className={`text-[11px] font-bold ${
                    isEspOnline
                      ? 'text-emerald-300'
                      : isBridgeRunning
                        ? 'text-amber-300'
                        : 'text-red-300'
                  }`}
                >
                  {isEspOnline ? t('gateControlUi.online') : isBridgeRunning ? t('gateControlUi.offlineSim') : t('gateControlUi.offline')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDualScanBothLanes}
              disabled={isEntryScanning || isExitScanning}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3.5 py-2 font-bold text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 transition"
            >
              <ScanLine size={14} />
              <span>{t('gateControlUi.scanBothLanes')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !autoScanDual;
                setAutoScanDual(next);
                toast(next ? t('gateControlUi.autoScanEnabled') : t('gateControlUi.autoScanDisabled'));
              }}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 font-bold text-xs transition ${autoScanDual
                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                : 'border-white/10 bg-[#111111] text-white/65 hover:text-white'
                }`}
            >
              <Activity size={14} />
              <span>{t('gateControlUi.autoScan', { state: autoScanDual ? t('gateControlUi.on') : t('gateControlUi.off') })}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCameraSetup(prev => !prev)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 font-bold text-xs transition ${showCameraSetup || dualLaneSplitMode
                ? 'border-sky-400/45 bg-sky-500/15 text-sky-300'
                : 'border-white/10 bg-[#111111] text-white/65 hover:text-white'
                }`}
              title={t('gateControlUi.cameraSetupTitle')}
            >
              <SlidersHorizontal size={14} />
              <span>{t('gateControlUi.cameraSetup')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerBarrier('open', 'ENTRY_1', 'EMERGENCY_OPEN');
                triggerBarrier('open', 'EXIT_1', 'EMERGENCY_OPEN');
                toast.success(t('gateControlUi.emergencySent'));
              }}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2 font-bold text-xs text-red-300 hover:bg-red-500 hover:text-white transition"
            >
              <AlertTriangle size={14} />
              <span>{t('gateControlUi.emergencyOpen')}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Camera Calibration Drawer (Synced across Gate Control & Kiosks) */}
        {showCameraSetup && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-white/10 bg-[#111111] px-3.5 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/45">
              {t('gateControlUi.cameraCalibration')}
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const next = !cameraConfig.splitMode;
                  await updateCameraConfig({ splitMode: next });
                  toast(next
                    ? 'Split 1 Camera ON: Dividing 1 camera frame into Entry & Exit halves.'
                    : 'Split 1 Camera OFF: Each station uses its full camera frame.');
                }}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-bold text-xs transition ${dualLaneSplitMode
                  ? 'border-sky-400/50 bg-sky-500/15 text-sky-300'
                  : 'border-white/15 bg-black/50 text-white/70 hover:text-white'
                  }`}
                title="ON = split 1 shared camera into left/right halves for Entry & Exit; OFF = full frame per station"
              >
                <Camera size={13} />
                <span>{t('gateControlUi.splitCamera', { state: dualLaneSplitMode ? t('gateControlUi.on') : t('gateControlUi.off') })}</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (dualLaneSplitMode) {
                    const updated = await updateCameraConfig((c) => ({
                      swapLanes: !c.swapLanes,
                      entryRotation: c.exitRotation,
                      exitRotation: c.entryRotation,
                      entryRotate180: Number(c.exitRotation) === 180,
                      exitRotate180: Number(c.entryRotation) === 180,
                    }));
                    toast.success(
                      updated.swapLanes
                        ? `Swapped feeds & angles: Entry Left (${updated.entryRotation}°), Exit Right (${updated.exitRotation}°).`
                        : `Swapped feeds & angles: Entry Right (${updated.entryRotation}°), Exit Left (${updated.exitRotation}°).`
                    );
                  } else {
                    const prevEntry = entryDeviceId;
                    const prevExit = exitDeviceId;
                    if (prevEntry !== prevExit) {
                      setEntryDeviceId(prevExit);
                      setExitDeviceId(prevEntry);
                      localStorage.setItem('valo_entry_cam', prevExit);
                      localStorage.setItem('valo_exit_cam', prevEntry);
                    }
                    const updated = await updateCameraConfig((c) => ({
                      entryRotation: c.exitRotation,
                      exitRotation: c.entryRotation,
                      entryRotate180: Number(c.exitRotation) === 180,
                      exitRotate180: Number(c.entryRotation) === 180,
                    }));
                    toast.success(
                      prevEntry !== prevExit
                        ? `Swapped cameras & angles (Entry ${updated.entryRotation}°, Exit ${updated.exitRotation}°).`
                        : `Swapped lane rotation angles (Entry ${updated.entryRotation}°, Exit ${updated.exitRotation}°).`
                    );
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/50 px-3 py-1.5 font-bold text-xs text-white/80 hover:border-sky-400/50 hover:text-sky-300 transition"
                title="Swap camera feeds and rotation angles between Entry and Exit stations"
              >
                <ArrowLeftRight size={13} />
                <span>{t('gateControlUi.swapCamera')}</span>
              </button>

              {dualLaneSplitMode && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      const steps = [0, 0.08, 0.15];
                      const cur = Number(cameraConfig.laneOverlap ?? 0.08);
                      const idx = steps.findIndex((s) => Math.abs(s - cur) < 0.02);
                      const nextOverlap = steps[(idx + 1) % steps.length];
                      await updateCameraConfig({ laneOverlap: nextOverlap });
                      toast.success(`Lane crop width: ${Math.round((0.5 + nextOverlap) * 100)}% of frame.`);
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-sky-400/35 bg-sky-500/10 px-3 py-1.5 font-bold text-xs text-sky-200 hover:bg-sky-500/20 transition"
                    title="Expand each lane sideways toward the center (50% = exact half, 65% = wider angle)"
                  >
                    <Maximize2 size={13} />
                    <span>Lane Width: {Math.round((0.5 + Number(cameraConfig.laneOverlap ?? 0.08)) * 100)}%</span>
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      const ratios = [0.45, 0.5, 0.55];
                      const cur = Number(cameraConfig.splitRatio ?? 0.5);
                      const idx = ratios.findIndex((r) => Math.abs(r - cur) < 0.02);
                      const nextRatio = ratios[(idx + 1) % ratios.length];
                      await updateCameraConfig({ splitRatio: nextRatio });
                      toast.success(`Split boundary: ${Math.round(nextRatio * 100)}% / ${Math.round((1 - nextRatio) * 100)}%.`);
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/50 px-3 py-1.5 font-bold text-xs text-white/75 hover:border-white/30 hover:text-white transition"
                    title="Shift the left/right dividing line when the webcam is placed slightly off-center"
                  >
                    <span>Center Split: {Math.round(Number(cameraConfig.splitRatio ?? 0.5) * 100)}/{Math.round((1 - Number(cameraConfig.splitRatio ?? 0.5)) * 100)}</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={async () => {
                  await updateCameraConfig((c) => ({
                    swapLanes: c.splitMode ? !c.swapLanes : c.swapLanes,
                    splitRatio: c.splitMode ? Math.round((1 - Number(c.splitRatio ?? 0.5)) * 100) / 100 : c.splitRatio,
                    entryRotation: (Number(c.entryRotation || 0) + 180) % 360,
                    exitRotation: (Number(c.exitRotation || 0) + 180) % 360,
                  }));
                  toast.success('Flipped all cameras 180° and synced to Kiosks.');
                }}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/50 px-3 py-1.5 font-bold text-xs text-white/80 hover:border-[#ffd555]/50 hover:text-[#ffd555] transition"
                title="Invert all cameras 180° when mounted upside down"
              >
                <RotateCw size={13} />
                <span>{t('gateControlUi.flipAll')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          DUAL-LANE SPLIT SCREEN (ENTRY & EXIT STATIONS)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* ──────────────────────────────────────────────────────────────────
            LEFT COLUMN: ENTRY STATION (ENTRY_1)
        ────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col rounded-2xl border border-emerald-500/20 bg-[#111111] p-4 shadow-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute -top-12 -left-12 h-36 w-36 rounded-full bg-emerald-500/10 blur-3xl" />

          {/* Lane Header */}
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Car size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <span>{t('gateControlUi.entryGate')}</span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30">ENTRY_1</span>
                </h2>
                <p className="text-[11px] text-white/45 truncate">{t('gateControlUi.entrySubtitle')}</p>
              </div>
            </div>

            {/* Barrier status & lane rotate button */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const updated = await updateCameraConfig((c) => ({
                    entryRotation: (Number(c.entryRotation || 0) + 90) % 360,
                  }));
                  toast.success(`Entry camera rotated to ${updated.entryRotation}°.`);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase border transition ${entryTransform.rotation !== 0
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  : 'bg-white/5 text-white/70 border-white/15 hover:text-white'
                  }`}
                title="Rotate Entry camera in 90° steps (0° → 90° → 180° → 270°)"
              >
                <RotateCw size={11} />
                <span>{entryTransform.rotation}°</span>
              </button>
              <span className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase border whitespace-nowrap ${gatesState.ENTRY_1?.open
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-red-500/20 text-red-300 border-red-500/40'
                }`}>
                {gatesState.ENTRY_1?.open ? <Unlock size={11} /> : <Lock size={11} />}
                {gatesState.ENTRY_1?.open ? t('gateControlUi.barrierOpen') : t('gateControlUi.barrierClosed')}
              </span>
            </div>
          </div>

          {/* Live Camera Feed or Snapshot Preview */}
          <div className="overflow-hidden rounded-xl border border-white/15 bg-black">
            <div className="relative w-full overflow-hidden bg-black h-[175px] sm:h-[195px]">
              <video
                ref={entryVideoRef}
                autoPlay
                playsInline
                muted
                className={
                  dualLaneSplitMode || entryTransform.rotation !== 0 || entrySnapshot
                    ? 'absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none'
                    : 'h-full w-full object-cover'
                }
              />
              {(dualLaneSplitMode || entryTransform.rotation !== 0) && !entrySnapshot && (
                <LaneCameraPreview
                  videoRef={entryVideoRef}
                  lane="entry"
                  cameraConfig={cameraConfig}
                  active={(dualLaneSplitMode || entryTransform.rotation !== 0) && !entrySnapshot}
                  className="relative z-10 h-full w-full object-contain bg-black"
                />
              )}
              {entrySnapshot && (
                <img
                  src={entrySnapshot}
                  alt="Entry Snapshot"
                  className={`relative z-10 h-full w-full ${dualLaneSplitMode ? 'object-contain bg-black' : 'object-cover'}`}
                />
              )}
              <canvas ref={entryCanvasRef} className="hidden" />

              {/* Bounding Box Guide */}
              {dualLaneSplitMode ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2">
                  <div className="flex justify-end">
                    <span className="rounded bg-emerald-500/90 px-2 py-0.5 text-[9px] font-black uppercase text-black">
                      ENTRY · {entryTransform.side === 'left' ? 'LEFT' : 'RIGHT'} ({entryTransform.rotation}°)
                    </span>
                  </div>
                  <div className="mx-auto my-auto h-20 w-44 rounded-lg border-2 border-dashed border-emerald-400/60 bg-emerald-400/5" />
                  <div />
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                  <div className="h-20 w-52 rounded-lg border-2 border-dashed border-emerald-400/50 bg-emerald-400/5 flex flex-col items-center justify-center text-center p-1">
                    <span className="text-[9px] font-bold uppercase text-emerald-300 drop-shadow">
                      ENTRY SCAN ZONE {entryTransform.rotation !== 0 ? `(${entryTransform.rotation}°)` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Camera Control Footer (Outside video frame so bottom license plates are never covered) */}
            <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#0d0d0f] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-ping" />
                <select
                  value={entryDeviceId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setEntryDeviceId(newId);
                    localStorage.setItem('valo_entry_cam', newId);
                    startCamera('entry', newId);
                  }}
                  className="bg-transparent text-[10px] font-mono text-white/90 border-0 focus:outline-none cursor-pointer truncate max-w-[155px]"
                >
                  {availableCameras.length > 0 ? (
                    availableCameras.map((cam, idx) => (
                      <option key={cam.deviceId} value={cam.deviceId} className="bg-[#111] text-white text-xs">
                        {cam.label || `Camera ${idx + 1}`}
                      </option>
                    ))
                  ) : (
                    <option value="" className="bg-[#111] text-white text-xs">CAM_ENTRY_01 (Default)</option>
                  )}
                </select>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setModalZoom(1);
                    setExpandedCamera('entry');
                  }}
                  className="flex items-center justify-center rounded border border-white/15 bg-white/5 p-1.5 text-white/80 hover:border-emerald-400/40 hover:text-emerald-300 transition"
                  title={t('gateControlUi.expandEntry')}
                  aria-label={t('gateControlUi.expandEntry')}
                >
                  <Maximize2 size={13} />
                </button>
                {entrySnapshot ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEntrySnapshot(null);
                      startCamera('entry', entryDeviceId);
                    }}
                    className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[10px] font-bold text-white hover:bg-white/20"
                  >
                    <RefreshCw size={11} />
                    <span>{t('gateControlUi.liveCamera')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleEntryScanPlate()}
                    disabled={isEntryScanning}
                    className="flex items-center gap-1 rounded bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-black hover:bg-emerald-400"
                  >
                    {isEntryScanning ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                    <span>{t('gateControlUi.scanPlateAi')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Upload Test Option */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/40 px-1">
            <span>{t('gateControlUi.uploadVehiclePhoto')}</span>
            <label className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer font-semibold">
              <Upload size={12} />
              <span>{t('gateControlUi.uploadPhoto')}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => {
                      setEntrySnapshot(reader.result);
                      handleEntryScanPlate(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </label>
          </div>

          {/* Entry Vehicle Details & Classification */}
          <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-[#161618] p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.detectedPlate')}</label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={entryPlate}
                    onChange={(e) => setEntryPlate(e.target.value.toUpperCase())}
                    onBlur={() => entryPlate && verifyEntryPlate(entryPlate)}
                    placeholder={t('gateControlUi.platePlaceholder')}
                    className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-black tracking-wider text-emerald-400 placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.phoneNumber')}</label>
                <input
                  type="text"
                  value={entryPhone}
                  onChange={(e) => {
                    const nextPhone = e.target.value;
                    setEntryPhone(nextPhone);
                    if (entryPlate && nextPhone.trim().length >= 10) {
                      verifyEntryPlate(entryPlate, null, true, nextPhone.trim());
                    }
                  }}
                  onBlur={() => entryPlate && entryPhone && verifyEntryPlate(entryPlate, null, true, entryPhone.trim())}
                  placeholder={t('gateControlUi.customerPhoneOptional')}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-medium text-white placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Classification & Verification Alert */}
            {entryVerifyData && (
              <div className={`p-3 rounded-xl border space-y-2 text-xs ${
                entryVerifyData.isActive || entryVerifyData.tooEarly
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : entryVerifyData.isPausedResume
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200'
                    : entryVerifyData.isMonthly
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-200'
                      : entryVerifyData.hasPreBooking
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              }`}>
                {/* Header: Primary Status + Membership tag */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ShieldCheck size={14} className="shrink-0" />
                    <span className="font-bold text-[11px] truncate uppercase tracking-wider">
                      {entryVerifyData.isActive
                        ? 'Vehicle Already Inside Lot'
                        : entryVerifyData.tooEarly
                          ? (entryVerifyData.message || 'Arrived Before Booking Window')
                          : entryVerifyData.isPausedResume
                            ? `Paused Booking Resumed (${entryVerifyData.remainingHours || 0}h ${entryVerifyData.remainingMinutes || 0}m left)`
                            : entryVerifyData.hasPreBooking
                              ? 'Pre-booked Customer'
                              : entryVerifyData.isMonthly
                                ? `VIP Member (${entryVerifyData.membershipType || 'Monthly Pass'})`
                                : 'Walk-in Guest'}
                    </span>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-bold uppercase shrink-0 border ${
                    entryVerifyData.registeredVehicleInfo?.isRegisteredVehicle || entryVerifyData.isRegisteredVehicle
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                      : entryVerifyData.registeredVehicleInfo?.isMemberAccount || entryVerifyData.hasPreBooking || entryVerifyData.walletInfo?.hasWallet
                        ? 'bg-sky-500/20 text-sky-300 border-sky-400/40'
                        : 'bg-white/10 text-white/60 border-white/15'
                  }`}>
                    {entryVerifyData.registeredVehicleInfo?.isRegisteredVehicle || entryVerifyData.isRegisteredVehicle ? (
                      <><CheckCircle2 size={10} /> Registered Vehicle</>
                    ) : entryVerifyData.registeredVehicleInfo?.isMemberAccount || entryVerifyData.hasPreBooking || entryVerifyData.walletInfo?.hasWallet ? (
                      <><User size={10} /> Valo Member</>
                    ) : (
                      'Walk-in'
                    )}
                  </span>
                </div>

                {/* Auto Reassigned Notice (Only when original slot was blocked) */}
                {entryVerifyData.isPausedResume && entryVerifyData.slotAutoReallocated && (
                  <div className="rounded-lg bg-amber-500/20 border border-amber-400/40 p-2 text-[11px] text-amber-200 font-medium">
                    Original slot {entryVerifyData.originalSlot || 'reserved'} was blocked. Auto-reassigned conflict-free slot {entryVerifyData.assignedSlot} on {formatFloorName(entryVerifyData.assignedFloorName)}.
                  </div>
                )}

                {/* Same-Owner Vehicle Transfer Alert */}
                {entryVerifyData.sameOwnerAlternateBooking && !dismissSameOwnerBooking && (
                  <div className="rounded-xl bg-gradient-to-r from-sky-950/80 to-blue-950/80 border border-sky-400/50 p-2.5 text-xs space-y-1.5 text-sky-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-sky-300">
                        <Sparkles size={13} className="text-sky-400 animate-pulse" />
                        <span>Alternate Booking Found</span>
                      </div>
                      <span className="rounded bg-sky-400/20 px-1.5 py-0.5 text-[9px] font-mono text-sky-300 border border-sky-400/40">
                        Transfer
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-sky-100/90">
                      Customer <strong>{entryVerifyData.sameOwnerAlternateBooking.ownerName}</strong> has pre-booked slot <strong>{entryVerifyData.sameOwnerAlternateBooking.parkingSlot}</strong> for vehicle <strong>{entryVerifyData.sameOwnerAlternateBooking.originalPlate}</strong>.
                    </p>
                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEntrySlotCode(entryVerifyData.sameOwnerAlternateBooking.parkingSlot);
                          if (entryVerifyData.sameOwnerAlternateBooking.floorId) {
                            setEntryFloorId(entryVerifyData.sameOwnerAlternateBooking.floorId);
                          }
                          handleEntryCheckIn(entryPlate, {
                            ...entryVerifyData,
                            bookingId: entryVerifyData.sameOwnerAlternateBooking.bookingId,
                            assignedSlot: entryVerifyData.sameOwnerAlternateBooking.parkingSlot,
                            assignedFloorId: entryVerifyData.sameOwnerAlternateBooking.floorId,
                          });
                        }}
                        className="flex-1 rounded-lg bg-sky-500 py-1.5 text-center text-xs font-bold text-black hover:bg-sky-400 transition shadow-md shadow-sky-500/20"
                      >
                        Transfer Booking to this Vehicle & Check-in
                      </button>
                      <button
                        type="button"
                        onClick={() => setDismissSameOwnerBooking(true)}
                        className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10"
                      >
                        Walk-in Instead
                      </button>
                    </div>
                  </div>
                )}

                {/* Customer Details & Vehicle (Only when available) */}
                {entryVerifyData.registeredVehicleInfo && (
                  <div className="rounded-lg bg-black/40 border border-white/10 p-2 text-[11px] flex items-center justify-between text-white">
                    <div className="min-w-0">
                      <span className="text-white/40 block text-[9px] uppercase font-bold">Customer</span>
                      <span className="font-bold text-white truncate block">{entryVerifyData.registeredVehicleInfo.ownerName || 'Customer'}</span>
                    </div>
                    {entryVerifyData.registeredVehicleInfo.vehicleModelInfo && (
                      <div className="text-right min-w-0">
                        <span className="text-white/40 block text-[9px] uppercase font-bold">Vehicle</span>
                        <span className="font-medium text-white/80 truncate block">{entryVerifyData.registeredVehicleInfo.vehicleModelInfo}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Wallet Status (Privacy Masked) */}
                {entryVerifyData.walletInfo?.hasWallet ? (
                  <div className="rounded-lg bg-black/40 border border-emerald-500/20 p-2 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Wallet size={13} className="text-emerald-400" />
                      <span className="text-white/60">Valo Wallet:</span>
                      <span className="text-emerald-300 font-semibold">Linked Account</span>
                    </div>
                    <span className={`text-[9px] font-bold uppercase rounded px-2 py-0.5 border ${
                      entryVerifyData.walletInfo.balance >= 20000
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                    }`}>
                      {entryVerifyData.walletInfo.balance >= 20000 ? 'Auto-Pay Ready' : 'Low Balance'}
                    </span>
                  </div>
                ) : (
                  <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-1.5 flex items-center justify-between text-[11px] text-white/50">
                    <span>Payment on Exit:</span>
                    <span className="text-white/80 font-medium">Cash / VietQR</span>
                  </div>
                )}

                {/* Violations (Only rendered if actual violations exist) */}
                <ViolationStatusRow
                  violations={entryVerifyData.violations}
                  formatCurrency={formatCurrency}
                />
              </div>
            )}

            {/* Slot & Floor Assignment */}
            <div className="space-y-2.5 pt-1">
              {(() => {
                const classifiedSlots = floorSlotsData
                  .map((slot) =>
                    classifyFloorSlot(
                      slot,
                      entryFloorId,
                      activeSessionsList,
                      activeMapBookings,
                      activeHoldsList,
                      entryVerifyData
                    )
                  )
                  .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

                const availableSlotsList = classifiedSlots.filter((s) => s.selectable);
                const visibleSlots = slotFilterMode === 'available' ? availableSlotsList : classifiedSlots;
                const selectedSlotMeta = classifiedSlots.find(
                  (s) => s.code === normalizeSlotCodeLocal(entrySlotCode)
                );

                return (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.parkingFloor')}</label>
                        <select
                          value={entryFloorId}
                          onChange={(e) => {
                            const nextFloorId = e.target.value;
                            setEntryFloorId(nextFloorId);
                            if (
                              entryVerifyData?.assignedFloorId &&
                              String(entryVerifyData.assignedFloorId) === String(nextFloorId) &&
                              entryVerifyData?.assignedSlot
                            ) {
                              setEntrySlotCode(entryVerifyData.assignedSlot);
                            } else {
                              setEntrySlotCode('');
                            }
                            setSlotPickerOpen(true);
                          }}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold text-white focus:outline-none"
                        >
                          {floors.map(f => (
                            <option key={f._id} value={f._id}>{formatFloorName(f.name || f.floorNumber)}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-white/40">{t('gateControlUi.parkingSlot')}</label>
                        <button
                          type="button"
                          onClick={() => {
                            const nextOpen = !slotPickerOpen;
                            setSlotPickerOpen(nextOpen);
                            if (nextOpen && entryFloorId) {
                              fetchFloorSlotOptions(entryFloorId);
                            }
                          }}
                          className={`mt-1 w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${
                            slotPickerOpen
                              ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-300'
                              : entrySlotCode
                                ? 'border-emerald-500/40 bg-black/60 text-emerald-400 hover:border-emerald-400/60'
                                : 'border-white/15 bg-black/60 text-white/60 hover:border-white/30 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            {entrySlotCode ? (
                              <>
                                <span className="uppercase">{entrySlotCode}</span>
                                {selectedSlotMeta?.isVipSlot && (
                                  <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-black text-amber-300 border border-amber-400/30">
                                    VIP
                                  </span>
                                )}
                                {selectedSlotMeta?.isEvSlot && (
                                  <span className="rounded bg-sky-500/20 px-1 py-0.5 text-[9px] font-black text-sky-300 border border-sky-400/30">
                                    EV
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="font-semibold text-white/40">
                                {t('gateControlUi.selectSlot', { count: availableSlotsList.length })}
                              </span>
                            )}
                          </span>
                          <ChevronRight
                            size={14}
                            className={`shrink-0 transition-transform ${slotPickerOpen ? 'rotate-90 text-emerald-300' : 'text-white/40'}`}
                          />
                        </button>
                      </div>
                    </div>

                    {slotPickerOpen && (
                      <div className="rounded-xl border border-white/15 bg-[#0d0d0f] p-3 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSlotFilterMode('available')}
                              className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${
                                slotFilterMode === 'available'
                                  ? 'bg-emerald-500 text-black'
                                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              Available ({availableSlotsList.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setSlotFilterMode('all')}
                              className={`rounded-md px-2.5 py-1 text-[10px] font-bold transition ${
                                slotFilterMode === 'all'
                                  ? 'bg-white/20 text-white'
                                  : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                              }`}
                            >
                              All Slots ({classifiedSlots.length})
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => entryFloorId && fetchFloorSlotOptions(entryFloorId)}
                              disabled={isLoadingFloorSlots}
                              className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/70 hover:text-white disabled:opacity-50"
                              title="Refresh live slot availability"
                            >
                              <RefreshCw size={11} className={isLoadingFloorSlots ? 'animate-spin' : ''} />
                              <span>{t('gateControlUi.refresh')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSlotPickerOpen(false)}
                              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white/60 hover:text-white"
                            >
                              Close
                            </button>
                          </div>
                        </div>

                        {isLoadingFloorSlots && classifiedSlots.length === 0 ? (
                          <div className="flex items-center justify-center gap-2 py-6 text-xs text-white/50">
                            <Loader2 size={14} className="animate-spin text-emerald-400" />
                            <span>{t('gateControlUi.loadingSlots')}</span>
                          </div>
                        ) : visibleSlots.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-white/10 py-5 px-3 text-center text-[11px] text-white/50">
                            {classifiedSlots.length === 0
                              ? 'No parking slots configured on this floor.'
                              : 'No free slots on this floor right now. Switch to "All Slots" to inspect occupied/VIP spots or choose another floor.'}
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto pr-1">
                            {visibleSlots.map((item) => {
                              const isSelected = normalizeSlotCodeLocal(entrySlotCode) === item.code;
                              const cardTheme = !item.selectable
                                ? item.state === 'vip_reserved'
                                  ? 'border-purple-500/25 bg-purple-500/5 text-purple-200/70 opacity-75 cursor-not-allowed'
                                  : item.state === 'booked' || item.state === 'held'
                                    ? 'border-amber-500/25 bg-amber-500/5 text-amber-200/70 opacity-75 cursor-not-allowed'
                                    : item.state === 'occupied'
                                      ? 'border-red-500/25 bg-red-500/5 text-red-200/70 opacity-75 cursor-not-allowed'
                                      : 'border-white/10 bg-white/[0.03] text-white/40 opacity-65 cursor-not-allowed'
                                : isSelected
                                  ? 'border-emerald-400 bg-emerald-500/20 text-white shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                                  : item.state === 'assigned'
                                    ? 'border-sky-400/50 bg-sky-500/15 text-sky-100 hover:border-sky-300'
                                    : item.isVipSlot
                                      ? 'border-amber-400/35 bg-amber-500/10 text-amber-100 hover:border-amber-300 hover:bg-amber-500/15'
                                      : 'border-emerald-500/25 bg-emerald-500/5 text-white hover:border-emerald-400/60 hover:bg-emerald-500/10';

                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  disabled={!item.selectable}
                                  onClick={() => {
                                    setEntrySlotCode(item.rawCode || item.code);
                                    setSlotPickerOpen(false);
                                  }}
                                  className={`rounded-lg border p-2 text-left transition flex flex-col justify-between gap-1 ${cardTheme}`}
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-xs font-black tracking-wide truncate">{item.code}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {item.isVipSlot && (
                                        <span className="rounded bg-amber-500/25 px-1 py-0.5 text-[8px] font-black uppercase text-amber-300 border border-amber-400/30">
                                          VIP
                                        </span>
                                      )}
                                      {!item.isVipSlot && item.isEvSlot && (
                                        <span className="rounded bg-sky-500/25 px-1 py-0.5 text-[8px] font-black uppercase text-sky-300 border border-sky-400/30">
                                          EV
                                        </span>
                                      )}
                                      {isSelected && <Check size={12} className="text-emerald-300" />}
                                    </div>
                                  </div>
                                  <div className="space-y-0.5">
                                    <p className="text-[9px] font-bold uppercase tracking-wider opacity-90 truncate">
                                      {item.statusLabel}
                                    </p>
                                    <p className="text-[9px] opacity-65 truncate" title={item.detail}>
                                      {item.detail}
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Entry Action Buttons */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setAiTargetLane('entry');
                  setAiModalInitialPlate(entryPlate);
                  setAiModalInitialImage(entrySnapshot);
                  setShowAiModal(true);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-400/20 to-yellow-500/20 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition"
              >
                <Sparkles size={14} className="text-amber-400" />
                <span>{t('gateControlUi.aiAssistant')}</span>
              </button>

              <button
                type="button"
                onClick={() => handleEntryCheckIn()}
                disabled={isEntryCheckingIn || !entryPlate}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400 disabled:opacity-50 transition shadow-lg shadow-emerald-500/20"
              >
                {isEntryCheckingIn ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                <span>{t('gateControlUi.checkinOpen')}</span>
              </button>
            </div>

            {/* Manual Barrier Override (Entry) */}
            <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setOverrideModal({ action: 'open', gate: 'ENTRY_1', plate: entryPlate || 'MANUAL_ENTRY', slot: entrySlotCode || '' })}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Unlock size={12} className="text-emerald-400" />
                <span>{t('gateControlUi.openEntry')}</span>
              </button>

              <button
                type="button"
                onClick={() => setOverrideModal({ action: 'hold', gate: 'ENTRY_1', plate: entryPlate || 'MANUAL_HOLD', slot: '' })}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Pause size={12} className="text-yellow-400" />
                <span>{t('gateControlUi.hold')}</span>
              </button>

              <button
                type="button"
                onClick={() => triggerBarrier('close', 'ENTRY_1', entryPlate || 'MANUAL_ENTRY', '', 'MANUAL_CLOSE', 'Gate closed')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Lock size={12} className="text-red-400" />
                <span>{t('gateControlUi.close')}</span>
              </button>
            </div>
          </div>
        </div>


        {/* ──────────────────────────────────────────────────────────────────
            RIGHT COLUMN: EXIT STATION (EXIT_1)
        ────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col rounded-2xl border border-sky-500/20 bg-[#111111] p-4 shadow-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full bg-sky-500/10 blur-3xl" />

          {/* Lane Header */}
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30">
                <Car size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <span>{t('gateControlUi.exitGate')}</span>
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300 border border-sky-500/30">EXIT_1</span>
                </h2>
                <p className="text-[11px] text-white/45 truncate">{t('gateControlUi.exitSubtitle')}</p>
              </div>
            </div>

            {/* Barrier status & lane rotate button */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const updated = await updateCameraConfig((c) => ({
                    exitRotation: (Number(c.exitRotation || 0) + 90) % 360,
                  }));
                  toast.success(`Exit camera rotated to ${updated.exitRotation}°.`);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase border transition ${exitTransform.rotation !== 0
                  ? 'bg-sky-500/20 text-sky-300 border-sky-400/50'
                  : 'bg-white/5 text-white/70 border-white/15 hover:text-white'
                  }`}
                title="Rotate Exit camera in 90° steps (0° → 90° → 180° → 270°)"
              >
                <RotateCw size={11} />
                <span>{exitTransform.rotation}°</span>
              </button>
              <span className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase border whitespace-nowrap ${gatesState.EXIT_1?.open
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-red-500/20 text-red-300 border-red-500/40'
                }`}>
                {gatesState.EXIT_1?.open ? <Unlock size={11} /> : <Lock size={11} />}
                {gatesState.EXIT_1?.open ? t('gateControlUi.barrierOpen') : t('gateControlUi.barrierClosed')}
              </span>
            </div>
          </div>

          {/* Live Camera Feed or Snapshot Preview */}
          <div className="overflow-hidden rounded-xl border border-white/15 bg-black">
            <div className="relative w-full overflow-hidden bg-black h-[175px] sm:h-[195px]">
              <video
                ref={exitVideoRef}
                autoPlay
                playsInline
                muted
                className={
                  dualLaneSplitMode || exitTransform.rotation !== 0 || exitSnapshot
                    ? 'absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none'
                    : 'h-full w-full object-cover'
                }
              />
              {(dualLaneSplitMode || exitTransform.rotation !== 0) && !exitSnapshot && (
                <LaneCameraPreview
                  videoRef={exitVideoRef}
                  lane="exit"
                  cameraConfig={cameraConfig}
                  active={(dualLaneSplitMode || exitTransform.rotation !== 0) && !exitSnapshot}
                  className="relative z-10 h-full w-full object-contain bg-black"
                />
              )}
              {exitSnapshot && (
                <img
                  src={exitSnapshot}
                  alt="Exit Snapshot"
                  className={`relative z-10 h-full w-full ${dualLaneSplitMode ? 'object-contain bg-black' : 'object-cover'}`}
                />
              )}
              <canvas ref={exitCanvasRef} className="hidden" />

              {/* Bounding Box Guide */}
              {dualLaneSplitMode ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2">
                  <div className="flex justify-start">
                    <span className="rounded bg-sky-400/90 px-2 py-0.5 text-[9px] font-black uppercase text-black">
                      EXIT · {exitTransform.side === 'left' ? 'LEFT' : 'RIGHT'} ({exitTransform.rotation}°)
                    </span>
                  </div>
                  <div className="mx-auto my-auto h-20 w-44 rounded-lg border-2 border-dashed border-sky-400/60 bg-sky-400/5" />
                  <div />
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                  <div className="h-20 w-52 rounded-lg border-2 border-dashed border-sky-400/50 bg-sky-400/5 flex flex-col items-center justify-center text-center p-1">
                    <span className="text-[9px] font-bold uppercase text-sky-300 drop-shadow">
                      EXIT SCAN ZONE {exitTransform.rotation !== 0 ? `(${exitTransform.rotation}°)` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Camera Control Footer (Outside video frame so bottom license plates are never covered) */}
            <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#0d0d0f] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400 animate-ping" />
                <select
                  value={exitDeviceId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setExitDeviceId(newId);
                    localStorage.setItem('valo_exit_cam', newId);
                    startCamera('exit', newId);
                  }}
                  className="bg-transparent text-[10px] font-mono text-white/90 border-0 focus:outline-none cursor-pointer truncate max-w-[155px]"
                >
                  {availableCameras.length > 0 ? (
                    availableCameras.map((cam, idx) => (
                      <option key={cam.deviceId} value={cam.deviceId} className="bg-[#111] text-white text-xs">
                        {cam.label || `Camera ${idx + 1}`}
                      </option>
                    ))
                  ) : (
                    <option value="" className="bg-[#111] text-white text-xs">CAM_EXIT_01 (Default)</option>
                  )}
                </select>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setModalZoom(1);
                    setExpandedCamera('exit');
                  }}
                  className="flex items-center justify-center rounded border border-white/15 bg-white/5 p-1.5 text-white/80 hover:border-sky-400/40 hover:text-sky-300 transition"
                  title={t('gateControlUi.expandExit')}
                  aria-label={t('gateControlUi.expandExit')}
                >
                  <Maximize2 size={13} />
                </button>
                {exitSnapshot ? (
                  <button
                    type="button"
                    onClick={() => {
                      setExitSnapshot(null);
                      startCamera('exit', exitDeviceId);
                    }}
                    className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[10px] font-bold text-white hover:bg-white/20"
                  >
                    <RefreshCw size={11} />
                    <span>{t('gateControlUi.liveCamera')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleExitScanPlate()}
                    disabled={isExitScanning}
                    className="flex items-center gap-1 rounded bg-sky-500 px-2.5 py-1 text-[10px] font-bold text-black hover:bg-sky-400"
                  >
                    {isExitScanning ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                    <span>{t('gateControlUi.scanPlateAi')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Select from Active Sessions in Lot */}
          <div className="mt-2 space-y-2 px-1 text-[11px] text-white/40">
            <div className="flex items-center justify-between gap-2">
              <span>{t('gateControlUi.quickSelectVehicle')}</span>
              <select
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    setExitPlate(val);
                    lookupExitSession(val);
                  }
                }}
                className="min-w-0 flex-1 bg-black/60 text-sky-400 border border-white/15 rounded px-2 py-1 text-[10px] font-bold focus:outline-none"
              >
                <option value="">-- Active Vehicles ({activeSessionsList.length}) --</option>
                {activeSessionsList.map(s => (
                  <option key={s._id} value={s.licensePlate}>{s.licensePlate} ({s.parkingSlot || 'Unassigned'})</option>
                ))}
              </select>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                lookupExitSession(exitPlate);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={exitPlate}
                onChange={(event) => setExitPlate(event.target.value.toUpperCase())}
                placeholder={t('gateControlUi.findSession')}
                className="min-w-0 flex-1 rounded border border-white/15 bg-black/60 px-3 py-2 text-xs font-bold text-white outline-none placeholder:text-white/30 focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={!exitPlate.trim() || isExitScanning}
                className="rounded bg-sky-500 px-3 py-2 text-[10px] font-black text-black hover:bg-sky-400 disabled:opacity-50"
              >
                Find Vehicle
              </button>
            </form>
          </div>

          {/* Exit Vehicle Booking & Violation Status */}
          {exitStatusInfo && (() => {
            const typeKey = String(exitStatusInfo.sessionType || '').toUpperCase();
            const isVip = typeKey === 'MONTHLY' || typeKey === 'VIP';
            const isPreBooked = typeKey === 'RESERVATION' || typeKey === 'BOOKING' || typeKey === 'PRE_BOOKED';
            const hasViolation = Boolean(exitStatusInfo.violations?.hasViolations || exitStatusInfo.violationDetails);
            return (
              <div
                className={`mt-4 rounded-xl border p-3.5 text-xs ${
                  !exitStatusInfo.found
                    ? 'border-red-500/30 bg-red-500/10 text-red-200'
                    : hasViolation
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                      : isVip
                        ? 'border-purple-500/30 bg-purple-500/10 text-purple-100'
                        : isPreBooked
                          ? 'border-sky-500/30 bg-sky-500/10 text-sky-100'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-black/30 border border-current/25">
                      {!exitStatusInfo.found
                        ? 'No Active Session'
                        : isVip
                          ? 'VIP / Monthly Member'
                          : isPreBooked
                            ? 'Pre-booked Vehicle'
                            : 'Walk-in (No Booking)'}
                    </span>
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border ${
                        hasViolation
                          ? 'bg-red-500/20 text-red-200 border-red-400/40'
                          : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
                      }`}
                    >
                      {hasViolation ? 'Has Violations' : 'No Violations'}
                    </span>
                  </div>
                  {exitStatusInfo.parkingSlot && (
                    <span className="text-[10px] font-bold text-white/80">
                      Slot {exitStatusInfo.parkingSlot}
                    </span>
                  )}
                </div>
                {!exitStatusInfo.found && (
                  <p className="mt-1.5 text-[11px] font-semibold text-red-200">
                    No active parking session matches this license plate inside the lot.
                  </p>
                )}
                <ViolationStatusRow
                  violations={exitStatusInfo.violations}
                  violationDetails={exitStatusInfo.violationDetails}
                  formatCurrency={formatCurrency}
                  t={t}
                />
              </div>
            );
          })()}

          {/* Security Double-Check (Side-by-Side Images) */}
          {exitInvoiceData && (
            <div className="mt-4 rounded-xl border border-white/10 bg-[#161618] p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-sky-400 flex items-center gap-1">
                  <ShieldCheck size={13} />
                  Security Double-Check
                </span>
                <span className="text-[10px] font-bold text-white/50">Plate: {exitInvoiceData.session?.licensePlate}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/10 bg-black/40 p-1 text-center">
                  <p className="text-[9px] font-bold text-emerald-400 mb-1">Entry Photo (Check-in)</p>
                  <div className="aspect-video w-full overflow-hidden rounded bg-black flex items-center justify-center">
                    {exitInvoiceData.session?.entryImage ? (
                      <img src={exitInvoiceData.session.entryImage} alt="Entry" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-white/30">No entry image</span>
                    )}
                  </div>
                  <p className="text-[9px] text-white/40 mt-1">{formatDate(exitInvoiceData.session?.checkInTime)}</p>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/40 p-1 text-center">
                  <p className="text-[9px] font-bold text-sky-400 mb-1">Exit Photo (Check-out)</p>
                  <div className="aspect-video w-full overflow-hidden rounded bg-black flex items-center justify-center">
                    {exitSnapshot ? (
                      <img src={exitSnapshot} alt="Exit" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-white/30">Exit Camera</span>
                    )}
                  </div>
                  <p className="text-[9px] text-white/40 mt-1">Now</p>
                </div>
              </div>

              {/* Parking Violation Alert detected by AI Camera */}
              {exitInvoiceData.violationDetails && (
                <div className="rounded-lg border border-red-500/50 bg-red-950/70 p-3 text-xs text-red-200 space-y-2">
                  <div className="flex items-center justify-between pb-1.5 border-b border-red-500/20">
                    <span className="flex items-center gap-1.5 font-black text-red-400 uppercase tracking-wide text-[11px]">
                      <AlertTriangle size={15} className="animate-pulse text-red-400" />
                      Parking Violation Detected (AI Camera)
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-mono text-[10px] font-bold border border-red-500/30">
                      ALERT
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-white font-medium">
                      <strong className="text-red-300">Reason:</strong>{' '}
                      {exitInvoiceData.violationDetails.violationMessage || `Unauthorized parking at slot ${exitInvoiceData.violationDetails.slotCode}`}
                    </p>
                    <div className="flex items-center gap-1.5 text-slate-300 text-[11px]">
                      <Clock size={12} className="text-amber-400 flex-shrink-0" />
                      <span>
                        <strong>Duration:</strong> From{' '}
                        <span className="text-white font-mono font-bold">
                          {new Date(exitInvoiceData.violationDetails.detectedAt).toLocaleTimeString('en-US')}
                        </span>{' '}
                        to{' '}
                        <span className="text-white font-mono font-bold">
                          {exitInvoiceData.violationDetails.resolvedAt
                            ? new Date(exitInvoiceData.violationDetails.resolvedAt).toLocaleTimeString('en-US')
                            : 'Present'}
                        </span>{' '}
                        ({exitInvoiceData.violationDetails.durationMinutes} min)
                      </span>
                    </div>
                  </div>

                  {exitInvoiceData.violationDetails.evidenceSnapshot && (
                    <div className="rounded-md overflow-hidden border border-red-500/30 max-h-[80px] bg-black/60 flex items-center justify-center">
                      <img src={exitInvoiceData.violationDetails.evidenceSnapshot} alt="Evidence" className="w-full h-auto max-h-[80px] object-contain" />
                    </div>
                  )}

                  <p className="text-[10px] text-amber-300/80 italic">
                    * Staff should review and notify the driver about this violation before opening the exit barrier.
                  </p>
                </div>
              )}

              {/* Registration & Account Status */}
              {(exitInvoiceData.isRegisteredVehicle || exitInvoiceData.registeredVehicleInfo?.isRegisteredVehicle) ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                      <CheckCircle2 size={15} className="text-emerald-400" />
                      <span>Registered Vehicle</span>
                    </div>
                    <span className="rounded bg-emerald-400/20 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-300 border border-emerald-400/30">
                      Valo Account Verified
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-black/40 border border-white/5 rounded-lg p-2 text-white">
                    <div>
                      <span className="text-white/40 block text-[9px] uppercase font-bold">Customer</span>
                      <span className="font-bold block">{exitInvoiceData.registeredVehicleInfo?.ownerName || 'Customer'}</span>
                      {exitInvoiceData.registeredVehicleInfo?.phone && (
                        <span className="text-white/60 block text-[10px] font-mono">{exitInvoiceData.registeredVehicleInfo.phone}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-white/40 block text-[9px] uppercase font-bold">Vehicle Model</span>
                      <span className="font-bold block">{exitInvoiceData.registeredVehicleInfo?.vehicleModelInfo || exitInvoiceData.registeredVehicleInfo?.brand || 'Automobile'}</span>
                    </div>
                  </div>
                </div>
              ) : (exitInvoiceData.registeredVehicleInfo?.isMemberAccount || exitInvoiceData.session?.type === 'BOOKING' || exitInvoiceData.hasWallet) ? (
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-sky-300">
                      <User size={15} className="text-sky-400" />
                      <span>Valo Member Account</span>
                    </div>
                    <span className="rounded bg-sky-400/20 px-2 py-0.5 text-[9px] font-black uppercase text-sky-300 border border-sky-400/30">
                      Linked Member
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-black/40 border border-white/5 rounded-lg p-2 text-white">
                    <div>
                      <span className="text-white/40 block text-[9px] uppercase font-bold">Customer</span>
                      <span className="font-bold block">{exitInvoiceData.registeredVehicleInfo?.ownerName || 'Customer'}</span>
                      {exitInvoiceData.registeredVehicleInfo?.phone && (
                        <span className="text-white/60 block text-[10px] font-mono">{exitInvoiceData.registeredVehicleInfo.phone}</span>
                      )}
                    </div>
                    <div>
                      <span className="text-white/40 block text-[9px] uppercase font-bold">Vehicle Info</span>
                      <span className="font-bold block">{exitInvoiceData.registeredVehicleInfo?.vehicleModelInfo || 'Pre-booked Vehicle'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-amber-300">
                      <AlertCircle size={15} className="text-amber-400" />
                      <span>Unregistered Vehicle / Guest</span>
                    </div>
                    <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300 border border-amber-400/30">
                      No Valo Account
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-100/70 mt-1">
                    Vehicle is not linked to any registered user. Staff must collect payment via Cash or VietQR.
                  </p>
                </div>
              )}

              {/* Invoice Summary (Compact Horizontal Row) */}
              <div className="rounded-lg bg-black/60 px-3 py-2 text-xs border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3 text-white/70 text-[11px]">
                  <div>
                    <span className="text-white/40 block text-[9px] uppercase font-bold">Duration</span>
                    <span className="font-bold text-white">{exitInvoiceData.durationFormatted || '2 hrs'}</span>
                  </div>
                  <div className="h-6 w-px bg-white/10" />
                  <div>
                    <span className="text-white/40 block text-[9px] uppercase font-bold">Type</span>
                    <span className="font-bold text-white">{exitInvoiceData.session?.type || 'STANDARD'}</span>
                  </div>
                  <div className="h-6 w-px bg-white/10" />
                  <div>
                    <span className="text-white/40 block text-[9px] uppercase font-bold">Fee</span>
                    <span className="font-mono font-semibold text-white">{formatCurrency(exitInvoiceData.parkingFee || 0)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-white/40 block text-[9px] uppercase font-black">Total Due</span>
                  <span className="text-base font-black text-[#ffd555] font-mono">
                    {formatCurrency(exitInvoiceData.totalAmount || 0)}
                  </span>
                </div>
              </div>

              {/* Payment Methods & Wallet Auto-Pay (Compact & English) */}
              {exitInvoiceData.totalAmount > 0 ? (
                <div className="space-y-2">
                  {/* Valo Wallet Auto-Pay Option */}
                  {exitInvoiceData.canAutoPay && (
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-2 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-cyan-300">
                          <Wallet size={14} className="text-cyan-400" />
                          <span>Valo Wallet Auto-Pay</span>
                        </div>
                        <span className="rounded bg-cyan-400/20 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300 border border-cyan-400/30">
                          ✓ Auto-Pay Ready
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleExitCheckOut(null, false, 'wallet')}
                        disabled={isExitCheckingOut}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-500 py-1.5 text-xs font-black text-black hover:from-cyan-300 hover:to-sky-400 transition shadow-md shadow-cyan-500/20"
                      >
                        {isExitCheckingOut ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                        <span>Auto-Debit Wallet & Open Gate ({formatCurrency(exitInvoiceData.totalAmount)})</span>
                      </button>
                    </div>
                  )}

                  {/* Cash Collection Section */}
                  <div className="rounded-xl border border-white/10 bg-[#16161a] p-2 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-amber-300 text-xs">
                        <Banknote size={14} className="text-amber-400" />
                        <span>{exitInvoiceData.canAutoPay ? 'Or Collect Cash / VietQR' : 'Collect Cash / VietQR'}</span>
                      </div>
                      {exitInvoiceData.hasWallet && !exitInvoiceData.canAutoPay && (
                        <span className="rounded bg-red-400/20 px-1.5 py-0.5 text-[9px] font-bold text-red-300 border border-red-400/30">
                          Insufficient Balance
                        </span>
                      )}
                    </div>

                    {/* Quick bill selection chips + input on unified row */}
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <input
                          type="number"
                          min={exitInvoiceData.totalAmount}
                          step="1000"
                          value={cashReceivedAmount}
                          onChange={(e) => setCashReceivedAmount(e.target.value)}
                          placeholder={`Min ${formatCurrency(exitInvoiceData.totalAmount)}`}
                          className="w-full rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 pr-7 font-mono text-xs font-semibold text-white placeholder:text-white/20 outline-none focus:border-amber-400"
                        />
                        <span className="absolute right-2.5 top-1.5 text-[10px] font-bold text-white/40 font-mono">đ</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setCashReceivedAmount(String(exitInvoiceData.totalAmount))}
                        className={`shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-bold transition border ${
                          Number(cashReceivedAmount) === Number(exitInvoiceData.totalAmount)
                            ? 'bg-amber-400 text-black border-amber-400'
                            : 'bg-amber-400/10 text-amber-300 border-amber-400/30 hover:bg-amber-400/20'
                        }`}
                      >
                        Exact ({formatShortCurrency(exitInvoiceData.totalAmount)})
                      </button>

                      {getQuickCashSuggestions(exitInvoiceData.totalAmount).map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setCashReceivedAmount(String(val))}
                          className={`shrink-0 rounded-lg px-1.5 py-1.5 text-[10px] font-mono font-medium transition border ${
                            Number(cashReceivedAmount) === val
                              ? 'bg-amber-400 text-black border-amber-400 font-bold'
                              : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {formatShortCurrency(val)}
                        </button>
                      ))}
                    </div>

                    {/* Change Due Row */}
                    {Number(cashReceivedAmount) >= Number(exitInvoiceData.totalAmount) && (
                      <div className="rounded-lg bg-emerald-950/30 border border-emerald-500/30 px-2.5 py-1.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-emerald-200 text-[11px]">
                          <span>Change Due:</span>
                          <span className="font-mono font-black text-emerald-300 text-sm">
                            {formatCurrency(Number(cashReceivedAmount) - Number(exitInvoiceData.totalAmount))}
                          </span>
                        </div>

                        {Number(cashReceivedAmount) > Number(exitInvoiceData.totalAmount) && (
                          exitInvoiceData.hasWallet ? (
                            <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-cyan-200">
                              <input
                                type="checkbox"
                                checked={depositChangeToWallet}
                                onChange={(e) => setDepositChangeToWallet(e.target.checked)}
                                className="rounded border-cyan-400 bg-black/60 text-cyan-500 focus:ring-0 scale-90"
                              />
                              <span>Deposit change into Valo Wallet</span>
                            </label>
                          ) : (
                            <span className="text-[10px] text-white/40 italic">
                              (No linked wallet for deposit)
                            </span>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-400" />
                    <div>
                      <span className="font-bold text-emerald-300 block text-xs">No Parking Fee Due (0 VND)</span>
                      <span className="text-[10px] text-emerald-200/70">Covered by active Booking or VIP pass.</span>
                    </div>
                  </div>
                  <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-300 border border-emerald-400/40 font-mono">
                    PAID
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Exit Action Buttons */}
          <div className="mt-4 flex flex-col gap-2">
            {exitInvoiceData?.isEarlyExit && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-200">
                <div className="flex items-center gap-1.5 font-bold mb-1 text-cyan-300">
                  <PauseCircle size={15} className="text-cyan-400" />
                  <span>Early Departure Choice</span>
                  <span className="ml-auto rounded bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300 border border-cyan-400/30">
                    {exitInvoiceData.remainingHours || 0}h Left
                  </span>
                </div>
                <p className="text-[11px] text-cyan-100/70 mb-2.5">
                  Pre-booking remains valid until {exitInvoiceData.bookingEnd ? new Date(exitInvoiceData.bookingEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'end time'}. Choose whether customer will return or is ending their visit now.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleExitCheckOut(null, true, exitInvoiceData.canAutoPay && !cashReceivedAmount ? 'wallet' : 'cash')}
                    disabled={
                      isExitCheckingOut
                      || (Number(exitInvoiceData.totalAmount || 0) > 0
                        && !exitInvoiceData.canAutoPay
                        && Number(cashReceivedAmount) < Number(exitInvoiceData.totalAmount))
                    }
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 py-2 text-xs font-black text-black hover:bg-cyan-400 disabled:opacity-50 transition shadow-lg shadow-cyan-500/20"
                  >
                    {isExitCheckingOut ? <Loader2 size={13} className="animate-spin" /> : <PauseCircle size={13} />}
                    <span>Pause (Keep Slot)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExitCheckOut(null, false, exitInvoiceData.canAutoPay && !cashReceivedAmount ? 'wallet' : 'cash')}
                    disabled={
                      isExitCheckingOut
                      || (Number(exitInvoiceData.totalAmount || 0) > 0
                        && !exitInvoiceData.canAutoPay
                        && Number(cashReceivedAmount) < Number(exitInvoiceData.totalAmount))
                    }
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/10 py-2 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-50 transition"
                  >
                    {isExitCheckingOut ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    <span>End Session</span>
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setAiTargetLane('exit');
                  setAiModalInitialPlate(exitPlate);
                  setAiModalInitialImage(exitSnapshot);
                  setShowAiModal(true);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-400/20 to-yellow-500/20 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition"
              >
                <Sparkles size={14} className="text-amber-400" />
                <span>{t('gateControlUi.aiAssistant')}</span>
              </button>

              {!exitInvoiceData?.isEarlyExit ? (
                <button
                  type="button"
                  onClick={() => handleExitCheckOut(null, false, exitInvoiceData?.canAutoPay && !cashReceivedAmount ? 'wallet' : 'cash')}
                  disabled={
                    isExitCheckingOut
                    || !exitInvoiceData
                    || (Number(exitInvoiceData.totalAmount || 0) > 0
                      && !exitInvoiceData.canAutoPay
                      && Number(cashReceivedAmount) < Number(exitInvoiceData.totalAmount))
                  }
                  className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-2.5 text-xs font-black text-black hover:bg-sky-400 disabled:opacity-50 transition shadow-lg shadow-sky-500/20"
                >
                  {isExitCheckingOut ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  <span>
                    {Number(cashReceivedAmount) >= Number(exitInvoiceData?.totalAmount || 0) && Number(exitInvoiceData?.totalAmount || 0) > 0
                      ? 'Collect Cash & Open Gate'
                      : Number(exitInvoiceData?.totalAmount || 0) === 0
                        ? 'Free Pass & Open Gate'
                        : (t ? t('gateControlUi.checkoutOpen') : 'Check-out & Open Gate')}
                  </span>
                </button>
              ) : (
                <div className="flex items-center justify-center rounded-xl bg-white/5 border border-white/10 px-2 py-2 text-[11px] font-semibold text-white/50 text-center">
                  Select Pause or End above
                </div>
              )}
            </div>

            {/* Manual Barrier Override (Exit) */}
            <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setOverrideModal({ action: 'open', gate: 'EXIT_1', plate: exitPlate || 'MANUAL_EXIT', slot: '' })}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Unlock size={12} className="text-sky-400" />
                <span>{t('gateControlUi.openExit')}</span>
              </button>

              <button
                type="button"
                onClick={() => setOverrideModal({ action: 'hold', gate: 'EXIT_1', plate: exitPlate || 'MANUAL_HOLD', slot: '' })}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Pause size={12} className="text-yellow-400" />
                <span>{t('gateControlUi.hold')}</span>
              </button>

              <button
                type="button"
                onClick={() => triggerBarrier('close', 'EXIT_1', exitPlate || 'MANUAL_EXIT', '', 'MANUAL_CLOSE', 'Gate closed')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Lock size={12} className="text-red-400" />
                <span>{t('gateControlUi.close')}</span>
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          EXPANDED CAMERA ZOOM MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      {expandedCamera && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setExpandedCamera(null)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-white/15 bg-[#111114] p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-full animate-pulse ${expandedCamera === 'entry' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                <h3 className={`text-sm font-black uppercase tracking-wider ${expandedCamera === 'entry' ? 'text-emerald-400' : 'text-sky-400'}`}>
                  {expandedCamera === 'entry' ? 'Entry Gate (ENTRY_1) · Zoom View' : 'Exit Gate (EXIT_1) · Zoom View'}
                </h3>
                <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-white/70">
                  {expandedCamera === 'entry' ? `${entryTransform.rotation}°` : `${exitTransform.rotation}°`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setModalZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
                  disabled={modalZoom <= 1}
                  className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/15 disabled:opacity-40"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setModalZoom(1)}
                  className="rounded-lg border border-white/15 bg-black/50 px-2.5 py-1.5 text-xs font-mono font-bold text-white/85 hover:border-white/30"
                  title="Reset zoom to 100%"
                >
                  {Math.round(modalZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setModalZoom((z) => Math.min(2.5, Math.round((z + 0.25) * 100) / 100))}
                  disabled={modalZoom >= 2.5}
                  className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/15 disabled:opacity-40"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (expandedCamera === 'entry') {
                      const updated = await updateCameraConfig((c) => ({
                        entryRotation: (Number(c.entryRotation || 0) + 90) % 360,
                      }));
                      toast.success(`Entry camera rotated to ${updated.entryRotation}°.`);
                    } else {
                      const updated = await updateCameraConfig((c) => ({
                        exitRotation: (Number(c.exitRotation || 0) + 90) % 360,
                      }));
                      toast.success(`Exit camera rotated to ${updated.exitRotation}°.`);
                    }
                  }}
                  className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/15"
                >
                  <RotateCw size={13} />
                  <span>Rotate 90°</span>
                </button>

                <button
                  type="button"
                  onClick={() => (expandedCamera === 'entry' ? handleEntryScanPlate() : handleExitScanPlate())}
                  disabled={expandedCamera === 'entry' ? isEntryScanning : isExitScanning}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-black transition ${expandedCamera === 'entry'
                    ? 'bg-emerald-500 hover:bg-emerald-400'
                    : 'bg-sky-500 hover:bg-sky-400'
                    }`}
                >
                  {(expandedCamera === 'entry' ? isEntryScanning : isExitScanning)
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Camera size={13} />}
                  <span>{t('gateControlUi.scanPlateAi')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setExpandedCamera(null)}
                  className="flex items-center justify-center rounded-lg border border-white/15 bg-white/5 p-1.5 text-white/75 hover:bg-red-500/20 hover:text-red-300"
                  title="Close Zoom View"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Large Zoomable Viewport */}
            <div className="relative h-[62vh] w-full overflow-auto rounded-xl border border-white/10 bg-black">
              <div
                className="flex items-center justify-center transition-all duration-150 ease-out"
                style={{
                  width: `${modalZoom * 100}%`,
                  height: `${modalZoom * 100}%`,
                  minWidth: '100%',
                  minHeight: '100%',
                }}
              >
                {(expandedCamera === 'entry' ? entrySnapshot : exitSnapshot) ? (
                  <img
                    src={expandedCamera === 'entry' ? entrySnapshot : exitSnapshot}
                    alt={`${expandedCamera} zoomed snapshot`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <LaneCameraPreview
                    videoRef={expandedCamera === 'entry' ? entryVideoRef : exitVideoRef}
                    lane={expandedCamera}
                    cameraConfig={cameraConfig}
                    active={Boolean(expandedCamera)}
                    className="h-full w-full object-contain bg-black"
                  />
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between text-xs text-white/60">
              <span>
                Detected Plate:{' '}
                <strong className={expandedCamera === 'entry' ? 'text-emerald-400' : 'text-sky-400'}>
                  {(expandedCamera === 'entry' ? entryPlate : exitPlate) || 'Waiting for scan'}
                </strong>
              </span>
              <span className="text-[11px] text-white/40">
                Tip: Use +/- to zoom up to 250% without affecting AI scan accuracy.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          BARRIER MANUAL OVERRIDE AUDIT MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      {overrideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setOverrideModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-amber-400/30 bg-[#16161a] p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-amber-400" />
                <h3 className="text-sm font-black uppercase text-amber-300">
                  Manual Barrier Override Audit
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOverrideModal(null)}
                className="text-white/40 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-200">
              This action will be logged in the <strong>Barrier Audit Log</strong> under your staff account to ensure transparency and accountability.
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[10px] font-bold uppercase text-white/50 block mb-1">
                  Gate & License Plate
                </label>
                <div className="rounded-lg bg-black/50 border border-white/10 px-3 py-2 flex justify-between font-mono text-white">
                  <span>{overrideModal.gate === 'ENTRY_1' ? 'Entry Gate (ENTRY_1)' : 'Exit Gate (EXIT_1)'}</span>
                  <span className="font-bold text-amber-300">{overrideModal.plate || 'NO_PLATE'}</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-white/50 block mb-1">
                  Override Reason <span className="text-red-400">*</span>
                </label>
                <select
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="OCR_ERROR">OCR Recognition Error / Obscured Plate</option>
                  <option value="EMERGENCY">Emergency Vehicle (Fire, Ambulance, Police)</option>
                  <option value="CASH_PAID_EXTERNAL">Cash Collected Manually / Offline</option>
                  <option value="TRAFFIC_JAM">Traffic Congestion Relief</option>
                  <option value="SYSTEM_MAINTENANCE">Hardware Maintenance / Equipment Test</option>
                  <option value="OTHER">Other Reason</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-white/50 block mb-1">
                  Detailed Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  placeholder="Enter incident details (e.g. mud on plate, regular visitor, sensor glitch...)"
                  className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setOverrideModal(null)}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-white hover:bg-white/10 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const modal = overrideModal;
                  setOverrideModal(null);
                  await triggerBarrier(
                    modal.action,
                    modal.gate,
                    modal.plate,
                    modal.slot,
                    overrideReason,
                    overrideNotes
                  );
                  setOverrideNotes('');
                }}
                className="flex-1 rounded-xl bg-amber-400 py-2.5 text-xs font-black text-black hover:bg-amber-300 transition shadow-lg shadow-amber-400/20"
              >
                Confirm & Open Barrier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          AI PLATE RESOLUTION MODAL (INTEGRATED)
      ═══════════════════════════════════════════════════════════════════════ */}
      <AIPlateResolutionModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        onSelectPlate={handleSelectAiPlate}
        initialPlate={aiModalInitialPlate}
        initialImage={aiModalInitialImage}
      />
    </div>
  );
}
