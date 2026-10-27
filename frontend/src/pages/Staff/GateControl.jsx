import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera, Car, ShieldCheck, Sparkles, RefreshCw, CheckCircle2,
  AlertTriangle, ArrowRight, DollarSign, QrCode, Lock, Unlock,
  Pause, Play, Activity, Radio, Clock, User, Zap, ChevronRight,
  Upload, Eye, AlertCircle, Check, Loader2, Maximize2
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { API_BASE } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { getAllFloors } from '../../services/parkingFloorService';
import { normalizeLicensePlate } from '../../utils/licensePlate';
import AIPlateResolutionModal from './components/AIPlateResolutionModal';
import './components/staffGateControl.css';
import { STAFF_THEME } from './components/staffTheme';

export default function GateControl() {
  const socket = useSocket();

  // ─── HARDWARE & BARRIER STATE ───
  const [gatesState, setGatesState] = useState({
    ENTRY_1: { open: false, holdOpen: false, gate: 'ENTRY_1', licensePlate: '', timestamp: Date.now() },
    EXIT_1: { open: false, holdOpen: false, gate: 'EXIT_1', licensePlate: '', timestamp: Date.now() }
  });
  const [isEspOnline, setIsEspOnline] = useState(true);
  const [autoPilot, setAutoPilot] = useState(false);
  const [floors, setFloors] = useState([]);
  const [activeSessionsList, setActiveSessionsList] = useState([]);

  // ─── ENTRY LANE STATE ───
  const [entryPlate, setEntryPlate] = useState('');
  const [entryPhone, setEntryPhone] = useState('');
  const [entryVehicleType, setEntryVehicleType] = useState('car');
  const [entryFloorId, setEntryFloorId] = useState('');
  const [entrySlotCode, setEntrySlotCode] = useState('');
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [entryVerifyData, setEntryVerifyData] = useState(null);
  const [isEntryScanning, setIsEntryScanning] = useState(false);
  const [isEntryCheckingIn, setIsEntryCheckingIn] = useState(false);
  const [entryCameraActive, setEntryCameraActive] = useState(true);

  // ─── EXIT LANE STATE ───
  const [exitPlate, setExitPlate] = useState('');
  const [exitSnapshot, setExitSnapshot] = useState(null);
  const [exitInvoiceData, setExitInvoiceData] = useState(null);
  const [isExitScanning, setIsExitScanning] = useState(false);
  const [isExitCheckingOut, setIsExitCheckingOut] = useState(false);
  const [exitCameraActive, setExitCameraActive] = useState(true);
  const [cashReceived, setCashReceived] = useState(false);

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

  // ─── 1. FETCH STATUS VÀ SOCKET LẮNG NGHE ───
  const fetchBarrierStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/iot/barrier-status`);
      const data = await res.json();
      if (data.success && data.gates) {
        setGatesState(prev => ({ ...prev, ...data.gates }));
        setIsEspOnline(true);
      }
    } catch {
      setIsEspOnline(false);
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

    try {
      const token = localStorage.getItem('accessToken');
      const sessRes = await fetch(`${API_BASE}/sessions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await sessRes.json();
      if (data.success && Array.isArray(data.data)) {
        setActiveSessionsList(data.data.filter(s => s.status === 'active'));
      }
    } catch (e) {
      console.error('Error fetching sessions:', e);
    }
  }, [entryFloorId]);

  useEffect(() => {
    fetchBarrierStatus();
    fetchFloorsAndSessions();
    const interval = setInterval(fetchBarrierStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchBarrierStatus, fetchFloorsAndSessions]);

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

  // ─── MULTI-CAMERA DEVICE ENUMERATION ───
  const [availableCameras, setAvailableCameras] = useState([]);
  const [entryDeviceId, setEntryDeviceId] = useState(() => localStorage.getItem('valo_entry_cam') || '');
  const [exitDeviceId, setExitDeviceId] = useState(() => localStorage.getItem('valo_exit_cam') || '');

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

  // ─── 2. WEBCAM STREAM CONTROLLERS ───
  const startCamera = async (lane, deviceId = null) => {
    try {
      const targetDeviceId = deviceId || (lane === 'entry' ? entryDeviceId : exitDeviceId);
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(targetDeviceId ? { deviceId: { exact: targetDeviceId } } : { facingMode: 'environment' })
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (lane === 'entry') {
        if (entryStreamRef.current) entryStreamRef.current.getTracks().forEach(t => t.stop());
        if (entryVideoRef.current) entryVideoRef.current.srcObject = stream;
        entryStreamRef.current = stream;
        setEntryCameraActive(true);
      } else {
        if (exitStreamRef.current) exitStreamRef.current.getTracks().forEach(t => t.stop());
        if (exitVideoRef.current) exitVideoRef.current.srcObject = stream;
        exitStreamRef.current = stream;
        setExitCameraActive(true);
      }
    } catch (err) {
      console.warn(`Camera for ${lane} not available:`, err);
      if (lane === 'entry') setEntryCameraActive(false);
      else setExitCameraActive(false);
    }
  };

  const stopCamera = (lane) => {
    if (lane === 'entry' && entryStreamRef.current) {
      entryStreamRef.current.getTracks().forEach(t => t.stop());
      entryStreamRef.current = null;
      setEntryCameraActive(false);
    } else if (lane === 'exit' && exitStreamRef.current) {
      exitStreamRef.current.getTracks().forEach(t => t.stop());
      exitStreamRef.current = null;
      setExitCameraActive(false);
    }
  };

  useEffect(() => {
    enumerateAllCameras();
  }, [enumerateAllCameras]);

  useEffect(() => {
    startCamera('entry', entryDeviceId);
  }, [entryDeviceId]);

  useEffect(() => {
    startCamera('exit', exitDeviceId);
  }, [exitDeviceId]);

  const captureFrame = (lane) => {
    const video = lane === 'entry' ? entryVideoRef.current : exitVideoRef.current;
    const canvas = lane === 'entry' ? entryCanvasRef.current : exitCanvasRef.current;
    if (!video || !canvas) return null;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    if (lane === 'entry') setEntrySnapshot(dataUrl);
    else setExitSnapshot(dataUrl);

    return dataUrl;
  };

  // ─── 3. LÀN VÀO (ENTRY ACTIONS) ───
  const handleEntryScanPlate = async (manualImage = null) => {
    const imageToScan = manualImage || captureFrame('entry');
    if (!imageToScan) {
      toast.error('Allow camera access or upload an image to scan.');
      return;
    }

    setIsEntryScanning(true);
    try {
      // 1. Quét AI OCR
      const scanRes = await fetch(`${API_BASE}/ai/scan-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageToScan })
      });
      const scanData = await scanRes.json();

      let detectedPlate = '';
      if (scanData.success && scanData.data?.licensePlate) {
        detectedPlate = normalizeLicensePlate(scanData.data.licensePlate);
        setEntryPlate(detectedPlate);
        toast.success(`Detected license plate: ${detectedPlate}`);
      } else {
        toast.error('The plate could not be read clearly. Enter it manually or use AI Plate Assistant.');
      }

      if (detectedPlate) {
        await verifyEntryPlate(detectedPlate);
      }
    } catch (err) {
      console.error('Scan plate error:', err);
      toast.error('License plate scan failed.');
    } finally {
      setIsEntryScanning(false);
    }
  };

  const verifyEntryPlate = async (plateToCheck) => {
    const cleanPlate = normalizeLicensePlate(plateToCheck || entryPlate);
    if (!cleanPlate) return;

    try {
      const res = await fetch(`${API_BASE}/sessions/verify-plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licensePlate: cleanPlate })
      });
      const data = await res.json();
      if (data.success && data.data) {
        const v = data.data;
        setEntryVerifyData(v);
        if (v.phone) setEntryPhone(v.phone);
        if (v.assignedSlot) setEntrySlotCode(v.assignedSlot);
        if (v.assignedFloorId) setEntryFloorId(v.assignedFloorId);

        if (v.isActive) {
          toast.error('This vehicle already has an active parking session.');
        } else if (v.isMonthly) {
          toast.success(`Valid VIP membership (${v.membershipType || 'Monthly Pass'}).`);
          if (autoPilot) {
            handleEntryCheckIn(cleanPlate, v);
          }
        } else if (v.hasPreBooking) {
          toast.success(`Existing reservation for slot [${v.assignedSlot || 'Unassigned'}]`);
          if (autoPilot) {
            handleEntryCheckIn(cleanPlate, v);
          }
        } else {
          toast(`Valid walk-in vehicle. Please select a parking slot.`);
        }
      }
    } catch (e) {
      console.error('Verify plate error:', e);
    }
  };

  const handleEntryCheckIn = async (overridePlate = null, overrideVerify = null) => {
    const plate = overridePlate || normalizeLicensePlate(entryPlate);
    const verify = overrideVerify || entryVerifyData;

    if (!plate) {
      toast.error('Enter or scan the entry license plate.');
      return;
    }

    setIsEntryCheckingIn(true);
    try {
      const res = await fetch(`${API_BASE}/sessions/kiosk-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licensePlate: plate,
          phone: entryPhone || verify?.phone || '',
          vehicleType: entryVehicleType,
          parkingSlot: entrySlotCode || verify?.assignedSlot || 'A-01',
          floorId: entryFloorId || verify?.assignedFloorId || (floors[0]?._id),
          durationHours: 2,
          entryImageBase64: entrySnapshot || null,
          entryCamera: 'CAM_GATE_ENTRY_01',
          entryGate: 'ENTRY_1'
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Check-in successful for ${plate}. Opening the entry barrier...`);
        // Kích hoạt mở Barrier Làn vào
        await triggerBarrier('open', 'ENTRY_1', plate, entrySlotCode);
        // Reset form
        setEntryPlate('');
        setEntryPhone('');
        setEntryVerifyData(null);
        setEntrySnapshot(null);
        fetchFloorsAndSessions();
      } else {
        toast.error(data.message || 'Check-in failed.');
      }
    } catch (err) {
      console.error('Check-in error:', err);
      toast.error('Unable to connect to the server.');
    } finally {
      setIsEntryCheckingIn(false);
    }
  };

  // ─── 4. LÀN RA (EXIT ACTIONS) ───
  const handleExitScanPlate = async (manualImage = null) => {
    const imageToScan = manualImage || captureFrame('exit');
    if (!imageToScan) {
      toast.error('Allow camera access or upload an image.');
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
      if (scanData.success && scanData.data?.licensePlate) {
        detectedPlate = normalizeLicensePlate(scanData.data.licensePlate);
        setExitPlate(detectedPlate);
        toast.success(`Detected exit license plate: ${detectedPlate}`);
      } else {
        toast.error('The exit plate could not be read clearly. Enter it manually or use AI Plate Assistant.');
      }

      if (detectedPlate) {
        await lookupExitSession(detectedPlate);
      }
    } catch (err) {
      console.error('Exit scan plate error:', err);
      toast.error('Exit license plate scan failed.');
    } finally {
      setIsExitScanning(false);
    }
  };

  const lookupExitSession = async (plateToLookup) => {
    const cleanPlate = normalizeLicensePlate(plateToLookup || exitPlate);
    if (!cleanPlate) return;

    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/sessions/kiosk-exit-scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ licensePlate: cleanPlate })
      });
      const data = await res.json();
      if (data.success) {
        setExitInvoiceData(data);
        setCashReceived(false);
        toast.success(`Parking session found for ${cleanPlate}`);

        // Nếu là VIP miễn phí hoặc tổng tiền = 0 và đang bật Auto-Pilot
        if (autoPilot && data.totalAmount === 0) {
          handleExitCheckOut(data);
        }
      } else {
        setExitInvoiceData(null);
        toast.error(data.message || 'No active parking session found.');
      }
    } catch (e) {
      console.error('Lookup exit session error:', e);
      toast.error('Parking session lookup failed.');
    }
  };

  const handleExitCheckOut = async (overrideInvoice = null) => {
    const inv = overrideInvoice || exitInvoiceData;
    if (!inv || !inv.session) {
      toast.error('Select a parking session before checking out.');
      return;
    }

    setIsExitCheckingOut(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/sessions/kiosk-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          sessionId: inv.session._id,
          exitImageBase64: exitSnapshot || null,
          paymentMethod: cashReceived ? 'CASH' : 'PAYOS',
          exitCamera: 'CAM_GATE_EXIT_01',
          exitGate: 'EXIT_1'
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Check-out successful for ${inv.session.licensePlate}. Opening the exit barrier...`);
        // Mở Barrier Làn ra
        await triggerBarrier('open', 'EXIT_1', inv.session.licensePlate);
        // Reset form
        setExitPlate('');
        setExitInvoiceData(null);
        setExitSnapshot(null);
        setCashReceived(false);
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
  const triggerBarrier = async (action, gate = 'ENTRY_1', plate = '', slot = '') => {
    try {
      let endpoint = '/iot/open-barrier';
      let payload = { gate, licensePlate: plate || 'STAFF-OVERRIDE', slotCode: slot };

      if (action === 'hold') {
        endpoint = '/iot/hold-barrier';
        payload = { gate, hold: !gatesState[gate]?.holdOpen };
      } else if (action === 'close') {
        endpoint = '/iot/close-barrier';
        payload = { gate };
      }

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${action.toUpperCase()} command sent successfully to gate ${gate}.`);
        fetchBarrierStatus();
      }
    } catch (e) {
      console.error('Barrier command error:', e);
      toast.error(`Unable to send a barrier command to gate ${gate}`);
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
    toast.success(`License plate selected from AI Plate Assistant: ${selectedPlate}`);
  };

  // Format Helpers
  const formatCurrency = (val) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(val || 0));
  const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');

  return (
    <div className={`staff-gate-control p-4 sm:p-6 lg:p-8 ${STAFF_THEME.page}`}>
      <Toaster position="top-right" />

      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER & STATUS BAR
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="sgc-header mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="sgc-title-line flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-[#ffd555]">
              Gate Control & Camera Stations
            </h1>
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-xs font-bold text-emerald-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              LIVE TELEMETRY
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-white/45">
            Monitor entry and exit lanes, verify license plates, and manage barrier operations in real time.
          </p>
        </div>

        {/* Hardware badges & Global Mode */}
        <div className="sgc-status-controls flex flex-wrap items-center gap-2 sm:gap-3">
          {/* ESP32 Status */}
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#111111] px-3.5 py-2">
            <Radio size={15} className={isEspOnline ? 'text-emerald-400 animate-pulse' : 'text-red-400'} />
            <div className="text-left">
              <p className="text-[9px] font-black uppercase tracking-wider text-white/40">ESP32 GATE BRIDGE</p>
              <p className="text-xs font-bold text-white">{isEspOnline ? 'ONLINE (115200 BAUD)' : 'DISCONNECTED'}</p>
            </div>
          </div>

          {/* Auto-pilot toggle */}
          <button
            type="button"
            onClick={() => {
              setAutoPilot(!autoPilot);
              toast(autoPilot ? 'Switched to manual confirmation mode.' : 'Auto-Pilot enabled: barriers open automatically for valid VIP memberships and reservations.');
            }}
            data-enabled={autoPilot}
            className={`sgc-autopilot flex items-center gap-2 rounded-xl border px-3.5 py-2 font-bold text-xs transition ${
              autoPilot
                ? 'border-[#ffd555] bg-[#ffd555]/20 text-[#ffd555] shadow-lg shadow-yellow-500/10'
                : 'border-white/10 bg-[#111111] text-white/60 hover:text-white'
            }`}
          >
            <Zap size={15} className={autoPilot ? 'fill-[#ffd555] text-[#ffd555]' : 'text-gray-400'} />
            <span>Auto-Pilot {autoPilot ? 'ON' : 'OFF'}</span>
          </button>

          {/* Emergency Open All */}
          <button
            type="button"
            onClick={() => {
              triggerBarrier('open', 'ENTRY_1', 'EMERGENCY_OPEN');
              triggerBarrier('open', 'EXIT_1', 'EMERGENCY_OPEN');
              toast.success('Emergency open commands sent to all barriers.');
            }}
            className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2 font-bold text-xs text-red-300 hover:bg-red-500 hover:text-white transition shadow-lg shadow-red-500/10"
          >
            <AlertTriangle size={15} />
            <span>Emergency Open</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          DUAL-LANE SPLIT SCREEN (LÀN VÀO & LÀN RA)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="sgc-stations grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* ──────────────────────────────────────────────────────────────────
            CỘT TRÁI: LÀN VÀO (ENTRY LANE - ENTRY_1)
        ────────────────────────────────────────────────────────────────── */}
        <div className="sgc-station flex flex-col rounded-2xl border border-emerald-500/20 bg-[#111111] p-5 shadow-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute -top-12 -left-12 h-36 w-36 rounded-full bg-emerald-500/10 blur-3xl" />

          {/* Lane Header */}
          <div className="sgc-station-header mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Car size={18} />
              </div>
              <div>
                <h2 className="text-base font-black uppercase tracking-wider text-emerald-400">
                  Entry Lane (Entry Station - ENTRY_1)
                </h2>
                <p className="text-[10px] text-white/40">License plate recognition & parking assignment</p>
              </div>
            </div>

            {/* Barrier status badge */}
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase border ${
                gatesState.ENTRY_1?.open
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-red-500/20 text-red-300 border-red-500/40'
              }`}>
                {gatesState.ENTRY_1?.open ? <Unlock size={11} /> : <Lock size={11} />}
                Barrier: {gatesState.ENTRY_1?.open ? 'Open' : 'Closed'}
              </span>
            </div>
          </div>

          {/* Live Camera Feed or Snapshot Preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/15 bg-black">
            <video
              ref={entryVideoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${entrySnapshot ? 'hidden' : 'block'}`}
            />
            {entrySnapshot && (
              <img
                src={entrySnapshot}
                alt="Entry Snapshot"
                className="h-full w-full object-cover"
              />
            )}
            <canvas ref={entryCanvasRef} className="hidden" />

            {/* Bounding Box Guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-28 w-64 rounded-lg border-2 border-dashed border-emerald-400/50 bg-emerald-400/5 flex flex-col items-center justify-center text-center p-2">
                <span className="text-[10px] font-bold text-emerald-300 drop-shadow">Entry Plate Detection Area</span>
              </div>
            </div>

            {/* Camera Overlay Controls */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-lg bg-black/70 backdrop-blur-md px-3 py-1.5 border border-white/10 gap-2">
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
                  className="bg-transparent text-[10px] font-mono text-white/90 border-0 focus:outline-none cursor-pointer truncate max-w-[170px]"
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
                    <span>Camera Live</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleEntryScanPlate()}
                    disabled={isEntryScanning}
                    className="flex items-center gap-1 rounded bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-black hover:bg-emerald-400"
                  >
                    {isEntryScanning ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                    <span>Capture & Scan</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Upload Test Option */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/40 px-1">
            <span>Or upload an image:</span>
            <label className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer font-semibold">
              <Upload size={12} />
              <span>Upload Vehicle Image</span>
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
          <div className="sgc-vehicle-fields mt-4 space-y-3 rounded-xl border border-white/10 bg-[#161618] p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase text-white/40">Detected License Plate</label>
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={entryPlate}
                    onChange={(e) => setEntryPlate(e.target.value.toUpperCase())}
                    onBlur={() => entryPlate && verifyEntryPlate(entryPlate)}
                    placeholder="e.g. 51K-889.99"
                    className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-black tracking-wider text-emerald-400 placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-white/40">Phone Number</label>
                <input
                  type="text"
                  value={entryPhone}
                  onChange={(e) => setEntryPhone(e.target.value)}
                  placeholder="Customer phone number (optional)"
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-medium text-white placeholder:text-white/20 focus:border-emerald-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Classification & Verification Alert */}
            {entryVerifyData && (
              <div className={`p-3 rounded-lg border flex items-start gap-2.5 ${
                entryVerifyData.isActive
                  ? 'bg-red-500/10 border-red-500/30 text-red-300'
                  : entryVerifyData.isMonthly
                  ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                  : entryVerifyData.hasPreBooking
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}>
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-bold">
                    {entryVerifyData.isActive
                      ? 'Warning: Vehicle already parked.'
                      : entryVerifyData.isMonthly
                      ? `VIP customer: ${entryVerifyData.membershipType || 'Monthly Pass'}`
                      : entryVerifyData.hasPreBooking
                      ? `Reserved customer (Booking ${entryVerifyData.bookingId || ''})`
                      : 'Valid walk-in vehicle'}
                  </p>
                  <p className="text-[10px] opacity-80 mt-0.5">
                    {entryVerifyData.assignedSlot
                      ? `Assigned space: Floor ${entryVerifyData.assignedFloorName || '1'} - Slot ${entryVerifyData.assignedSlot}`
                      : 'No fixed space assigned. The system will select an available slot.'}
                  </p>
                </div>
              </div>
            )}

            {/* Slot & Floor Assignment */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[10px] font-black uppercase text-white/40">Parking Floor</label>
                <select
                  value={entryFloorId}
                  onChange={(e) => setEntryFloorId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold text-white focus:outline-none"
                >
                  {floors.map(f => (
                    <option key={f._id} value={f._id}>Floor {f.floorNumber} - {f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-white/40">Parking Slot</label>
                <input
                  type="text"
                  value={entrySlotCode}
                  onChange={(e) => setEntrySlotCode(e.target.value.toUpperCase())}
                  placeholder="e.g. A-01, B-04"
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-xs font-bold text-emerald-400 uppercase placeholder:text-white/20 focus:outline-none"
                />
              </div>
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
                className="sgc-ai-action flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-400/20 to-yellow-500/20 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition"
              >
                <Sparkles size={14} className="text-amber-400" />
                <span>AI Plate Assistant</span>
              </button>

              <button
                type="button"
                onClick={() => handleEntryCheckIn()}
                disabled={isEntryCheckingIn || !entryPlate}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400 disabled:opacity-50 transition shadow-lg shadow-emerald-500/20"
              >
                {isEntryCheckingIn ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                <span>Check In & Open Gate</span>
              </button>
            </div>

            {/* Manual Barrier Override (Entry) */}
            <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => triggerBarrier('open', 'ENTRY_1', entryPlate || 'MANUAL_ENTRY')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Unlock size={12} className="text-emerald-400" />
                <span>Open Entry Barrier</span>
              </button>

              <button
                type="button"
                onClick={() => triggerBarrier('hold', 'ENTRY_1')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Pause size={12} className="text-yellow-400" />
                <span>Pause</span>
              </button>

              <button
                type="button"
                onClick={() => triggerBarrier('close', 'ENTRY_1')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Lock size={12} className="text-red-400" />
                <span>Lock Barrier</span>
              </button>
            </div>
          </div>
        </div>


        {/* ──────────────────────────────────────────────────────────────────
            CỘT PHẢI: LÀN RA (EXIT LANE - EXIT_1)
        ────────────────────────────────────────────────────────────────── */}
        <div className="sgc-station flex flex-col rounded-2xl border border-sky-500/20 bg-[#111111] p-5 shadow-2xl relative overflow-hidden">
          <div className="pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full bg-sky-500/10 blur-3xl" />

          {/* Lane Header */}
          <div className="sgc-station-header mb-4 flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30">
                <Car size={18} />
              </div>
              <div>
                <h2 className="text-base font-black uppercase tracking-wider text-sky-400">
                  Exit Lane (Exit Station - EXIT_1)
                </h2>
                <p className="text-[10px] text-white/40">Entry/exit verification & parking fee collection</p>
              </div>
            </div>

            {/* Barrier status badge */}
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase border ${
                gatesState.EXIT_1?.open
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-red-500/20 text-red-300 border-red-500/40'
              }`}>
                {gatesState.EXIT_1?.open ? <Unlock size={11} /> : <Lock size={11} />}
                Barrier: {gatesState.EXIT_1?.open ? 'Open' : 'Closed'}
              </span>
            </div>
          </div>

          {/* Live Camera Feed or Snapshot Preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/15 bg-black">
            <video
              ref={exitVideoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${exitSnapshot ? 'hidden' : 'block'}`}
            />
            {exitSnapshot && (
              <img
                src={exitSnapshot}
                alt="Exit Snapshot"
                className="h-full w-full object-cover"
              />
            )}
            <canvas ref={exitCanvasRef} className="hidden" />

            {/* Bounding Box Guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-28 w-64 rounded-lg border-2 border-dashed border-sky-400/50 bg-sky-400/5 flex flex-col items-center justify-center text-center p-2">
                <span className="text-[10px] font-bold text-sky-300 drop-shadow">Exit Plate Detection Area</span>
              </div>
            </div>

            {/* Camera Overlay Controls */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-lg bg-black/70 backdrop-blur-md px-3 py-1.5 border border-white/10 gap-2">
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
                  className="bg-transparent text-[10px] font-mono text-white/90 border-0 focus:outline-none cursor-pointer truncate max-w-[170px]"
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
                    <span>Camera Live</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleExitScanPlate()}
                    disabled={isExitScanning}
                    className="flex items-center gap-1 rounded bg-sky-500 px-2.5 py-1 text-[10px] font-bold text-black hover:bg-sky-400"
                  >
                    {isExitScanning ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                    <span>Capture & Scan</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Select from Active Sessions in Lot */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/40 px-1">
            <span>Or select a parked vehicle:</span>
            <select
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  setExitPlate(val);
                  lookupExitSession(val);
                }
              }}
              className="bg-black/60 text-sky-400 border border-white/15 rounded px-2 py-0.5 text-[10px] font-bold focus:outline-none"
            >
              <option value="">-- Parked Vehicles ({activeSessionsList.length}) --</option>
              {activeSessionsList.map(s => (
                <option key={s._id} value={s.licensePlate}>{s.licensePlate} ({s.parkingSlot || 'Unassigned'})</option>
              ))}
            </select>
          </div>

          {/* Security Double-Check (Side-by-Side Images) */}
          {exitInvoiceData && (
            <div className="sgc-invoice mt-4 rounded-xl border border-white/10 bg-[#161618] p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-sky-400 flex items-center gap-1">
                  <ShieldCheck size={13} />
                  Security Double-Check
                </span>
                <span className="text-[10px] font-bold text-white/50">License Plate: {exitInvoiceData.session?.licensePlate}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/10 bg-black/40 p-1 text-center">
                  <p className="text-[9px] font-bold text-emerald-400 mb-1">Entry Image (Check-in)</p>
                  <div className="aspect-video w-full overflow-hidden rounded bg-black flex items-center justify-center">
                    {exitInvoiceData.session?.entryImage ? (
                      <img src={exitInvoiceData.session.entryImage} alt="Entry" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-white/30">No entry image</span>
                    )}
                  </div>
                  <p className="text-[9px] text-white/40 mt-1">{formatDate(exitInvoiceData.session?.checkInTime)}</p>
                </div>

                <div className="rounded-lg border border-white/10 bg-black/40 p-1 text-center">
                  <p className="text-[9px] font-bold text-sky-400 mb-1">Exit Image (Check-out)</p>
                  <div className="aspect-video w-full overflow-hidden rounded bg-black flex items-center justify-center">
                    {exitSnapshot ? (
                      <img src={exitSnapshot} alt="Exit" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-white/30">Camera Ra</span>
                    )}
                  </div>
                  <p className="text-[9px] text-white/40 mt-1">Now</p>
                </div>
              </div>

              {/* Invoice Breakdown */}
              <div className="rounded-lg bg-black/60 p-3 text-xs space-y-1.5 border border-white/5">
                <div className="flex justify-between text-white/60">
                  <span>Parking Duration:</span>
                  <span className="font-bold text-white">{exitInvoiceData.durationFormatted || '2 hours'}</span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>Session Type:</span>
                  <span className="font-bold text-white">{exitInvoiceData.session?.type || 'STANDARD'}</span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>Parking Fee:</span>
                  <span className="font-mono text-white">{formatCurrency(exitInvoiceData.parkingFee || 0)}</span>
                </div>
                <div className="border-t border-white/10 pt-1.5 flex justify-between items-center">
                  <span className="font-black text-white">Total Due:</span>
                  <span className="text-base font-black text-[#ffd555] font-mono">
                    {formatCurrency(exitInvoiceData.totalAmount || 0)}
                  </span>
                </div>
              </div>

              {/* Cash Paid Confirmation Checkbox */}
              {exitInvoiceData.totalAmount > 0 && (
                <label className="flex items-center gap-2 p-2.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 cursor-pointer text-xs font-bold text-yellow-300">
                  <input
                    type="checkbox"
                    checked={cashReceived}
                    onChange={(e) => setCashReceived(e.target.checked)}
                    className="h-4 w-4 rounded border-yellow-400 text-yellow-500 focus:ring-0"
                  />
                  <span>Cash payment received from the customer</span>
                </label>
              )}
            </div>
          )}

          {/* Exit Action Buttons */}
          <div className="mt-4 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setAiTargetLane('exit');
                  setAiModalInitialPlate(exitPlate);
                  setAiModalInitialImage(exitSnapshot);
                  setShowAiModal(true);
                }}
                className="sgc-ai-action flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-400/20 to-yellow-500/20 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition"
              >
                <Sparkles size={14} className="text-amber-400" />
                <span>AI Plate Assistant</span>
              </button>

              <button
                type="button"
                onClick={() => handleExitCheckOut()}
                disabled={isExitCheckingOut || !exitInvoiceData}
                className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 py-2.5 text-xs font-black text-black hover:bg-sky-400 disabled:opacity-50 transition shadow-lg shadow-sky-500/20"
              >
                {isExitCheckingOut ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>Check Out & Open Gate</span>
              </button>
            </div>

            {/* Manual Barrier Override (Exit) */}
            <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => triggerBarrier('open', 'EXIT_1', exitPlate || 'MANUAL_EXIT')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Unlock size={12} className="text-sky-400" />
                <span>Open Exit Barrier</span>
              </button>

              <button
                type="button"
                onClick={() => triggerBarrier('hold', 'EXIT_1')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Pause size={12} className="text-yellow-400" />
                <span>Pause</span>
              </button>

              <button
                type="button"
                onClick={() => triggerBarrier('close', 'EXIT_1')}
                className="flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 py-2 text-[11px] font-bold text-white hover:bg-white/10"
              >
                <Lock size={12} className="text-red-400" />
                <span>Lock Barrier</span>
              </button>
            </div>
          </div>
        </div>

      </div>

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
