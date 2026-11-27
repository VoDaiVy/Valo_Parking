import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Camera, Car, ShieldCheck, RefreshCw,
  AlertTriangle, Lock, Unlock,
  Pause, Activity, Radio,
  Upload, AlertCircle, Loader2, Maximize2,
  RotateCw, ArrowLeftRight, ScanLine, SlidersHorizontal, ZoomIn, ZoomOut, X
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { API_BASE, apiFetch } from '../../services/api';
import { useSocket } from '../../hooks/useSocket';
import { useGateCameraConfig } from '../../hooks/useGateCameraConfig';
import { getAllFloors } from '../../services/parkingFloorService';
import { getAllSessions, getActiveSessions } from '../../services/sessionService';
import { normalizeLicensePlate, formatLicensePlateDisplay } from '../../utils/licensePlate';
import {
  captureVideoLaneBase64,
  computeLaneFrameSignature,
  hasLaneMotionChanged,
  resolveLaneTransform,
} from '../../utils/cameraLaneCapture';
import LaneCameraPreview from '../../components/LaneCameraPreview';
import AIPlateResolutionModal from './components/AIPlateResolutionModal';
import BarrierAuditLogsModal from './components/BarrierAuditLogsModal';
import { EntryLaneConsole, ExitLaneConsole } from './components/GateLaneConsoles';
import { useEntryLaneController, useExitLaneController } from './components/useGateLaneControllers';
import { STAFF_THEME } from './components/staffTheme';

export default function GateControl() {
  const { t } = useTranslation();
  const socket = useSocket();

  // ─── HARDWARE & BARRIER STATE ───
  const [gatesState, setGatesState] = useState({
    ENTRY_1: { open: false, holdOpen: false, gate: 'ENTRY_1', licensePlate: '', timestamp: 0 },
    EXIT_1: { open: false, holdOpen: false, gate: 'EXIT_1', licensePlate: '', timestamp: 0 }
  });
  const [laneMode, setLaneMode] = useState('STANDARD'); // 'STANDARD' | 'PEAK_ENTRY' | 'PEAK_EXIT'
  const [isSwitchingLaneMode, setIsSwitchingLaneMode] = useState(false);
  const [isEspOnline, setIsEspOnline] = useState(false);
  const [isBridgeRunning, setIsBridgeRunning] = useState(false);
  const [showCameraSetup, setShowCameraSetup] = useState(false);
  const [expandedCamera, setExpandedCamera] = useState(null); // 'entry' | 'exit' | null
  const [previewPhotoModal, setPreviewPhotoModal] = useState(null); // { title, image, time, plate, type }
  const [modalZoom, setModalZoom] = useState(1);
  const [floors, setFloors] = useState([]);
  const [activeSessionsList, setActiveSessionsList] = useState([]);

  // ─── CAMERA SNAPSHOT & STREAM STATE ───
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [entryCameraActive, setEntryCameraActive] = useState(true);
  const [exitSnapshot, setExitSnapshot] = useState(null);
  const [exitCameraActive, setExitCameraActive] = useState(true);

  // ─── BARRIER OVERRIDE AUDIT MODAL ───
  const [overrideModal, setOverrideModal] = useState(null); // { action, gate, plate, slot }
  const [overrideReason, setOverrideReason] = useState('OCR_ERROR');
  const [overrideNotes, setOverrideNotes] = useState('');
  const [showBarrierLogsModal, setShowBarrierLogsModal] = useState(false);

  // ─── AI RESOLUTION MODAL STATE ───
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiTargetStation, setAiTargetStation] = useState('ENTRY_1'); // 'ENTRY_1' | 'EXIT_1'
  const [aiModalInitialPlate, setAiModalInitialPlate] = useState('');
  const [aiModalInitialImage, setAiModalInitialImage] = useState(null);

  // Effective directional roles per physical station
  const leftRole = laneMode === 'PEAK_EXIT' ? 'exit' : 'entry';
  const rightRole = laneMode === 'PEAK_ENTRY' ? 'entry' : 'exit';

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
        if (data.laneMode) {
          setLaneMode(data.laneMode);
        }
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
      }
    } catch (e) {
      console.error('Error fetching floors:', e);
    }

    await refreshActiveSessions();
  }, [refreshActiveSessions]);

  useEffect(() => {
    const initialTimer = setTimeout(() => {
      fetchBarrierStatus();
      fetchFloorsAndSessions();
    }, 0);
    const interval = setInterval(() => {
      fetchBarrierStatus();
      refreshActiveSessions();
    }, 3000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
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

    const handleLaneModeChanged = (data) => {
      if (data?.mode) {
        setLaneMode(data.mode);
        const modeLabel = data.mode === 'PEAK_ENTRY' ? '2 IN' : data.mode === 'PEAK_EXIT' ? '2 OUT' : '1 IN / 1 OUT';
        toast.success(`Lane flow updated: ${modeLabel}`, { id: 'lane-mode-toast' });
      }
    };

    socket.on('gate:barrier_control', handleBarrierControl);
    socket.on('gate:lane_mode_changed', handleLaneModeChanged);
    return () => {
      socket.off('gate:barrier_control', handleBarrierControl);
      socket.off('gate:lane_mode_changed', handleLaneModeChanged);
    };
  }, [socket]);

  const handleSwitchLaneMode = async (targetMode) => {
    if (targetMode === laneMode || isSwitchingLaneMode) return;
    setIsSwitchingLaneMode(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/iot/lane-mode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode: targetMode }),
      });
      const data = await res.json();
      if (data.success) {
        setLaneMode(data.mode);
        const modeLabel = data.mode === 'PEAK_ENTRY' ? '2 IN' : data.mode === 'PEAK_EXIT' ? '2 OUT' : '1 IN / 1 OUT';
        toast.success(`Lane flow set: ${modeLabel}`, { id: 'lane-mode-toast' });
      } else {
        toast.error(data.message || 'Failed to switch lane mode');
      }
    } catch {
      toast.error('Network error switching lane mode');
    } finally {
      setIsSwitchingLaneMode(false);
    }
  };

  // ─── MULTI-CAMERA DEVICE ENUMERATION & SHARED CONFIG ───
  const [availableCameras, setAvailableCameras] = useState([]);
  const [entryDeviceId, setEntryDeviceId] = useState(() => localStorage.getItem('valo_entry_cam') || '');
  const [exitDeviceId, setExitDeviceId] = useState(() => localStorage.getItem('valo_exit_cam') || '');
  // Mặc định BẬT Auto-Scan để hệ thống tự nhận diện xe ở cả Cổng Vào và Cổng Ra
  const [autoScanDual, setAutoScanDual] = useState(() => localStorage.getItem('valo_auto_scan') !== 'false');
  const [camerasReady, setCamerasReady] = useState(false);
  const { cameraConfig, updateCameraConfig } = useGateCameraConfig();
  const cameraConfigRef = useRef(cameraConfig);
  const watchdogsRef = useRef({ entry: null, exit: null });
  const startCameraRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const watchdogs = watchdogsRef.current;
    return () => {
      mountedRef.current = false;
      clearTimeout(watchdogs.entry);
      clearTimeout(watchdogs.exit);
    };
  }, []);

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

  const isBuiltInCameraLabel = (label = '') =>
    /facetime|built-in|integrated|continuity|iphone|ipad|obs|virtual/i.test(label);

  const resolveCameraSelection = useCallback((videoDevices, savedId, savedLabel, fallbackIndex = 0) => {
    if (!videoDevices.length) return '';
    if (savedId && videoDevices.some((d) => d.deviceId === savedId)) {
      return savedId;
    }
    if (savedLabel) {
      const cleanSaved = savedLabel.trim().toLowerCase();
      const byLabel = videoDevices.find(
        (d) => (d.label || '').trim().toLowerCase() === cleanSaved
      );
      if (byLabel) return byLabel.deviceId;
    }
    const externalCams = videoDevices.filter((d) => !isBuiltInCameraLabel(d.label));
    if (externalCams.length > 0) {
      return (externalCams[fallbackIndex] || externalCams[0]).deviceId;
    }
    return (videoDevices[fallbackIndex] || videoDevices[0]).deviceId;
  }, []);

  const syncCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      let devices = await navigator.mediaDevices.enumerateDevices();
      let videoDevices = devices.filter((d) => d.kind === 'videoinput');

      // Nếu trình duyệt chưa có nhãn thiết bị (chưa xin quyền lần nào), xin quyền ngắn để lấy đúng label
      if (videoDevices.length > 0 && videoDevices.every((d) => !d.label)) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          tempStream.getTracks().forEach((t) => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
          videoDevices = devices.filter((d) => d.kind === 'videoinput');
        } catch {
          // Tiếp tục dùng danh sách hiện có nếu chưa cấp quyền
        }
      }

      if (!mountedRef.current) return;
      setAvailableCameras(videoDevices);

      if (videoDevices.length > 0) {
        const savedEntryId = localStorage.getItem('valo_entry_cam') || '';
        const savedEntryLabel = localStorage.getItem('valo_entry_cam_label') || '';
        const nextEntryId = resolveCameraSelection(videoDevices, savedEntryId, savedEntryLabel, 0);
        const nextEntryLabel = videoDevices.find((d) => d.deviceId === nextEntryId)?.label || '';

        const savedExitId = localStorage.getItem('valo_exit_cam') || '';
        const savedExitLabel = localStorage.getItem('valo_exit_cam_label') || '';
        const nextExitId = resolveCameraSelection(videoDevices, savedExitId, savedExitLabel, videoDevices.length > 1 ? 1 : 0);
        const nextExitLabel = videoDevices.find((d) => d.deviceId === nextExitId)?.label || '';

        if (nextEntryId) {
          localStorage.setItem('valo_entry_cam', nextEntryId);
          if (nextEntryLabel) localStorage.setItem('valo_entry_cam_label', nextEntryLabel);
          setEntryDeviceId((prev) => (prev === nextEntryId ? prev : nextEntryId));
        }
        if (nextExitId) {
          localStorage.setItem('valo_exit_cam', nextExitId);
          if (nextExitLabel) localStorage.setItem('valo_exit_cam_label', nextExitLabel);
          setExitDeviceId((prev) => (prev === nextExitId ? prev : nextExitId));
        }
      }
    } catch (e) {
      console.warn('Cannot enumerate cameras:', e);
    } finally {
      if (mountedRef.current) setCamerasReady(true);
    }
  }, [resolveCameraSelection]);

  // ─── 2. WEBCAM STREAM CONTROLLERS (DEDUPLICATED + AUTO-RECOVERY) ───
  const isStreamInUseByOtherLane = (stream, excludingLane) => {
    if (!stream) return false;
    const other = excludingLane === 'entry' ? exitStreamRef.current : entryStreamRef.current;
    return other === stream;
  };

  const isLiveUnmutedStream = (stream) =>
    Boolean(stream && stream.active && stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted));

  const invalidateCameraStream = useCallback((deviceId = '', expectedStream = null) => {
    const key = deviceId || '__default__';
    const target = streamPoolRef.current[key];
    if (target && (!expectedStream || target === expectedStream)) {
      target.getTracks().forEach((t) => t.stop());
      delete streamPoolRef.current[key];
    }
    Object.entries(streamPoolRef.current).forEach(([k, s]) => {
      if (!s || !s.active || s.getVideoTracks().every((t) => t.readyState === 'ended')) {
        delete streamPoolRef.current[k];
      }
    });
  }, []);

  const acquireCameraStream = useCallback(async (targetDeviceId = '') => {
    const key = targetDeviceId || '__default__';
    const cached = streamPoolRef.current[key];
    if (isLiveUnmutedStream(cached)) {
      return cached;
    }
    if (cached) {
      cached.getTracks().forEach((t) => t.stop());
      delete streamPoolRef.current[key];
    }

    if (targetDeviceId) {
      const existingMatch = Object.values(streamPoolRef.current).find((s) =>
        isLiveUnmutedStream(s) &&
        s.getVideoTracks().some((t) => t.getSettings?.().deviceId === targetDeviceId)
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
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 },
          },
          audio: false,
        },
        {
          video: targetDeviceId ? { deviceId: { exact: targetDeviceId } } : true,
          audio: false,
        },
        {
          video: targetDeviceId ? { deviceId: { ideal: targetDeviceId } } : true,
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
      if (track) {
        track.onended = () => {
          if (streamPoolRef.current[key] === stream) {
            delete streamPoolRef.current[key];
          }
        };
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

  const startCamera = useCallback(async (lane, deviceId = null, retryCount = 0) => {
    const targetDeviceId = deviceId || (lane === 'entry' ? entryDeviceId : exitDeviceId);
    clearTimeout(watchdogsRef.current[lane]);

    try {
      const stream = await acquireCameraStream(targetDeviceId);
      if (!mountedRef.current) return;

      const videoEl = lane === 'entry' ? entryVideoRef.current : exitVideoRef.current;
      const streamRef = lane === 'entry' ? entryStreamRef : exitStreamRef;
      const setCamActive = lane === 'entry' ? setEntryCameraActive : setExitCameraActive;

      const prev = streamRef.current;
      streamRef.current = stream;
      if (prev && prev !== stream && !isStreamInUseByOtherLane(prev, lane)) {
        prev.getTracks().forEach((t) => t.stop());
      }

      if (videoEl) {
        if (videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
        }
        await videoEl.play().catch(() => { });
      }
      setCamActive(true);

      // Watchdog: nếu phần cứng webcam chưa đẩy frame thật sau 1.6s, tự reset stream (tối đa 2 lần)
      if (retryCount < 2) {
        watchdogsRef.current[lane] = setTimeout(() => {
          if (!mountedRef.current || streamRef.current !== stream) return;
          const activeVideo = lane === 'entry' ? entryVideoRef.current : exitVideoRef.current;
          const track = stream.getVideoTracks?.()[0];
          const hasValidFrame = Boolean(
            activeVideo &&
            activeVideo.videoWidth > 0 &&
            track &&
            track.readyState === 'live' &&
            !track.muted
          );
          if (!hasValidFrame) {
            if (activeVideo) activeVideo.srcObject = null;
            invalidateCameraStream(targetDeviceId, stream);
            setTimeout(() => {
              if (mountedRef.current) {
                startCameraRef.current?.(lane, targetDeviceId, retryCount + 1);
              }
            }, 250);
          }
        }, 1600);
      }
    } catch (err) {
      console.warn(`Camera for ${lane} not available:`, err);
      if (retryCount < 1) {
        invalidateCameraStream(targetDeviceId);
        watchdogsRef.current[lane] = setTimeout(() => {
          if (mountedRef.current) {
            startCameraRef.current?.(lane, targetDeviceId, retryCount + 1);
          }
        }, 500);
      } else if (mountedRef.current) {
        if (lane === 'entry') setEntryCameraActive(false);
        else setExitCameraActive(false);
      }
    }
  }, [acquireCameraStream, invalidateCameraStream, entryDeviceId, exitDeviceId]);

  useEffect(() => {
    startCameraRef.current = startCamera;
  }, [startCamera]);

  useEffect(() => {
    const initTimer = setTimeout(() => {
      syncCameraDevices();
    }, 0);
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return () => clearTimeout(initTimer);
    }

    const handleDeviceChange = () => {
      syncCameraDevices();
    };
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      clearTimeout(initTimer);
      mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [syncCameraDevices]);

  useEffect(() => {
    if (!camerasReady) return undefined;
    const timer = setTimeout(() => {
      startCamera('entry', entryDeviceId);
      startCamera('exit', exitDeviceId);
    }, 0);
    return () => clearTimeout(timer);
  }, [camerasReady, entryDeviceId, exitDeviceId, startCamera]);

  useEffect(() => {
    const pool = streamPoolRef.current;
    return () => {
      Object.values(pool).forEach((s) => {
        s?.getTracks?.().forEach((t) => t.stop());
      });
    };
  }, []);

  const captureFrame = useCallback((lane) => {
    const video = lane === 'entry' ? entryVideoRef.current : exitVideoRef.current;
    const canvas = lane === 'entry' ? entryCanvasRef.current : exitCanvasRef.current;
    const dataUrl = captureVideoLaneBase64(video, canvas, lane, cameraConfigRef.current);
    if (!dataUrl) return null;

    if (lane === 'entry') setEntrySnapshot(dataUrl);
    else setExitSnapshot(dataUrl);

    return dataUrl;
  }, []);

  // Truyền luồng ảnh Live Frame từ camera PC sang Tablet Kiosk qua Socket.IO
  useEffect(() => {
    if (!socket) return undefined;
    const interval = setInterval(() => {
      // 1. Gửi frame cổng Vào
      const entryVideo = entryVideoRef.current;
      const entryCanvas = entryCanvasRef.current;
      if (entryVideo && entryVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const frame = captureVideoLaneBase64(entryVideo, entryCanvas, 'entry', cameraConfigRef.current);
        if (frame) {
          socket.emit('gate:stream_frame', { lane: 'entry', gate: 'ENTRY_1', frameBase64: frame });
        }
      }

      // 2. Gửi frame cổng Ra
      const exitVideo = exitVideoRef.current;
      const exitCanvas = exitCanvasRef.current;
      if (exitVideo && exitVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const frame = captureVideoLaneBase64(exitVideo, exitCanvas, 'exit', cameraConfigRef.current);
        if (frame) {
          socket.emit('gate:stream_frame', { lane: 'exit', gate: 'EXIT_1', frameBase64: frame });
        }
      }
    }, 400); // 400ms = 2.5 FPS siêu mượt và không tốn băng thông đường truyền

    return () => clearInterval(interval);
  }, [socket]);

  const emitKioskEntrySync = useCallback((payload) => {
    if (!payload?.licensePlate) return;
    const enrichedPayload = {
      ...payload,
      gate: String(payload.gate || 'ENTRY_1').toUpperCase(),
    };
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel('valo_kiosk_entry_sync');
        ch.postMessage(enrichedPayload);
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
      body: JSON.stringify(enrichedPayload),
    }).catch(() => { });
  }, []);

  const emitKioskExitSync = useCallback((payload) => {
    if (!payload?.licensePlate || !payload?.invoiceData) return;
    const enrichedPayload = {
      ...payload,
      gate: String(payload.gate || 'EXIT_1').toUpperCase(),
    };
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel('valo_kiosk_exit_sync');
        ch.postMessage(enrichedPayload);
        ch.close();
      } catch {
        // Ignore broadcast error
      }
    }

    const token = localStorage.getItem('accessToken');
    fetch(`${API_BASE}/iot/kiosk-exit-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(enrichedPayload),
    }).catch(() => { });
  }, []);

  // ─── 3. BARRIER DIRECT CONTROLS (SHARED BY BOTH STATIONS) ───
  const triggerBarrier = useCallback(async (action, gate = 'ENTRY_1', plate = '', slot = '', reason = '', notes = '', customEvidence = '') => {
    try {
      const lane = String(gate || '').toLowerCase().includes('exit') ? 'exit' : 'entry';
      // Automatically snapshot current gate camera frame for audit trail
      const capturedEvidence = customEvidence || captureFrame(lane) || (lane === 'entry' ? entrySnapshot : exitSnapshot) || '';

      let endpoint = '/iot/open-barrier';
      let payload = {
        gate,
        licensePlate: plate || 'STAFF-OVERRIDE',
        slotCode: slot,
        reason: reason || undefined,
        notes: notes || undefined,
        evidenceImage: capturedEvidence || undefined,
      };

      if (action === 'hold') {
        endpoint = '/iot/hold-barrier';
        payload = {
          gate,
          hold: !gatesState[gate]?.holdOpen,
          reason: reason || undefined,
          notes: notes || undefined,
          evidenceImage: capturedEvidence || undefined,
        };
      } else if (action === 'close') {
        endpoint = '/iot/close-barrier';
        payload = {
          gate,
          reason: reason || 'MANUAL_CLOSE',
          notes: notes || undefined,
          evidenceImage: capturedEvidence || undefined,
        };
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
  }, [gatesState, entrySnapshot, exitSnapshot, fetchBarrierStatus, captureFrame]);

  // ─── 4. BIDIRECTIONAL LANE CONTROLLERS (1 IN / 1 OUT + SMART 2 IN / 2 OUT) ───
  const primaryEntry = useEntryLaneController({
    gate: 'ENTRY_1',
    cameraLane: 'entry',
    snapshot: entrySnapshot,
    setSnapshot: setEntrySnapshot,
    floors,
    activeSessionsList,
    captureFrame,
    cameraConfigRef,
    triggerBarrier,
    refreshFloorsAndSessions: fetchFloorsAndSessions,
    emitKioskEntrySync,
  });

  const reversedEntry = useEntryLaneController({
    gate: 'EXIT_1',
    cameraLane: 'exit',
    snapshot: exitSnapshot,
    setSnapshot: setExitSnapshot,
    floors,
    activeSessionsList,
    captureFrame,
    cameraConfigRef,
    triggerBarrier,
    refreshFloorsAndSessions: fetchFloorsAndSessions,
    emitKioskEntrySync,
  });

  const setPrimaryOtherSlot = primaryEntry.setOtherSelectedSlotKey;
  const setReversedOtherSlot = reversedEntry.setOtherSelectedSlotKey;

  useEffect(() => {
    setPrimaryOtherSlot(laneMode === 'PEAK_ENTRY' ? reversedEntry.selectedSlotKey : '');
    setReversedOtherSlot(laneMode === 'PEAK_ENTRY' ? primaryEntry.selectedSlotKey : '');
  }, [
    laneMode,
    primaryEntry.selectedSlotKey,
    reversedEntry.selectedSlotKey,
    setPrimaryOtherSlot,
    setReversedOtherSlot,
  ]);

  const primaryExit = useExitLaneController({
    gate: 'EXIT_1',
    cameraLane: 'exit',
    snapshot: exitSnapshot,
    setSnapshot: setExitSnapshot,
    captureFrame,
    cameraConfigRef,
    triggerBarrier,
    refreshFloorsAndSessions: fetchFloorsAndSessions,
    emitKioskExitSync,
  });

  const reversedExit = useExitLaneController({
    gate: 'ENTRY_1',
    cameraLane: 'entry',
    snapshot: entrySnapshot,
    setSnapshot: setEntrySnapshot,
    captureFrame,
    cameraConfigRef,
    triggerBarrier,
    refreshFloorsAndSessions: fetchFloorsAndSessions,
    emitKioskExitSync,
  });

  // Active controller for each physical gate station based on Tidal Flow mode
  const leftCtrl = leftRole === 'entry' ? primaryEntry : reversedExit;
  const rightCtrl = rightRole === 'entry' ? reversedEntry : primaryExit;

  // Reset only the lane whose direction changed when switching Flow Mode
  const prevLaneModeRef = useRef(laneMode);
  useEffect(() => {
    const prev = prevLaneModeRef.current;
    if (prev === laneMode) return undefined;
    prevLaneModeRef.current = laneMode;

    const timer = setTimeout(() => {
      if (laneMode === 'PEAK_ENTRY') {
        reversedEntry.reset();
        primaryExit.reset();
        setExitSnapshot(null);
      } else if (laneMode === 'PEAK_EXIT') {
        reversedExit.reset();
        primaryEntry.reset();
        setEntrySnapshot(null);
      } else if (prev === 'PEAK_ENTRY') {
        reversedEntry.reset();
        setExitSnapshot(null);
      } else if (prev === 'PEAK_EXIT') {
        reversedExit.reset();
        setEntrySnapshot(null);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [laneMode, primaryEntry, reversedEntry, primaryExit, reversedExit]);

  const handleDualScanBothLanes = async () => {
    setEntrySnapshot(null);
    setExitSnapshot(null);
    await Promise.allSettled([leftCtrl.scanPlate(), rightCtrl.scanPlate()]);
  };

  const handleScanBothRef = useRef({ left: null, right: null });
  useEffect(() => {
    handleScanBothRef.current = {
      left: () => leftCtrl.scanPlate(),
      right: () => rightCtrl.scanPlate(),
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
        !leftCtrl.scanLockRef.current &&
        now - lastAutoEntryAtRef.current >= 3500
      ) {
        const sig = computeLaneFrameSignature(entryVideo, 'entry', cameraConfigRef.current);
        if (!entryMotionSigRef.current || hasLaneMotionChanged(entryMotionSigRef.current, sig)) {
          entryMotionSigRef.current = sig;
          lastAutoEntryAtRef.current = now;
          tasks.push(handleScanBothRef.current.left?.());
        }
      }

      const exitVideo = exitVideoRef.current;
      if (
        exitVideo &&
        exitVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !rightCtrl.scanLockRef.current &&
        now - lastAutoExitAtRef.current >= 3500
      ) {
        const sig = computeLaneFrameSignature(exitVideo, 'exit', cameraConfigRef.current);
        if (!exitMotionSigRef.current || hasLaneMotionChanged(exitMotionSigRef.current, sig)) {
          exitMotionSigRef.current = sig;
          lastAutoExitAtRef.current = now;
          tasks.push(handleScanBothRef.current.right?.());
        }
      }

      if (tasks.length > 0) {
        Promise.allSettled(tasks);
      }
    }, 900);

    return () => clearInterval(timer);
  }, [autoScanDual, leftCtrl, rightCtrl]);

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
        primaryEntry.setPlate(formatLicensePlateDisplay(cleanEntry));
        if (entryPhoneParam) primaryEntry.setPhone(entryPhoneParam);
        if (entrySlotParam) primaryEntry.setSlotCode(entrySlotParam);
        primaryEntry.verifyPlate(cleanEntry, null, false, entryPhoneParam || null);
      }
    }

    // 2. Pre-fill & look up Exit lane if present
    if (multiExitPlate) {
      const cleanExit = normalizeLicensePlate(multiExitPlate);
      if (cleanExit) {
        primaryExit.setPlate(formatLicensePlateDisplay(cleanExit));
        primaryExit.lookupSession(cleanExit);
      }
    }
  }, [searchParams, primaryEntry, primaryExit]);

  // ─── 5. AI MODAL SELECTION CALLBACK ───
  const handleSelectAiPlate = (selectedPlate) => {
    setShowAiModal(false);
    const formatted = formatLicensePlateDisplay(selectedPlate);
    const targetCtrl = aiTargetStation === 'EXIT_1' ? rightCtrl : leftCtrl;
    const targetRole = aiTargetStation === 'EXIT_1' ? rightRole : leftRole;
    targetCtrl.setPlate(formatted);
    if (targetRole === 'entry') {
      targetCtrl.verifyPlate(selectedPlate);
    } else {
      targetCtrl.lookupSession(selectedPlate);
    }
    toast.success(`[${aiTargetStation}] Selected plate from AI Assistant: ${formatted}`);
  };

  return (
    <div className={`p-4 sm:p-6 lg:p-8 ${STAFF_THEME.page}`}>
      <Toaster position="top-right" />

      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER & STREAMLINED TOOLBAR
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-6 flex flex-col gap-3.5">
        {/* ── Tier 1: Title, Subtitle, Hardware Status & Emergency Trigger ── */}
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

          {/* Right Status Group: Hardware Status & Emergency Trigger */}
          <div className="flex items-center gap-2.5">
            {/* ESP32 Bridge Status */}
            <div
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#121214] px-3 py-2 shadow-sm"
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
                  className={`text-[11px] font-bold ${isEspOnline
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

            {/* Emergency Open Button */}
            <button
              type="button"
              onClick={() => {
                triggerBarrier('open', 'ENTRY_1', 'EMERGENCY_OPEN');
                triggerBarrier('open', 'EXIT_1', 'EMERGENCY_OPEN');
                toast.success(t('gateControlUi.emergencySent'));
              }}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 hover:bg-red-500 px-3.5 py-2 font-bold text-xs text-red-300 hover:text-white transition shadow-sm active:scale-95 cursor-pointer"
            >
              <AlertTriangle size={14} />
              <span>{t('gateControlUi.emergencyOpen')}</span>
            </button>
          </div>
        </div>

        {/* ── Tier 2: Unified Operations Toolbar (Tidal Flow & Dual AI) ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#141416] p-2.5 shadow-lg">
          {/* Group 1: Tidal Flow Mode Segmented Control */}
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] uppercase font-black tracking-wider text-white/50 pl-1">
              <ArrowLeftRight size={13} className="text-amber-400" />
              <span>Flow Mode:</span>
            </span>
            <div className="inline-flex rounded-xl bg-black/60 p-1 border border-white/10 text-xs font-bold">
              <button
                type="button"
                onClick={() => handleSwitchLaneMode('STANDARD')}
                disabled={isSwitchingLaneMode}
                className={`px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${laneMode === 'STANDARD'
                    ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20 font-black'
                    : 'text-white/60 hover:text-white hover:bg-white/5 font-semibold'
                  }`}
                title="Standard: Left = Entry, Right = Exit"
              >
                1 IN / 1 OUT
              </button>
              <button
                type="button"
                onClick={() => handleSwitchLaneMode('PEAK_ENTRY')}
                disabled={isSwitchingLaneMode}
                className={`px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${laneMode === 'PEAK_ENTRY'
                    ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20 font-black'
                    : 'text-white/60 hover:text-white hover:bg-white/5 font-semibold'
                  }`}
                title="Dual Entry: Both gates act as Entry"
              >
                2 IN
              </button>
              <button
                type="button"
                onClick={() => handleSwitchLaneMode('PEAK_EXIT')}
                disabled={isSwitchingLaneMode}
                className={`px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${laneMode === 'PEAK_EXIT'
                    ? 'bg-sky-500 text-black shadow-md shadow-sky-500/20 font-black'
                    : 'text-white/60 hover:text-white hover:bg-white/5 font-semibold'
                  }`}
                title="Dual Exit: Both gates act as Exit"
              >
                2 OUT
              </button>
            </div>
          </div>

          {/* Group 2: Dual AI Scanning & Station Utilities */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDualScanBothLanes}
              disabled={leftCtrl.isScanning || rightCtrl.isScanning}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-2 font-bold text-xs text-emerald-300 disabled:opacity-50 transition cursor-pointer active:scale-95"
            >
              <ScanLine size={13} />
              <span>
                {laneMode === 'PEAK_ENTRY'
                  ? `${t('gateControlUi.scanBothLanes')} (2 IN)`
                  : laneMode === 'PEAK_EXIT'
                    ? `${t('gateControlUi.scanBothLanes')} (2 OUT)`
                    : t('gateControlUi.scanBothLanes')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !autoScanDual;
                setAutoScanDual(next);
                localStorage.setItem('valo_auto_scan', String(next));
                toast(next ? t('gateControlUi.autoScanEnabled') : t('gateControlUi.autoScanDisabled'));
              }}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 font-bold text-xs transition cursor-pointer ${autoScanDual
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-white/65 hover:text-white'
                }`}
            >
              <Activity size={13} className={autoScanDual ? 'animate-pulse text-emerald-400' : ''} />
              <span>{t('gateControlUi.autoScan', { state: autoScanDual ? t('gateControlUi.on') : t('gateControlUi.off') })}</span>
            </button>

            <div className="h-5 w-px bg-white/10 mx-1 hidden sm:block" />

            <button
              type="button"
              onClick={() => setShowCameraSetup(prev => !prev)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 font-bold text-xs transition cursor-pointer ${showCameraSetup || dualLaneSplitMode
                  ? 'border-sky-400/45 bg-sky-500/15 text-sky-300'
                  : 'border-white/10 bg-white/5 text-white/65 hover:text-white'
                }`}
              title={t('gateControlUi.cameraSetupTitle')}
            >
              <SlidersHorizontal size={13} />
              <span>{t('gateControlUi.cameraSetup')}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowBarrierLogsModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25 px-3.5 py-2 font-bold text-xs text-amber-300 transition cursor-pointer shadow-sm active:scale-95"
              title="View Barrier Activity & Camera Snapshot Audit Logs"
            >
              <ShieldCheck size={13} className="text-amber-400" />
              <span>Barrier Logs</span>
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
                      const prevEntryLabel = localStorage.getItem('valo_entry_cam_label') || '';
                      const prevExitLabel = localStorage.getItem('valo_exit_cam_label') || '';
                      setEntryDeviceId(prevExit);
                      setExitDeviceId(prevEntry);
                      localStorage.setItem('valo_entry_cam', prevExit);
                      localStorage.setItem('valo_exit_cam', prevEntry);
                      localStorage.setItem('valo_entry_cam_label', prevExitLabel);
                      localStorage.setItem('valo_exit_cam_label', prevEntryLabel);
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
            LEFT COLUMN: ENTRY STATION (ENTRY_1 — flips to Exit in PEAK_EXIT)
        ────────────────────────────────────────────────────────────────── */}
        <div
          className={`flex flex-col rounded-2xl border bg-[#111111] p-4 shadow-2xl relative overflow-hidden transition-colors ${
            leftRole === 'exit' ? 'border-sky-500/30' : 'border-emerald-500/20'
          }`}
        >
          <div
            className={`pointer-events-none absolute -top-12 -left-12 h-36 w-36 rounded-full blur-3xl ${
              leftRole === 'exit' ? 'bg-sky-500/15' : 'bg-emerald-500/10'
            }`}
          />

          {/* Lane Header */}
          <div className="mb-3 border-b border-white/10 pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
                    leftRole === 'exit'
                      ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  }`}
                >
                  <Car size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2
                      className={`text-sm sm:text-base font-black uppercase tracking-wider ${
                        leftRole === 'exit' ? 'text-sky-400' : 'text-emerald-400'
                      }`}
                    >
                      {t('gateControlUi.entryGate')}
                    </h2>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold border ${
                        leftRole === 'exit'
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      ENTRY_1
                    </span>
                    {laneMode === 'PEAK_EXIT' ? (
                      <span className="rounded-md bg-sky-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-sky-300 border border-sky-400/40 animate-pulse">
                        Reversed to Exit
                      </span>
                    ) : (
                      <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300/80 border border-emerald-500/20">
                        Entry Lane
                      </span>
                    )}
                  </div>
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
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase border transition cursor-pointer ${entryTransform.rotation !== 0
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                      : 'bg-white/5 text-white/70 border-white/15 hover:text-white'
                    }`}
                  title="Rotate Entry camera in 90° steps"
                >
                  <RotateCw size={11} />
                  <span>{entryTransform.rotation}°</span>
                </button>

                <span
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border whitespace-nowrap shadow-sm ${gatesState.ENTRY_1?.open
                      ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/60 shadow-emerald-500/20'
                      : gatesState.ENTRY_1?.holdOpen
                        ? 'bg-amber-500/25 text-amber-300 border-amber-400/60 shadow-amber-500/20'
                        : 'bg-red-500/20 text-red-300 border-red-500/40'
                    }`}
                >
                  {gatesState.ENTRY_1?.open ? <Unlock size={11} /> : <Lock size={11} />}
                  <span>{gatesState.ENTRY_1?.open ? t('gateControlUi.barrierOpen') : t('gateControlUi.barrierClosed')}</span>
                </span>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-white/45 pl-11">
              <span>
                {leftRole === 'exit'
                  ? 'Reversed mode: Exit verification & fee collection via ENTRY_1'
                  : t('gateControlUi.entrySubtitle')}
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
                  alt="Entry Station Snapshot"
                  className={`relative z-10 h-full w-full ${dualLaneSplitMode ? 'object-contain bg-black' : 'object-cover'}`}
                />
              )}
              <canvas ref={entryCanvasRef} className="hidden" />

              {/* Bounding Box Guide */}
              {dualLaneSplitMode ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2">
                  <div className="flex justify-end">
                    <span
                      className={`rounded px-2 py-0.5 text-[9px] font-black uppercase text-black ${
                        leftRole === 'exit' ? 'bg-sky-400/90' : 'bg-emerald-500/90'
                      }`}
                    >
                      {leftRole === 'exit' ? 'EXIT (REVERSED)' : 'ENTRY'} · {entryTransform.side === 'left' ? 'LEFT' : 'RIGHT'} ({entryTransform.rotation}°)
                    </span>
                  </div>
                  <div
                    className={`mx-auto my-auto h-20 w-44 rounded-lg border-2 border-dashed ${
                      leftRole === 'exit' ? 'border-sky-400/60 bg-sky-400/5' : 'border-emerald-400/60 bg-emerald-400/5'
                    }`}
                  />
                  <div />
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                  <div
                    className={`h-20 w-52 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center p-1 ${
                      leftRole === 'exit' ? 'border-sky-400/50 bg-sky-400/5' : 'border-emerald-400/50 bg-emerald-400/5'
                    }`}
                  >
                    <span className={`text-[9px] font-bold uppercase drop-shadow ${leftRole === 'exit' ? 'text-sky-300' : 'text-emerald-300'}`}>
                      {leftRole === 'exit' ? 'EXIT (REVERSED) SCAN ZONE' : 'ENTRY SCAN ZONE'} {entryTransform.rotation !== 0 ? `(${entryTransform.rotation}°)` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Camera Control Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#0d0d0f] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-2 w-2 shrink-0 rounded-full animate-ping ${leftRole === 'exit' ? 'bg-sky-400' : 'bg-emerald-400'}`} />
                <select
                  value={entryDeviceId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    const chosenLabel = availableCameras.find((c) => c.deviceId === newId)?.label || '';
                    localStorage.setItem('valo_entry_cam', newId);
                    localStorage.setItem('valo_entry_cam_label', chosenLabel);
                    setEntryDeviceId(newId);
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
                    onClick={() => leftCtrl.scanPlate()}
                    disabled={leftCtrl.isScanning}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-bold text-black ${
                      leftRole === 'exit' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-emerald-500 hover:bg-emerald-400'
                    }`}
                  >
                    {leftCtrl.isScanning ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                    <span>{t('gateControlUi.scanPlateAi')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Upload Test Option */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/40 px-1">
            <span>{t('gateControlUi.uploadVehiclePhoto')}</span>
            <label className={`flex items-center gap-1 cursor-pointer font-semibold ${leftRole === 'exit' ? 'text-sky-400 hover:text-sky-300' : 'text-emerald-400 hover:text-emerald-300'}`}>
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
                      leftCtrl.scanPlate(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </label>
          </div>

          {/* Dynamic Entry or Reversed-Exit Operation Console */}
          {leftRole === 'entry' ? (
            <EntryLaneConsole
              ctrl={primaryEntry}
              floors={floors}
              activeSessionsList={activeSessionsList}
              otherSelectedSlotKey={laneMode === 'PEAK_ENTRY' ? reversedEntry.selectedSlotKey : ''}
              onOpenAiAssistant={() => {
                setAiTargetStation('ENTRY_1');
                setAiModalInitialPlate(primaryEntry.plate);
                setAiModalInitialImage(entrySnapshot);
                setShowAiModal(true);
              }}
              t={t}
            />
          ) : (
            <ExitLaneConsole
              ctrl={reversedExit}
              activeSessionsList={activeSessionsList}
              snapshot={entrySnapshot}
              videoRef={entryVideoRef}
              cameraActive={entryCameraActive}
              cameraConfig={cameraConfig}
              captureFrame={captureFrame}
              otherExitPlate={primaryExit.plate}
              onPreviewPhoto={setPreviewPhotoModal}
              onOpenAiAssistant={() => {
                setAiTargetStation('ENTRY_1');
                setAiModalInitialPlate(reversedExit.plate);
                setAiModalInitialImage(entrySnapshot);
                setShowAiModal(true);
              }}
              t={t}
            />
          )}

          {/* Manual Hardware Override Console (ENTRY_1) */}
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-white/40 mb-2">
              <span>Manual Barrier Control</span>
              <span className="font-mono text-[9px] text-white/30">AUDIT LOGGED</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  setOverrideModal({
                    action: 'open',
                    gate: 'ENTRY_1',
                    plate: leftCtrl.plate || (leftRole === 'exit' ? 'MANUAL_EXIT' : 'MANUAL_ENTRY'),
                    slot: leftRole === 'entry' ? leftCtrl.slotCode || '' : '',
                  })
                }
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition active:scale-95 cursor-pointer ${
                  leftRole === 'exit'
                    ? 'border-sky-500/25 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300'
                    : 'border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                }`}
              >
                <Unlock size={13} className={leftRole === 'exit' ? 'text-sky-400' : 'text-emerald-400'} />
                <span>{leftRole === 'exit' ? t('gateControlUi.openExit') : t('gateControlUi.openEntry')}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setOverrideModal({
                    action: 'hold',
                    gate: 'ENTRY_1',
                    plate: leftCtrl.plate || 'MANUAL_HOLD',
                    slot: '',
                  })
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/20 py-2.5 text-xs font-bold text-amber-300 transition active:scale-95 cursor-pointer"
              >
                <Pause size={13} className="text-amber-400" />
                <span>{t('gateControlUi.hold')}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerBarrier(
                    'close',
                    'ENTRY_1',
                    leftCtrl.plate || (leftRole === 'exit' ? 'MANUAL_EXIT' : 'MANUAL_ENTRY'),
                    '',
                    'MANUAL_CLOSE',
                    'Gate closed'
                  )
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 py-2.5 text-xs font-bold text-red-300 transition active:scale-95 cursor-pointer"
              >
                <Lock size={13} className="text-red-400" />
                <span>{t('gateControlUi.close')}</span>
              </button>
            </div>
          </div>
        </div>


        {/* ──────────────────────────────────────────────────────────────────
            RIGHT COLUMN: EXIT STATION (EXIT_1 — flips to Entry in PEAK_ENTRY)
        ────────────────────────────────────────────────────────────────── */}
        <div
          className={`flex flex-col rounded-2xl border bg-[#111111] p-4 shadow-2xl relative overflow-hidden transition-colors ${
            rightRole === 'entry' ? 'border-emerald-500/30' : 'border-sky-500/20'
          }`}
        >
          <div
            className={`pointer-events-none absolute -top-12 -right-12 h-36 w-36 rounded-full blur-3xl ${
              rightRole === 'entry' ? 'bg-emerald-500/15' : 'bg-sky-500/10'
            }`}
          />

          {/* Lane Header */}
          <div className="mb-3 border-b border-white/10 pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
                    rightRole === 'entry'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                  }`}
                >
                  <Car size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2
                      className={`text-sm sm:text-base font-black uppercase tracking-wider ${
                        rightRole === 'entry' ? 'text-emerald-400' : 'text-sky-400'
                      }`}
                    >
                      {t('gateControlUi.exitGate')}
                    </h2>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold border ${
                        rightRole === 'entry'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                      }`}
                    >
                      EXIT_1
                    </span>
                    {laneMode === 'PEAK_ENTRY' ? (
                      <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-300 border border-emerald-400/40 animate-pulse">
                        Reversed to Entry
                      </span>
                    ) : (
                      <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-300/80 border border-sky-500/20">
                        Exit Lane
                      </span>
                    )}
                  </div>
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
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase border transition cursor-pointer ${exitTransform.rotation !== 0
                      ? 'bg-sky-500/20 text-sky-300 border-sky-400/50'
                      : 'bg-white/5 text-white/70 border-white/15 hover:text-white'
                    }`}
                  title="Rotate Exit camera in 90° steps"
                >
                  <RotateCw size={11} />
                  <span>{exitTransform.rotation}°</span>
                </button>

                <span
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border whitespace-nowrap shadow-sm ${gatesState.EXIT_1?.open
                      ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/60 shadow-emerald-500/20'
                      : gatesState.EXIT_1?.holdOpen
                        ? 'bg-amber-500/25 text-amber-300 border-amber-400/60 shadow-amber-500/20'
                        : 'bg-red-500/20 text-red-300 border-red-500/40'
                    }`}
                >
                  {gatesState.EXIT_1?.open ? <Unlock size={11} /> : <Lock size={11} />}
                  <span>{gatesState.EXIT_1?.open ? t('gateControlUi.barrierOpen') : t('gateControlUi.barrierClosed')}</span>
                </span>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-white/45 pl-11">
              <span>
                {rightRole === 'entry'
                  ? 'Reversed mode: Entry OCR scan & slot assignment via EXIT_1'
                  : t('gateControlUi.exitSubtitle')}
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
                  alt="Exit Station Snapshot"
                  className={`relative z-10 h-full w-full ${dualLaneSplitMode ? 'object-contain bg-black' : 'object-cover'}`}
                />
              )}
              <canvas ref={exitCanvasRef} className="hidden" />

              {/* Bounding Box Guide */}
              {dualLaneSplitMode ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2">
                  <div className="flex justify-start">
                    <span
                      className={`rounded px-2 py-0.5 text-[9px] font-black uppercase text-black ${
                        rightRole === 'entry' ? 'bg-emerald-500/90' : 'bg-sky-400/90'
                      }`}
                    >
                      {rightRole === 'entry' ? 'ENTRY (REVERSED)' : 'EXIT'} · {exitTransform.side === 'left' ? 'LEFT' : 'RIGHT'} ({exitTransform.rotation}°)
                    </span>
                  </div>
                  <div
                    className={`mx-auto my-auto h-20 w-44 rounded-lg border-2 border-dashed ${
                      rightRole === 'entry' ? 'border-emerald-400/60 bg-emerald-400/5' : 'border-sky-400/60 bg-sky-400/5'
                    }`}
                  />
                  <div />
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                  <div
                    className={`h-20 w-52 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center p-1 ${
                      rightRole === 'entry' ? 'border-emerald-400/50 bg-emerald-400/5' : 'border-sky-400/50 bg-sky-400/5'
                    }`}
                  >
                    <span className={`text-[9px] font-bold uppercase drop-shadow ${rightRole === 'entry' ? 'text-emerald-300' : 'text-sky-300'}`}>
                      {rightRole === 'entry' ? 'ENTRY (REVERSED) SCAN ZONE' : 'EXIT SCAN ZONE'} {exitTransform.rotation !== 0 ? `(${exitTransform.rotation}°)` : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Camera Control Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#0d0d0f] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-2 w-2 shrink-0 rounded-full animate-ping ${rightRole === 'entry' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                <select
                  value={exitDeviceId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    const chosenLabel = availableCameras.find((c) => c.deviceId === newId)?.label || '';
                    localStorage.setItem('valo_exit_cam', newId);
                    localStorage.setItem('valo_exit_cam_label', chosenLabel);
                    setExitDeviceId(newId);
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
                    onClick={() => rightCtrl.scanPlate()}
                    disabled={rightCtrl.isScanning}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-bold text-black ${
                      rightRole === 'entry' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-sky-500 hover:bg-sky-400'
                    }`}
                  >
                    {rightCtrl.isScanning ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
                    <span>{t('gateControlUi.scanPlateAi')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Upload Test Option */}
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/40 px-1">
            <span>{t('gateControlUi.uploadVehiclePhoto')}</span>
            <label className={`flex items-center gap-1 cursor-pointer font-semibold ${rightRole === 'entry' ? 'text-emerald-400 hover:text-emerald-300' : 'text-sky-400 hover:text-sky-300'}`}>
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
                      setExitSnapshot(reader.result);
                      rightCtrl.scanPlate(reader.result);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </label>
          </div>

          {/* Dynamic Exit or Reversed-Entry Operation Console */}
          {rightRole === 'entry' ? (
            <EntryLaneConsole
              ctrl={reversedEntry}
              floors={floors}
              activeSessionsList={activeSessionsList}
              otherSelectedSlotKey={laneMode === 'PEAK_ENTRY' ? primaryEntry.selectedSlotKey : ''}
              onOpenAiAssistant={() => {
                setAiTargetStation('EXIT_1');
                setAiModalInitialPlate(reversedEntry.plate);
                setAiModalInitialImage(exitSnapshot);
                setShowAiModal(true);
              }}
              t={t}
            />
          ) : (
            <ExitLaneConsole
              ctrl={primaryExit}
              activeSessionsList={activeSessionsList}
              snapshot={exitSnapshot}
              videoRef={exitVideoRef}
              cameraActive={exitCameraActive}
              cameraConfig={cameraConfig}
              captureFrame={captureFrame}
              otherExitPlate={laneMode === 'PEAK_EXIT' ? reversedExit.plate : ''}
              onPreviewPhoto={setPreviewPhotoModal}
              onOpenAiAssistant={() => {
                setAiTargetStation('EXIT_1');
                setAiModalInitialPlate(primaryExit.plate);
                setAiModalInitialImage(exitSnapshot);
                setShowAiModal(true);
              }}
              t={t}
            />
          )}

          {/* Manual Hardware Override Console (EXIT_1) */}
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-white/40 mb-2">
              <span>Manual Barrier Control</span>
              <span className="font-mono text-[9px] text-white/30">AUDIT LOGGED</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  setOverrideModal({
                    action: 'open',
                    gate: 'EXIT_1',
                    plate: rightCtrl.plate || (rightRole === 'entry' ? 'MANUAL_ENTRY' : 'MANUAL_EXIT'),
                    slot: rightRole === 'entry' ? rightCtrl.slotCode || '' : '',
                  })
                }
                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition active:scale-95 cursor-pointer ${
                  rightRole === 'entry'
                    ? 'border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                    : 'border-sky-500/25 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300'
                }`}
              >
                <Unlock size={13} className={rightRole === 'entry' ? 'text-emerald-400' : 'text-sky-400'} />
                <span>{rightRole === 'entry' ? t('gateControlUi.openEntry') : t('gateControlUi.openExit')}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setOverrideModal({
                    action: 'hold',
                    gate: 'EXIT_1',
                    plate: rightCtrl.plate || 'MANUAL_HOLD',
                    slot: '',
                  })
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 hover:bg-amber-500/20 py-2.5 text-xs font-bold text-amber-300 transition active:scale-95 cursor-pointer"
              >
                <Pause size={13} className="text-amber-400" />
                <span>{t('gateControlUi.hold')}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerBarrier(
                    'close',
                    'EXIT_1',
                    rightCtrl.plate || (rightRole === 'entry' ? 'MANUAL_ENTRY' : 'MANUAL_EXIT'),
                    '',
                    'MANUAL_CLOSE',
                    'Gate closed'
                  )
                }
                className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 py-2.5 text-xs font-bold text-red-300 transition active:scale-95 cursor-pointer"
              >
                <Lock size={13} className="text-red-400" />
                <span>{t('gateControlUi.close')}</span>
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          EXPANDED CAMERA ZOOM MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      {expandedCamera && (() => {
        const isLeftCam = expandedCamera === 'entry';
        const activeModalCtrl = isLeftCam ? leftCtrl : rightCtrl;
        const activeModalRole = isLeftCam ? leftRole : rightRole;
        const isEmerald = activeModalRole === 'entry';
        const modalGateTitle = isLeftCam
          ? `Entry Gate (ENTRY_1${leftRole === 'exit' ? ' · Reversed to Exit' : ''}) · Zoom View`
          : `Exit Gate (EXIT_1${rightRole === 'entry' ? ' · Reversed to Entry' : ''}) · Zoom View`;

        return (
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
                  <span className={`h-2.5 w-2.5 rounded-full animate-pulse ${isEmerald ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                  <h3 className={`text-sm font-black uppercase tracking-wider ${isEmerald ? 'text-emerald-400' : 'text-sky-400'}`}>
                    {modalGateTitle}
                  </h3>
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-white/70">
                    {isLeftCam ? `${entryTransform.rotation}°` : `${exitTransform.rotation}°`}
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
                      if (isLeftCam) {
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
                    onClick={() => activeModalCtrl.scanPlate()}
                    disabled={activeModalCtrl.isScanning}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-black transition ${isEmerald
                      ? 'bg-emerald-500 hover:bg-emerald-400'
                      : 'bg-sky-500 hover:bg-sky-400'
                      }`}
                  >
                    {activeModalCtrl.isScanning
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
                  {(isLeftCam ? entrySnapshot : exitSnapshot) ? (
                    <img
                      src={isLeftCam ? entrySnapshot : exitSnapshot}
                      alt={`${expandedCamera} zoomed snapshot`}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <LaneCameraPreview
                      videoRef={isLeftCam ? entryVideoRef : exitVideoRef}
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
                  <strong className={isEmerald ? 'text-emerald-400' : 'text-sky-400'}>
                    {activeModalCtrl.plate || 'Waiting for scan'}
                  </strong>
                </span>
                <span className="text-[11px] text-white/40">
                  Tip: Use +/- to zoom up to 250% without affecting AI scan accuracy.
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════════
          CHECK-IN / EXIT PHOTO HIGH-RES INSPECTION MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      {previewPhotoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
          onClick={() => setPreviewPhotoModal(null)}
        >
          <div
            className="relative w-full max-w-2xl rounded-2xl border border-white/15 bg-[#141416] p-4 shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 border border-sky-400/30">
                  <Camera size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">{previewPhotoModal.title}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-white/50">
                    {previewPhotoModal.plate && (
                      <span className="font-mono font-bold text-sky-300 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-400/20">
                        {previewPhotoModal.plate}
                      </span>
                    )}
                    {previewPhotoModal.time && <span>• {previewPhotoModal.time}</span>}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPhotoModal(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="relative min-h-[300px] max-h-[65vh] w-full overflow-hidden rounded-xl bg-black border border-white/10 flex items-center justify-center p-2">
              {previewPhotoModal.image ? (
                <img
                  src={previewPhotoModal.image}
                  alt={previewPhotoModal.title}
                  className="max-h-[60vh] w-full object-contain rounded-lg"
                />
              ) : (
                <div className="text-center py-12 text-white/40 text-xs">
                  <AlertCircle size={28} className="mx-auto mb-2 text-white/20" />
                  <span>No image data available for this session</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-white/50 pt-1">
              <span>Verify license plate &amp; vehicle match actual vehicle</span>
              <button
                type="button"
                onClick={() => setPreviewPhotoModal(null)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15 transition cursor-pointer"
              >
                Close
              </button>
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

      {/* ═══════════════════════════════════════════════════════════════════════
          BARRIER ACTIVITY & CAMERA EVIDENCE LOGS MODAL
      ═══════════════════════════════════════════════════════════════════════ */}
      <BarrierAuditLogsModal
        isOpen={showBarrierLogsModal}
        onClose={() => setShowBarrierLogsModal(false)}
      />
    </div>
  );
}
