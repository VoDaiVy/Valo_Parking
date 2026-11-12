import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Camera,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Maximize2,
  ChevronRight,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  Car,
  Phone,
  Clock,
  LogOut,
  Wand2,
  Save,
  ZoomIn,
  ZoomOut,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  RotateCcw,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Zap,
  Check,
  Focus,
  ChevronDown,
  Lock,
  Unlock
} from 'lucide-react';
import { API_BASE } from '../../../services/api';
import toast from 'react-hot-toast';
import { formatLicensePlateDisplay } from '../../../utils/licensePlate';

const ROBOFLOW_CALIBRATED_SLOTS = [
  { slotCode: 'A1', polygon: [[0.0313, 0.0947], [0.1197, 0.0944], [0.1203, 0.3034], [0.0318, 0.3036]] },
  { slotCode: 'A2', polygon: [[0.1322, 0.106], [0.2163, 0.1062], [0.2157, 0.3083], [0.1316, 0.308]] },
  { slotCode: 'A3', polygon: [[0.2271, 0.1156], [0.3048, 0.1163], [0.3031, 0.3118], [0.2254, 0.3111]] },
  { slotCode: 'A4', polygon: [[0.3169, 0.1278], [0.3912, 0.1291], [0.3878, 0.3182], [0.3135, 0.3168]] },
  { slotCode: 'A5', polygon: [[0.4012, 0.1359], [0.4723, 0.1375], [0.4681, 0.3206], [0.397, 0.319]] },
  { slotCode: 'B1', polygon: [[0.5189, 0.1472], [0.5838, 0.1488], [0.5793, 0.3254], [0.5144, 0.3237]] },
  { slotCode: 'B2', polygon: [[0.5917, 0.1553], [0.6544, 0.1564], [0.6513, 0.3277], [0.5886, 0.3266]] },
  { slotCode: 'B3', polygon: [[0.6625, 0.1617], [0.7229, 0.1634], [0.7182, 0.331], [0.6578, 0.3293]] },
  { slotCode: 'B4', polygon: [[0.7303, 0.1687], [0.7876, 0.1705], [0.7824, 0.3334], [0.7251, 0.3316]] },
  { slotCode: 'B5', polygon: [[0.7951, 0.1747], [0.8508, 0.1769], [0.8446, 0.3364], [0.789, 0.3342]] },
  { slotCode: 'A6', polygon: [[0.0313, 0.3163], [0.1192, 0.3166], [0.1187, 0.5164], [0.0308, 0.5161]] },
  { slotCode: 'A7', polygon: [[0.1313, 0.3212], [0.2149, 0.3215], [0.2141, 0.5148], [0.1305, 0.5145]] },
  { slotCode: 'A8', polygon: [[0.2254, 0.326], [0.3037, 0.3267], [0.302, 0.5136], [0.2237, 0.5129]] },
  { slotCode: 'A9', polygon: [[0.3142, 0.3293], [0.3881, 0.3301], [0.3861, 0.5113], [0.3123, 0.5104]] },
  { slotCode: 'A10', polygon: [[0.3971, 0.3325], [0.4671, 0.3334], [0.4649, 0.509], [0.3949, 0.5081]] },
  { slotCode: 'B6', polygon: [[0.5142, 0.337], [0.5799, 0.3384], [0.5764, 0.507], [0.5107, 0.5056]] },
  { slotCode: 'B7', polygon: [[0.5881, 0.3393], [0.6501, 0.341], [0.6454, 0.5066], [0.5834, 0.5048]] },
  { slotCode: 'C1', polygon: [[0.0301, 0.7082], [0.1172, 0.7079], [0.1179, 0.9059], [0.0308, 0.9062]] },
  { slotCode: 'C2', polygon: [[0.1284, 0.6998], [0.2109, 0.6998], [0.2109, 0.8924], [0.1284, 0.8924]] },
  { slotCode: 'C3', polygon: [[0.2224, 0.6926], [0.2992, 0.6942], [0.2953, 0.8818], [0.2184, 0.8802]] },
  { slotCode: 'C4', polygon: [[0.3083, 0.6853], [0.3819, 0.6862], [0.3796, 0.8683], [0.306, 0.8673]] },
  { slotCode: 'C5', polygon: [[0.3913, 0.6805], [0.4601, 0.682], [0.4561, 0.858], [0.3873, 0.8564]] },
  { slotCode: 'D1', polygon: [[0.5064, 0.6717], [0.5696, 0.6731], [0.5656, 0.8429], [0.5024, 0.8414]] },
  { slotCode: 'D2', polygon: [[0.579, 0.6651], [0.6392, 0.6667], [0.6346, 0.8349], [0.5744, 0.8332]] },
  { slotCode: 'D3', polygon: [[0.6477, 0.6605], [0.7066, 0.662], [0.7024, 0.8257], [0.6435, 0.8242]] },
  { slotCode: 'D4', polygon: [[0.7139, 0.657], [0.7705, 0.6586], [0.766, 0.8167], [0.7094, 0.8151]] },
  { slotCode: 'D5', polygon: [[0.7782, 0.6516], [0.8326, 0.6539], [0.8262, 0.8107], [0.7717, 0.8084]] },
];

// Helper to guarantee 100% clean English violation messages even if legacy backend data contains Vietnamese
const formatViolationEnglish = (res, slotCode) => {
  if (!res) return '';
  const rawPlate = res.plate || res.detectedPlate || res.expectedPlate || res.session?.licensePlate;
  const plateDisp = rawPlate ? formatLicensePlateDisplay(rawPlate) : '';
  const subj = plateDisp ? `Vehicle ${plateDisp}` : 'Unidentified vehicle';
  const isWrong = res.status === 'WRONG_SLOT_VIOLATION' || res.violationType === 'WRONG_SLOT_VIOLATION';
  const isDoubleParking = res.status === 'DOUBLE_PARKING_VIOLATION' || res.violationType === 'DOUBLE_PARKING_VIOLATION' || Boolean(res.occupiedByOverlap);
  const isUnauth = res.status === 'UNAUTHORIZED_PARKING' || res.violationType === 'UNAUTHORIZED_PARKING';
  const isPending = res.status === 'CHECKED_IN_PENDING_PARK' || res.violationType === 'CHECKED_IN_PENDING_PARK';
  const isExiting = res.status === 'EXITING_TO_GATE' || res.violationType === 'EXITING_TO_GATE';

  if (isDoubleParking) {
    if (res.primarySlot) {
      return `${subj} parked at ${res.primarySlot} is occupying too much of adjacent slot ${slotCode}!`;
    }
    return `${subj} is straddling across two parking slots (encroaching ${slotCode})!`;
  }
  if (isWrong) {
    if (res.expectedSlot) {
      return `${subj} assigned to slot ${res.expectedSlot}, but parked at ${slotCode}!`;
    }
    return `${subj} parked in wrong slot (assigned elsewhere)!`;
  }
  if (isUnauth) {
    return `${subj} parked at slot ${slotCode} without an active check-in or reservation!`;
  }
  if (isPending) {
    const timeStr = res.session?.checkInTime
      ? new Date(res.session.checkInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : '';
    return `${subj} checked in at gate${timeStr ? ` at ${timeStr}` : ''}; currently in transit to slot ${slotCode}.`;
  }
  if (isExiting) {
    return `${subj} left slot ${slotCode} and is heading toward exit gate (pending checkout).`;
  }
  if (res.violationMessage && !/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(res.violationMessage)) {
    return res.violationMessage;
  }
  return 'Parking policy exception detected.';
};

export default function SlotCameraMonitorModal({
  isOpen,
  onClose,
  floors = [],
  currentFloorId,
  activeSessions = [],
  onCheckoutSlot,
  onSlotStatusUpdate
}) {
  const [selectedFloorId, setSelectedFloorId] = useState(currentFloorId || (floors[0]?._id ?? null));
  const [mode, setMode] = useState('monitor'); // 'monitor' | 'calibrate'
  const [activeZoneFilter, setActiveZoneFilter] = useState('ALL');
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');

  const activeFloor = useMemo(() => {
    return floors.find((f) => f._id === selectedFloorId) || floors[0] || null;
  }, [floors, selectedFloorId]);

  const floorData = useMemo(() => {
    if (!activeFloor) return { zones: {}, allSlots: [] };
    const elements = activeFloor.layoutData?.elements || [];
    const slotElements = elements.filter((el) => el.type && el.type.startsWith('slot') && el.name);
    const zones = {};
    const allSlots = [];

    const sortSlots = (list) => {
      return [...list].sort((a, b) => {
        const numA = parseInt((a.name || a).replace(/\D/g, ''), 10) || 0;
        const numB = parseInt((b.name || b).replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });
    };

    slotElements.forEach((el) => {
      const code = el.name.trim().toUpperCase();
      const prefix = code[0] || 'OTHER';
      if (!zones[prefix]) zones[prefix] = [];
      zones[prefix].push(code);
    });

    // Sort slots numerically within each zone
    Object.keys(zones).forEach((k) => {
      zones[k] = sortSlots(zones[k]);
      allSlots.push(...zones[k]);
    });

    return { zones, allSlots };
  }, [activeFloor]);

  const DEFAULT_BOARD_CORNERS = useMemo(() => [
    [0.120, 0.270], // 0: Top-Left (TL)  — UGREEN Camera 4K centered diorama
    [0.870, 0.270], // 1: Top-Right (TR)
    [0.940, 0.840], // 2: Bottom-Right (BR)
    [0.090, 0.840], // 3: Bottom-Left (BL)
  ], []);

  const [boardCorners, setBoardCorners] = useState(DEFAULT_BOARD_CORNERS);
  const [activeCornerIndex, setActiveCornerIndex] = useState(null);
  const [isLayoutLocked, setIsLayoutLocked] = useState(false);

  const [slotScale, setSlotScale] = useState({ x: 1.0, y: 1.0 });

  // Compute 3x3 Projective Homography matrix mapping unit square [0..1]x[0..1] -> [TL, TR, BR, BL]
  const computeHomography = useCallback((corners) => {
    const [TL, TR, BR, BL] = corners || DEFAULT_BOARD_CORNERS;
    const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const dst = [TL, TR, BR, BL];
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i];
      const [x, y] = dst[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
      b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
      b.push(y);
    }
    // Gaussian elimination with partial pivoting (8x8)
    const n = 8;
    const aug = A.map((row, idx) => [...row, b[idx]]);
    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(aug[r][col]) > Math.abs(aug[maxRow][col])) maxRow = r;
      }
      if (Math.abs(aug[maxRow][col]) < 1e-10) return null;
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
      const pivot = aug[col][col];
      for (let c = col; c <= n; c++) aug[col][c] /= pivot;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = aug[r][col];
        for (let c = col; c <= n; c++) aug[r][c] -= factor * aug[col][c];
      }
    }
    return [
      aug[0][n], aug[1][n], aug[2][n],
      aug[3][n], aug[4][n], aug[5][n],
      aug[6][n], aug[7][n], 1.0,
    ];
  }, [DEFAULT_BOARD_CORNERS]);

  // Project normalized (u, v) via 3x3 Homography (fallback to bilinear if degenerate)
  const projectPoint = useCallback((u, v, corners, H = null) => {
    if (H) {
      const w = H[6] * u + H[7] * v + H[8];
      if (Math.abs(w) > 1e-7) {
        const x = (H[0] * u + H[1] * v + H[2]) / w;
        const y = (H[3] * u + H[4] * v + H[5]) / w;
        return [Number(x.toFixed(4)), Number(y.toFixed(4))];
      }
    }
    const [TL, TR, BR, BL] = corners || DEFAULT_BOARD_CORNERS;
    const x = (1 - u) * (1 - v) * TL[0] + u * (1 - v) * TR[0] + u * v * BR[0] + (1 - u) * v * BL[0];
    const y = (1 - u) * (1 - v) * TL[1] + u * (1 - v) * TR[1] + u * v * BR[1] + (1 - u) * v * BL[1];
    return [Number(x.toFixed(4)), Number(y.toFixed(4))];
  }, [DEFAULT_BOARD_CORNERS]);

  // Generate all 27 slot polygons from 4 board corners with perspective transformation
  const generateSlotsFromCorners = useCallback((corners, floor, scale = { x: 1.0, y: 1.0 }) => {
    const elements = floor?.layoutData?.elements || [];
    const slotEls = elements.filter((el) => el.type && el.type.startsWith('slot') && el.name);
    if (slotEls.length === 0) return [];

    const sortEls = (list) => {
      return [...list].sort((a, b) => {
        const numA = parseInt((a.name || '').replace(/\D/g, ''), 10) || 0;
        const numB = parseInt((b.name || '').replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });
    };

    const zonesMap = {};
    slotEls.forEach((el) => {
      const code = el.name.trim().toUpperCase();
      const prefix = code[0] || 'OTHER';
      if (!zonesMap[prefix]) zonesMap[prefix] = [];
      zonesMap[prefix].push(el);
    });

    Object.keys(zonesMap).forEach((k) => {
      zonesMap[k] = sortEls(zonesMap[k]);
    });

    const result = [];
    const sx = scale.x || 1.0;
    const sy = scale.y || 1.0;

    const maxSlotsInZone = Math.max(...Object.values(zonesMap).map((arr) => arr.length), 5);
    const isTwoRowLayout = maxSlotsInZone <= 5 && slotEls.length <= 20;

    const H = computeHomography(corners);

    const getSlotPoly = (colIdx, rowIdx, isRightZone) => {
      let u1, u2;
      if (isTwoRowLayout) {
        const slotWidth = 0.085 * sx;
        const baseU = isRightZone ? 0.575 : 0.000;
        u1 = baseU + colIdx * 0.085;
        u2 = u1 + slotWidth;
      } else {
        const baseUStart = isRightZone ? 0.540 : 0.00;
        const cWidth = 0.090;
        const sWidth = 0.080 * sx;
        const uCenter = baseUStart + colIdx * cWidth + (sWidth / 2);
        u1 = uCenter - sWidth / 2;
        u2 = uCenter + sWidth / 2;
      }

      let v1, v2;
      if (isTwoRowLayout) {
        if (rowIdx === 0) {
          v1 = 0.000;
          v2 = 0.365 * sy;
        } else {
          v1 = 0.510;
          v2 = 1.000 * sy;
        }
      } else {
        if (rowIdx === 0) {
          v1 = 0.00;
          v2 = 0.26 * sy;
        } else if (rowIdx === 1) {
          v1 = 0.29;
          v2 = (0.29 + 0.25) * sy;
        } else {
          v1 = 0.73;
          v2 = (0.73 + 0.25) * sy;
        }
      }

      // Mỗi ô đỗ được chiếu qua Homography 3D từ 4 chốt sa bàn
      return [
        projectPoint(u1, Math.max(0, v1), corners, H),
        projectPoint(u2, Math.max(0, v1), corners, H),
        projectPoint(u2, Math.min(1, v2), corners, H),
        projectPoint(u1, Math.min(1, v2), corners, H),
      ];
    };

    const zoneKeys = Object.keys(zonesMap).sort();
    const zA = zoneKeys[0] || 'A';
    const zB = zoneKeys[1] || 'B';
    const zC = zoneKeys[2] || 'C';
    const zD = zoneKeys[3] || 'D';

    // Zone 1 (Top-Left: Row 0 = 1..5, Row 1 = 6..10)
    const zoneA = zonesMap[zA] || [];
    zoneA.forEach((el, idx) => {
      const r = Math.floor(idx / 5);
      const c = idx % 5;
      result.push({
        slotCode: el.name,
        polygon: getSlotPoly(c, r, false),
      });
    });

    // Zone 2 (Top-Right: Row 0 = 1..5, Row 1 = 6..7)
    const zoneB = zonesMap[zB] || [];
    zoneB.forEach((el, idx) => {
      const r = Math.floor(idx / 5);
      const c = idx % 5;
      result.push({
        slotCode: el.name,
        polygon: getSlotPoly(c, r, true),
      });
    });

    // Zone 3 (Bottom-Left: Row 1 cho sa bàn 20 ô, hoặc Row 2 cho sa bàn 27 ô)
    const zoneC = zonesMap[zC] || [];
    zoneC.forEach((el, idx) => {
      const c = idx % 5;
      result.push({
        slotCode: el.name,
        polygon: getSlotPoly(c, isTwoRowLayout ? 1 : 2, false),
      });
    });

    // Zone 4 (Bottom-Right: Row 1 cho sa bàn 20 ô, hoặc Row 2 cho sa bàn 27 ô)
    const zoneD = zonesMap[zD] || [];
    zoneD.forEach((el, idx) => {
      const c = idx % 5;
      result.push({
        slotCode: el.name,
        polygon: getSlotPoly(c, isTwoRowLayout ? 1 : 2, true),
      });
    });

    return result;
  }, [computeHomography, projectPoint]);

  // Generate Floor Grid default
  const generateFloorLayoutGrid = useCallback((floor) => {
    return generateSlotsFromCorners(boardCorners, floor, slotScale);
  }, [boardCorners, generateSlotsFromCorners, slotScale]);

  const [slotRois, setSlotRois] = useState(() => generateFloorLayoutGrid(activeFloor));
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(-1);
  const [activeHandleIndex, setActiveHandleIndex] = useState(null);

  // Status Filter: 'ALL' | 'WRONG_SLOT' | 'UNAUTHORIZED' | 'PENDING' | 'VALID' | 'EMPTY'
  const [activeStatusFilter, setActiveStatusFilter] = useState('ALL');
  const [reassigningSlot, setReassigningSlot] = useState(null);
  const [reassignSuccessMsg, setReassignSuccessMsg] = useState('');
  const lastAlertedViolationsRef = useRef('');

  // Audio Alerts with local persistence
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('valo_cam_sound_enabled') !== 'false';
    } catch (e) {
      return true;
    }
  });

  const toggleSound = useCallback(() => {
    setIsSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('valo_cam_sound_enabled', String(next));
      } catch (e) {}
      return next;
    });
  }, []);

  // Web Audio API high-tech sound synthesizer (no external asset dependencies)
  const playAlertSound = useCallback((type = 'violation') => {
    if (!isSoundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'violation') {
        // High-tech two-tone cyber alert: 880Hz -> 440Hz
        const now = ctx.currentTime;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(440, now + 0.16);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'success') {
        // Crisp dual chime: 523Hz (C5) -> 659Hz (E5)
        const now = ctx.currentTime;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.12);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      console.debug('Audio alert playback error:', e);
    }
  }, [isSoundEnabled]);

  // Per-floor persistent scan results: { [floorId]: [slotResults] }
  const [floorScanResultsMap, setFloorScanResultsMap] = useState({});
  const [scanResults, setScanResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [aiMode, setAiMode] = useState('hybrid'); // 'hybrid' | 'gemini' | 'local'
  const [activeAiEngine, setActiveAiEngine] = useState('');
  const [lastScanDuration, setLastScanDuration] = useState(null);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(false); // Mặc định tắt để không tự quét khi chưa sẵn sàng
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showGridOverlay, setShowGridOverlay] = useState(true); // Mặc định hiển thị lưới ô đỗ để người dùng luôn thấy khung viền ô đỗ
  const [cameraMisalignedWarning, setCameraMisalignedWarning] = useState(null);
  const [floorMismatch, setFloorMismatch] = useState(null);
  const [isAiDropdownOpen, setIsAiDropdownOpen] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const streamRef = useRef(null);
  const autoScanTimerRef = useRef(null);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      if (!wasOpenRef.current) {
        wasOpenRef.current = true;
        if (currentFloorId) {
          setSelectedFloorId(currentFloorId);
        } else if (floors.length > 0) {
          setSelectedFloorId(floors[0]._id);
        }
      }
    } else {
      wasOpenRef.current = false;
    }
  }, [isOpen, currentFloorId, floors]);

  // Reset floor mismatch warning whenever user changes floor manually
  useEffect(() => {
    setFloorMismatch(null);
  }, [selectedFloorId]);

  // When active floor ACTUALLY changes, restore its scan results if any (never wipe on 5s parent polling)
  const prevRestoredFloorKeyRef = useRef(null);
  const floorScanResultsMapRef = useRef(floorScanResultsMap);
  floorScanResultsMapRef.current = floorScanResultsMap;

  useEffect(() => {
    if (!activeFloor) return;
    const floorId = activeFloor._id || activeFloor.name || 'default';
    if (prevRestoredFloorKeyRef.current === floorId) {
      return;
    }
    prevRestoredFloorKeyRef.current = floorId;
    setScanResults(floorScanResultsMapRef.current[floorId] || []);
  }, [activeFloor]);

  const lastLoadedFloorIdRef = useRef(null);

  useEffect(() => {
    if (!activeFloor) return;
    const floorId = activeFloor._id || activeFloor.name || 'default';

    // Chỉ tải lại layout khi người dùng thực sự đổi sang tầng khác
    if (lastLoadedFloorIdRef.current === floorId) {
      return;
    }
    lastLoadedFloorIdRef.current = floorId;

    const storageKey = `valo_slot_roi_floor_v7_${floorId}`;
    let loaded = false;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        const expectedSlotNames = new Set(floorData.allSlots.map((s) => s.toUpperCase()));
        const isValidForThisFloor =
          Array.isArray(parsed) &&
          parsed.length === floorData.allSlots.length &&
          parsed.length > 0 &&
          parsed.every((s) => {
            if (!s.slotCode || !expectedSlotNames.has(s.slotCode.toUpperCase())) return false;
            if (!Array.isArray(s.polygon) || s.polygon.length < 4) return false;
            const xs = s.polygon.map((p) => p[0]);
            const w = Math.max(...xs) - Math.min(...xs);
            return w >= 0.04;
          });

        if (isValidForThisFloor) {
          // Check if parsed coordinates are from old camera position (pre-UGREEN 4K)
          // With UGREEN 4K: A1 top-y should be >= 0.18, D1 left-x should be >= 0.40
          const a1 = parsed.find((s) => s.slotCode === 'A1');
          const d1 = parsed.find((s) => s.slotCode === 'D1');
          const c1 = parsed.find((s) => s.slotCode === 'C1');
          // Stale if A1 is at y<0.15 (too high - old close-up camera)
          const isStaleWallCoords = a1 && a1.polygon && Math.min(...a1.polygon.map((p) => p[1])) < 0.15;
          // Stale if D1 x < 0.35 (too far left - old coordinate system)
          const isStaleShiftedCoords = d1 && d1.polygon && Math.min(...d1.polygon.map((p) => p[0])) < 0.35;
          // Stale if C1 and D1 overlap vertically with A1 (all in same row - bad calibration)
          const a1MinY = a1 && a1.polygon ? Math.min(...a1.polygon.map((p) => p[1])) : 0;
          const c1MinY = c1 && c1.polygon ? Math.min(...c1.polygon.map((p) => p[1])) : 0;
          const isRowsMerged = c1 && a1 && Math.abs(c1MinY - a1MinY) < 0.08; // C/D row too close to A/B row
          if (!isStaleWallCoords && !isStaleShiftedCoords && !isRowsMerged) {
            setSlotRois(parsed);
            setSelectedSlotIndex(-1);
            loaded = true;
          }
        }
      }
    } catch (e) { }

    if (!loaded) {
      const layoutGrid = generateFloorLayoutGrid(activeFloor);
      setSlotRois(layoutGrid);
      setSelectedSlotIndex(-1);
    }

    // Also restore saved board corners & manual lock state for this floor
    try {
      const cStorageKey = `valo_board_corners_v7_${floorId}`;
      const savedCorners = localStorage.getItem(cStorageKey);
      if (savedCorners) {
        const parsedCorners = JSON.parse(savedCorners);
        if (Array.isArray(parsedCorners) && parsedCorners.length === 4) {
          setBoardCorners(parsedCorners);
        }
      }
      const lockKey = `valo_layout_locked_v8_${floorId}`;
      setIsLayoutLocked(localStorage.getItem(lockKey) === 'true');
    } catch (e) { }
  }, [activeFloor, floorData.allSlots, generateFloorLayoutGrid]);

  // Load cameras with persistent memory (Tự động nhớ camera USB/C270 đã chọn)
  useEffect(() => {
    async function loadCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setAvailableCameras(videoDevices);
        if (videoDevices.length > 0) {
          const savedCamId = localStorage.getItem('valo_selected_camera_id');
          const matchedSaved = videoDevices.find((d) => d.deviceId === savedCamId);
          if (matchedSaved) {
            setSelectedCameraId(matchedSaved.deviceId);
          } else if (!selectedCameraId) {
            // Ưu tiên chọn camera rời ngoài (USB / C270 / Logitech) thay vì camera laptop FaceTime
            const externalCam = videoDevices.find(
              (d) =>
                !d.label.toLowerCase().includes('facetime') &&
                !d.label.toLowerCase().includes('built-in')
            );
            setSelectedCameraId(externalCam ? externalCam.deviceId : videoDevices[0].deviceId);
          }
        }
      } catch (err) {
        console.error('Failed to enumerate cameras:', err);
      }
    }
    if (isOpen) {
      loadCameras();
    }
  }, [isOpen, selectedCameraId]);

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const constraints = {
        video: selectedCameraId
          ? {
            deviceId: { exact: selectedCameraId },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          }
          : {
            facingMode: 'environment',
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((e) => {
            // Suppress interrupted play promise
            console.debug('Video play was interrupted or aborted:', e.message);
          });
        }
      }
    } catch (err) {
      console.error('Camera stream error:', err);
    }
  }, [selectedCameraId]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (autoScanTimerRef.current) {
        clearInterval(autoScanTimerRef.current);
      }
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (autoScanTimerRef.current) {
        clearInterval(autoScanTimerRef.current);
      }
    };
  }, [isOpen, startCamera]);

  // Nudge / Move All Slots
  const handleGlobalMove = (dx, dy) => {
    setBoardCorners((prev) =>
      prev.map(([cx, cy]) => [
        Number(Math.max(0.01, Math.min(0.99, cx + dx)).toFixed(4)),
        Number(Math.max(0.01, Math.min(0.99, cy + dy)).toFixed(4)),
      ])
    );
    setSlotRois((prev) =>
      prev.map((slot) => ({
        ...slot,
        polygon: slot.polygon.map(([x, y]) => [
          Number(Math.max(0.01, Math.min(0.99, x + dx)).toFixed(4)),
          Number(Math.max(0.01, Math.min(0.99, y + dy)).toFixed(4)),
        ]),
      }))
    );
  };

  // Zoom / Scale all slots
  const handleGlobalScale = (factor) => {
    const midX = boardCorners.reduce((acc, c) => acc + c[0], 0) / 4.0;
    const midY = boardCorners.reduce((acc, c) => acc + c[1], 0) / 4.0;

    const newCorners = boardCorners.map(([cx, cy]) => [
      Number(Math.max(0.01, Math.min(0.99, midX + (cx - midX) * factor)).toFixed(4)),
      Number(Math.max(0.01, Math.min(0.99, midY + (cy - midY) * factor)).toFixed(4)),
    ]);

    setBoardCorners(newCorners);
    const updatedSlots = generateSlotsFromCorners(newCorners, activeFloor, slotScale);
    if (updatedSlots.length > 0) {
      setSlotRois(updatedSlots);
    }
  };

  // Scale individual slot dimensions (width & height independently)
  const handleSlotDimensionScale = (factorX, factorY) => {
    const newScale = {
      x: Number((slotScale.x * factorX).toFixed(3)),
      y: Number((slotScale.y * factorY).toFixed(3)),
    };
    setSlotScale(newScale);
    const updatedSlots = generateSlotsFromCorners(boardCorners, activeFloor, newScale);
    if (updatedSlots.length > 0) {
      setSlotRois(updatedSlots);
    }
  };

  // Save Calibration to LocalStorage & lock so Scan Parking Lot won't overwrite manual layout
  const handleSaveCalibration = () => {
    if (!activeFloor) return;
    const fKey = activeFloor._id || activeFloor.name || 'default';
    localStorage.setItem(`valo_slot_roi_floor_v7_${fKey}`, JSON.stringify(slotRois));
    localStorage.setItem(`valo_board_corners_v7_${fKey}`, JSON.stringify(boardCorners));
    localStorage.setItem(`valo_layout_locked_v8_${fKey}`, 'true');
    setIsLayoutLocked(true);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleToggleLayoutLock = () => {
    if (!activeFloor) return;
    const fKey = activeFloor._id || activeFloor.name || 'default';
    const nextLocked = !isLayoutLocked;
    setIsLayoutLocked(nextLocked);
    localStorage.setItem(`valo_layout_locked_v8_${fKey}`, String(nextLocked));
    toast.success(nextLocked ? 'Layout locked: scans will preserve your calibrated grid.' : 'Auto-align unlocked: next scan will automatically detect perspective & slot grid.');
  };

  const handleResetToDiorama = () => {
    if (!activeFloor) return;
    const fKey = activeFloor._id || activeFloor.name || 'default';
    const storageKey = `valo_slot_roi_floor_v7_${fKey}`;
    localStorage.removeItem(storageKey);
    localStorage.removeItem(`valo_board_corners_v7_${fKey}`);
    localStorage.setItem(`valo_layout_locked_v8_${fKey}`, 'false');
    setIsLayoutLocked(false);
    setBoardCorners(DEFAULT_BOARD_CORNERS);
    setSlotScale({ x: 1.0, y: 1.0 });
    const layout = generateSlotsFromCorners(DEFAULT_BOARD_CORNERS, activeFloor, { x: 1.0, y: 1.0 });
    setSlotRois(layout);
    localStorage.setItem(storageKey, JSON.stringify(layout));
    setSelectedSlotIndex(-1);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };



  // AI Auto Detect Floor Grid
  const handleAutoDetectFloor = async () => {
    if (!videoRef.current || !videoRef.current.videoWidth || isAutoDetecting) return;
    setIsAutoDetecting(true);
    try {
      const video = videoRef.current;
      // Cap resolution at 1920×1080 to reduce payload size (~4× faster than 4K)
      const MAX_W = 1920;
      const MAX_H = 1080;
      const scale = Math.min(1, MAX_W / video.videoWidth, MAX_H / video.videoHeight);
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.round(video.videoWidth * scale);
      offscreen.height = Math.round(video.videoHeight * scale);
      const ctx = offscreen.getContext('2d');
      ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
      const base64Image = offscreen.toDataURL('image/jpeg', 0.88); // 0.88 quality saves ~30% size vs 0.95

      const token = localStorage.getItem('token') || localStorage.getItem('accessToken') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE}/ai/auto-detect-grid`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image: base64Image,
          slotCodes: floorData.allSlots,
        }),
      });

      const data = await response.json();
      if (data.success) {
        const fKey = activeFloor ? (activeFloor._id || activeFloor.name || 'default') : 'default';
        let didCalibrate = false;
        if (Array.isArray(data.slots) && data.slots.length > 0) {
          setSlotRois(data.slots);
          setSelectedSlotIndex(-1);
          if (Array.isArray(data.corners) && data.corners.length === 4) {
            setBoardCorners(data.corners);
            localStorage.setItem(`valo_board_corners_v7_${fKey}`, JSON.stringify(data.corners));
          }
          if (activeFloor) {
            localStorage.setItem(`valo_slot_roi_floor_v7_${fKey}`, JSON.stringify(data.slots));
          }
          didCalibrate = true;
        } else if (Array.isArray(data.corners) && data.corners.length === 4) {
          setBoardCorners(data.corners);
          localStorage.setItem(`valo_board_corners_v7_${fKey}`, JSON.stringify(data.corners));
          const alignedSlots = generateSlotsFromCorners(data.corners, activeFloor, slotScale);
          if (alignedSlots.length > 0) {
            setSlotRois(alignedSlots);
            setSelectedSlotIndex(-1);
            if (activeFloor) {
              localStorage.setItem(`valo_slot_roi_floor_v7_${fKey}`, JSON.stringify(alignedSlots));
            }
            didCalibrate = true;
          }
        }
        if (didCalibrate) {
          toast.success('Calibrated! Auto-Align stays active; click Save Layout only if you want to lock manually.');
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } catch (err) {
      console.error('Auto detect floor failed:', err);
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const occupancyMemoryRef = useRef(new Map());

  // Capture and scan slots
  const captureAndScanSlots = useCallback(async (customSlots = null, forceDeep = false) => {
    const slotsToScan = Array.isArray(customSlots) && customSlots.length > 0 ? customSlots : slotRois;
    if (!videoRef.current || !videoRef.current.videoWidth || isScanning || !Array.isArray(slotsToScan) || slotsToScan.length === 0) return;
    setIsScanning(true);
    const scanStartTime = Date.now();
    try {
      const video = videoRef.current;
      // Cap resolution at 1600×900 (keeps far-row plates sharp while cutting payload & decode ~40%)
      const MAX_W = 1600;
      const MAX_H = 900;
      const scale = Math.min(1, MAX_W / video.videoWidth, MAX_H / video.videoHeight);
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.round(video.videoWidth * scale);
      offscreen.height = Math.round(video.videoHeight * scale);
      const ctx = offscreen.getContext('2d');
      ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
      const base64Image = offscreen.toDataURL('image/jpeg', 0.85);

      // Lightweight evidence crops (320px for Gemini Deep Vision, 160px for fast Edge ALPR audit logs)
      const cropsMap = {};
      const useLargeCrops = forceDeep || aiMode === 'gemini';
      const cropTargetW = useLargeCrops ? 320 : 160;
      const cropQuality = useLargeCrops ? 0.85 : 0.72;
      try {
        for (const s of slotsToScan) {
          if (s.polygon && s.polygon.length >= 3) {
            const xs = s.polygon.map((p) => p[0]);
            const ys = s.polygon.map((p) => p[1]);
            let minX = Math.min(...xs);
            let maxX = Math.max(...xs);
            let minY = Math.min(...ys);
            let maxY = Math.max(...ys);

            const padX = (maxX - minX) * 0.20;
            const padY = (maxY - minY) * 0.20;
            minX = Math.max(0, minX - padX);
            maxX = Math.min(1, maxX + padX);
            minY = Math.max(0, minY - padY);
            maxY = Math.min(1, maxY + padY);

            const sx = minX * offscreen.width;
            const sy = minY * offscreen.height;
            const sWidth = (maxX - minX) * offscreen.width;
            const sHeight = (maxY - minY) * offscreen.height;

            if (sWidth > 10 && sHeight > 10) {
              const cropCanvas = document.createElement('canvas');
              cropCanvas.width = cropTargetW;
              cropCanvas.height = Math.round(cropTargetW * (sHeight / sWidth)) || 120;
              const cctx = cropCanvas.getContext('2d');
              cctx.drawImage(offscreen, sx, sy, sWidth, sHeight, 0, 0, cropCanvas.width, cropCanvas.height);
              cropsMap[s.slotCode] = cropCanvas.toDataURL('image/jpeg', cropQuality);
            }
          }
        }
      } catch (cropErr) {
        console.warn('Slot crop error:', cropErr);
      }

      const token = localStorage.getItem('token') || localStorage.getItem('accessToken') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE}/ai/scan-slots`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image: base64Image,
          slots: slotsToScan,
          crops: cropsMap,
          aiMode: forceDeep ? 'gemini' : aiMode,
          forceDeepScan: forceDeep,
          skipAutoCalibrate: isLayoutLocked,
          currentFloor: activeFloor ? {
            id: activeFloor._id,
            name: activeFloor.name,
            floorNumber: activeFloor.floorNumber || (activeFloor.name?.includes('2') ? 2 : 1),
          } : null,
        }),
      });

      const data = await response.json();
      setLastScanDuration(((Date.now() - scanStartTime) / 1000).toFixed(1));
      if (data.model) {
        setActiveAiEngine(data.model);
      }

      // Check 1: Camera Misalignment (looking at user face or wall)
      if (data.isCameraMisaligned) {
        let msg = data.warningMessage || 'Camera angle is misaligned or not facing the parking lot!';
        if (msg.includes('mặt người') || msg.includes('không gian phòng') || msg.includes('phòng thay vì')) {
          msg = 'Camera is facing user face or room environment instead of the parking lot! Please adjust camera angle.';
        } else if (msg.includes('bị lệch') || msg.includes('không hướng vào') || msg.includes('Không nhận diện')) {
          msg = 'Camera angle is misaligned or not facing the parking lot! Physical parking grid not detected.';
        }
        setCameraMisalignedWarning(msg);
        setFloorMismatch(null);
        setScanResults([]);
        playAlertSound(false);
        return;
      }
      setCameraMisalignedWarning(null);

      // Check 2: Floor Level Mismatch (camera looking at Floor 2 while Floor 1 is selected)
      if (data.isFloorMismatch) {
        setFloorMismatch({
          detectedFloorNumber: data.detectedFloorNumber,
          detectedFloorName: data.detectedFloorName,
          selectedFloorName: data.selectedFloorName || activeFloor?.name || 'Selected Floor',
          warningMessage: data.warningMessage || `Camera is pointing at ${data.detectedFloorName}, but ${data.selectedFloorName || 'another floor'} is selected!`,
        });
        setScanResults([]);
        playAlertSound(false);
        return;
      }
      setFloorMismatch(null);

      if (data.success && Array.isArray(data.slots)) {
        const currentFloorKey = activeFloor?._id || activeFloor?.name || 'default';
        const freshSlots = data.slots;

        // Only update slot boundaries from scan when layout is NOT manually locked
        if (!isLayoutLocked) {
          if (Array.isArray(data.calibratedSlots) && data.calibratedSlots.length > 0) {
            setSlotRois(data.calibratedSlots);
            const storageKey = `valo_slot_roi_floor_v7_${currentFloorKey}`;
            localStorage.setItem(storageKey, JSON.stringify(data.calibratedSlots));
          }
          if (Array.isArray(data.corners) && data.corners.length === 4) {
            setBoardCorners(data.corners);
            const cStorageKey = `valo_board_corners_v7_${currentFloorKey}`;
            localStorage.setItem(cStorageKey, JSON.stringify(data.corners));
          }
        }

        // Build map of freshly confirmed plates -> list of slotCodes (prevents ghost green card when vehicle moves/re-aligns)
        const freshPlateSlots = new Map();
        freshSlots.forEach((r) => {
          if (r.occupied && (r.plate || r.detectedPlate)) {
            const np = (r.plate || r.detectedPlate).replace(/[^A-Z0-9]/gi, '').toUpperCase();
            if (np) {
              if (!freshPlateSlots.has(np)) freshPlateSlots.set(np, []);
              freshPlateSlots.get(np).push(r.slotCode?.toUpperCase());
            }
          }
        });

        // --- Temporal Smoothing: stabilize results across scans ---
        // Update occupancy memory with current scan
        freshSlots.forEach((s) => {
          const key = s.slotCode?.toUpperCase();
          if (!key) return;
          const prev = occupancyMemoryRef.current.get(key) || { occupiedCount: 0, emptyCount: 0, lastPlate: null };
          if (s.occupied && s.plate) {
            prev.occupiedCount = Math.min((prev.occupiedCount || 0) + 1, 3);
            prev.emptyCount = 0;
            prev.lastPlate = s.plate;
            prev.lastStatus = s.status;
            prev.lastViolationType = s.violationType;
            prev.lastIsViolation = s.isViolation;
            prev.lastExpectedSlot = s.expectedSlot;
            prev.lastViolationMessage = s.violationMessage;
            prev.lastSession = s.session;
            prev.lastOccupiedByOverlap = s.occupiedByOverlap;
            prev.lastPrimarySlot = s.primarySlot;
          } else {
            const normPrevPlate = prev.lastPlate ? prev.lastPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
            const movedElsewhere = normPrevPlate && freshPlateSlots.has(normPrevPlate) && !freshPlateSlots.get(normPrevPlate).includes(key);
            if (movedElsewhere) {
              prev.occupiedCount = 0;
              prev.emptyCount = 3;
              prev.lastPlate = null;
            } else {
              prev.emptyCount = Math.min((prev.emptyCount || 0) + 1, 3);
              // Only clear occupied if consistently empty 2+ scans
              if (prev.emptyCount >= 2) {
                prev.occupiedCount = 0;
                prev.lastPlate = null;
              }
            }
          }
          occupancyMemoryRef.current.set(key, prev);
        });
        // Apply memory ONLY if the plate isn't already accounted for at another slot in freshSlots
        const smoothedSlots = freshSlots.map((s) => {
          const key = s.slotCode?.toUpperCase();
          const mem = occupancyMemoryRef.current.get(key);
          const normMemPlate = mem?.lastPlate ? mem.lastPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() : '';
          const alreadyActiveElsewhere = normMemPlate && freshPlateSlots.has(normMemPlate) && !freshPlateSlots.get(normMemPlate).includes(key);
          if (!s.occupied && mem && mem.occupiedCount >= 1 && mem.lastPlate && !alreadyActiveElsewhere) {
            return {
              ...s,
              occupied: true,
              plate: mem.lastPlate,
              status: mem.lastStatus || s.status,
              violationType: mem.lastViolationType || s.violationType,
              isViolation: Boolean(mem.lastIsViolation),
              expectedSlot: mem.lastExpectedSlot || s.expectedSlot,
              violationMessage: mem.lastViolationMessage || s.violationMessage,
              session: mem.lastSession || s.session,
              occupiedByOverlap: Boolean(mem.lastOccupiedByOverlap),
              primarySlot: mem.lastPrimarySlot || s.primarySlot,
              _fromMemory: true,
            };
          }
          return s;
        });

        setScanResults(smoothedSlots);
        setFloorScanResultsMap((prev) => {
          const updated = {};
          Object.entries(prev).forEach(([fId, fSlots]) => {
            if (fId === currentFloorKey) return;
            updated[fId] = fSlots.filter((s) => {
              const p = (s.plate || s.detectedPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
              return !p || !currentPlates.has(p);
            });
          });
          updated[currentFloorKey] = smoothedSlots;
          return updated;
        });

        if (onSlotStatusUpdate) {
          onSlotStatusUpdate(smoothedSlots, currentFloorKey);
        }

        // Smart Audio Alert: trigger distinct cyber alert if violations are detected
        const activeViolations = smoothedSlots.filter((s) => s.status === 'WRONG_SLOT_VIOLATION' || s.status === 'UNAUTHORIZED_PARKING');
        const vKey = activeViolations.map((v) => `${v.slotCode}:${v.plate || v.detectedPlate || ''}:${v.status}`).sort().join('|');
        if (activeViolations.length > 0 && vKey !== lastAlertedViolationsRef.current) {
          lastAlertedViolationsRef.current = vKey;
          playAlertSound('violation');
        } else if (activeViolations.length === 0) {
          lastAlertedViolationsRef.current = '';
        }
      }
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  }, [activeFloor, isScanning, slotRois, aiMode, isLayoutLocked, onSlotStatusUpdate, playAlertSound]);

  // Auto-switch floor when AI detects camera is pointing at another floor
  const handleAutoSwitchFloor = useCallback((targetFloorNumber, targetFloorName) => {
    if (!floors || floors.length === 0) return;
    const targetFloor = floors.find((f) => {
      if (f.floorNumber && Number(f.floorNumber) === Number(targetFloorNumber)) return true;
      if (f.name) {
        const nameLower = f.name.toLowerCase();
        if (targetFloorNumber && (nameLower.includes(`floor ${targetFloorNumber}`) || nameLower.includes(`tầng ${targetFloorNumber}`) || nameLower.endsWith(targetFloorNumber.toString()))) return true;
        if (targetFloorName && nameLower.includes(targetFloorName.toLowerCase())) return true;
      }
      return false;
    });

    if (targetFloor) {
      setSelectedFloorId(targetFloor._id);
      setActiveZoneFilter('ALL');
      setActiveStatusFilter('ALL');
      setFloorMismatch(null);
      setScanResults([]);
      toast.success(`Switched to ${targetFloor.name}. Re-scanning...`);
      setTimeout(() => {
        captureAndScanSlots(null, aiMode === 'gemini');
      }, 450);
    } else {
      toast.error(`Target floor not found in facility.`);
    }
  }, [floors, captureAndScanSlots, aiMode]);

  // 1-Click Fast Reassign to resolve wrong-slot violations
  const handleQuickReassignSlot = useCallback(async (session, targetSlotCode) => {
    if (!session || !session._id || !targetSlotCode || reassigningSlot) return;
    setReassigningSlot(targetSlotCode);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('accessToken') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/sessions/${session._id}/reassign-slot`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          newSlotCode: targetSlotCode,
          floorId: activeFloor?._id,
          reason: 'Staff 1-Click Fast AI Camera Reassign'
        })
      });
      const data = await res.json();
      if (data.success) {
        playAlertSound('success');
        setReassignSuccessMsg(`Reassigned vehicle ${session.licensePlate || ''} to slot ${targetSlotCode}!`);
        setTimeout(() => setReassignSuccessMsg(''), 4000);

        setScanResults((prev) => {
          const updated = prev.map((item) => {
            if (item.slotCode === targetSlotCode) {
              return {
                ...item,
                status: 'OCCUPIED_VALID',
                isViolation: false,
                violationType: null,
                violationMessage: null,
                occupied: true,
                plate: session.licensePlate,
                expectedSlot: targetSlotCode,
                session: {
                  ...session,
                  parkingSlot: targetSlotCode
                }
              };
            }
            return item;
          });
          const currentFloorKey = activeFloor?._id || activeFloor?.name || 'default';
          if (onSlotStatusUpdate) {
            onSlotStatusUpdate(updated, currentFloorKey);
          }
          return updated;
        });

        // Trigger scan to update overall state
        setTimeout(() => {
          captureAndScanSlots();
        }, 500);
      } else {
        alert(data.message || 'Failed to reassign parking slot');
      }
    } catch (err) {
      console.error('Quick reassign error:', err);
      alert('Connection error while reassigning parking slot');
    } finally {
      setReassigningSlot(null);
    }
  }, [activeFloor, captureAndScanSlots, onSlotStatusUpdate, playAlertSound, reassigningSlot]);

  // Auto scan interval: 8 seconds for lightweight background execution
  useEffect(() => {
    if (isOpen && autoScanEnabled && mode === 'monitor') {
      autoScanTimerRef.current = setInterval(() => {
        captureAndScanSlots();
      }, 8000);
    } else if (autoScanTimerRef.current) {
      clearInterval(autoScanTimerRef.current);
    }
    return () => {
      if (autoScanTimerRef.current) clearInterval(autoScanTimerRef.current);
    };
  }, [isOpen, autoScanEnabled, mode, captureAndScanSlots]);

  const hasScanned = Boolean(scanResults && scanResults.length > 0);

  // Resolve Slot Status and Derived Values BEFORE drawOverlay (Fixing Hook Hoisting)
  const resolveSlotStatus = useCallback((slotCode) => {
    if (!scanResults || scanResults.length === 0) {
      return null;
    }
    return scanResults.find((r) => r.slotCode === slotCode) || null;
  }, [scanResults]);

  const allResolvedSlots = useMemo(() => {
    if (!hasScanned) return [];
    return slotRois.map((slot) => {
      const res = resolveSlotStatus(slot.slotCode);
      return res || { slotCode: slot.slotCode, status: 'AVAILABLE', occupied: false };
    });
  }, [slotRois, resolveSlotStatus, hasScanned]);

  const totalSlots = slotRois.length;
  const isTransitRes = (r) => {
    const vt = r?.violationType || r?.status;
    return vt === 'CHECKED_IN_PENDING_PARK' || vt === 'EXITING_TO_GATE';
  };
  const occupiedSlots = hasScanned
    ? allResolvedSlots.filter((r) => r.occupied || r.status === 'OCCUPIED_VALID' || (r.isViolation && !isTransitRes(r))).length
    : 0;

  const violations = useMemo(() => {
    if (!hasScanned) return [];
    const list = allResolvedSlots.filter((r) => {
      if (isTransitRes(r)) return false;
      return (
        r.status === 'WRONG_SLOT_VIOLATION' ||
        r.status === 'DOUBLE_PARKING_VIOLATION' ||
        r.violationType === 'DOUBLE_PARKING_VIOLATION' ||
        r.status === 'UNAUTHORIZED_PARKING' ||
        Boolean(r.isViolation)
      );
    });
    const seenKeys = new Set();
    return list.filter((v) => {
      const p = (v.plate || v.detectedPlate || v.expectedPlate || v.session?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const vKind = v.violationType || v.status || 'ALERT';
      const dedupKey = p ? `${p}_${vKind}` : v.slotCode;
      if (dedupKey) {
        if (seenKeys.has(dedupKey)) return false;
        seenKeys.add(dedupKey);
      }
      return true;
    });
  }, [allResolvedSlots, hasScanned]);

  const wrongSlotCount = useMemo(() => violations.filter((v) => v.status === 'WRONG_SLOT_VIOLATION' || v.violationType === 'WRONG_SLOT_VIOLATION').length, [violations]);
  const unauthCount = useMemo(() => violations.filter((v) => v.status === 'UNAUTHORIZED_PARKING' || v.violationType === 'UNAUTHORIZED_PARKING').length, [violations]);
  const pendingCount = useMemo(() => hasScanned ? allResolvedSlots.filter((v) => v.status === 'CHECKED_IN_PENDING_PARK' || v.violationType === 'CHECKED_IN_PENDING_PARK').length : 0, [allResolvedSlots, hasScanned]);
  const exitingCount = useMemo(() => hasScanned ? allResolvedSlots.filter((v) => v.status === 'EXITING_TO_GATE' || v.violationType === 'EXITING_TO_GATE').length : 0, [allResolvedSlots, hasScanned]);
  const validCount = useMemo(() => hasScanned ? allResolvedSlots.filter((s) => s.status === 'OCCUPIED_VALID' || (s.occupied && !s.isViolation)).length : 0, [allResolvedSlots, hasScanned]);
  const availableCount = hasScanned ? Math.max(0, totalSlots - occupiedSlots - pendingCount - exitingCount) : 0;

  // Smart sorted & filtered slot list: Pinned alerts on top, followed by transit/parked, then available
  const sortedAndFilteredSlots = useMemo(() => {
    return slotRois
      .filter((s) => {
        // Zone filter
        if (activeZoneFilter !== 'ALL' && !s.slotCode.startsWith(activeZoneFilter)) {
          return false;
        }
        // Status filter
        const res = resolveSlotStatus(s.slotCode);
        const isWrong = res?.status === 'WRONG_SLOT_VIOLATION' || res?.violationType === 'WRONG_SLOT_VIOLATION';
        const isDouble = res?.status === 'DOUBLE_PARKING_VIOLATION' || res?.violationType === 'DOUBLE_PARKING_VIOLATION' || Boolean(res?.occupiedByOverlap);
        const isUnauth = res?.status === 'UNAUTHORIZED_PARKING' || res?.violationType === 'UNAUTHORIZED_PARKING';
        const isPending = res?.status === 'CHECKED_IN_PENDING_PARK' || res?.violationType === 'CHECKED_IN_PENDING_PARK';
        const isExiting = res?.status === 'EXITING_TO_GATE' || res?.violationType === 'EXITING_TO_GATE';
        const isTransit = isPending || isExiting;
        const isAlert = isWrong || isDouble || isUnauth || (Boolean(res?.isViolation) && !isTransit);
        const isValid = res?.status === 'OCCUPIED_VALID' || (res?.occupied && !isWrong && !isDouble && !isUnauth);
        const isEmpty = !res?.occupied && !isWrong && !isDouble && !isUnauth && !isTransit;

        if (activeStatusFilter === 'ALERTS') return isAlert;
        if (activeStatusFilter === 'VALID') return isValid;
        if (activeStatusFilter === 'EMPTY') return isEmpty;
        return true;
      })
      .sort((a, b) => {
        const resA = resolveSlotStatus(a.slotCode);
        const resB = resolveSlotStatus(b.slotCode);
        const isTransitA = resA?.status === 'CHECKED_IN_PENDING_PARK' || resA?.violationType === 'CHECKED_IN_PENDING_PARK' || resA?.status === 'EXITING_TO_GATE' || resA?.violationType === 'EXITING_TO_GATE';
        const isTransitB = resB?.status === 'CHECKED_IN_PENDING_PARK' || resB?.violationType === 'CHECKED_IN_PENDING_PARK' || resB?.status === 'EXITING_TO_GATE' || resB?.violationType === 'EXITING_TO_GATE';
        const isAlertA = resA?.status === 'WRONG_SLOT_VIOLATION' || resA?.violationType === 'WRONG_SLOT_VIOLATION' || resA?.status === 'UNAUTHORIZED_PARKING' || resA?.violationType === 'UNAUTHORIZED_PARKING' || (Boolean(resA?.isViolation) && !isTransitA);
        const isAlertB = resB?.status === 'WRONG_SLOT_VIOLATION' || resB?.violationType === 'WRONG_SLOT_VIOLATION' || resB?.status === 'UNAUTHORIZED_PARKING' || resB?.violationType === 'UNAUTHORIZED_PARKING' || (Boolean(resB?.isViolation) && !isTransitB);

        // Pin active alerts to the top, followed by transit vehicles (arriving/exiting)
        if (isAlertA && !isAlertB) return -1;
        if (!isAlertA && isAlertB) return 1;
        if (isTransitA && !isTransitB) return -1;
        if (!isTransitA && isTransitB) return 1;

        // Occupied cars next
        const occA = resA?.occupied ? 1 : 0;
        const occB = resB?.occupied ? 1 : 0;
        if (occA !== occB) return occB - occA;

        // Natural alphanumeric order
        return a.slotCode.localeCompare(b.slotCode, undefined, { numeric: true });
      });
  }, [slotRois, activeZoneFilter, activeStatusFilter, resolveSlotStatus]);

  // Precise Video Render Rect to eliminate letterboxing distortions
  const getVideoRenderRect = useCallback(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || !container) {
      const w = container ? container.clientWidth : 1;
      const h = container ? container.clientHeight : 1;
      return { x: 0, y: 0, width: w, height: h };
    }
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const videoRatio = vw / vh;
    const containerRatio = cw / ch;

    let renderW, renderH, offsetX, offsetY;
    if (containerRatio > videoRatio) {
      renderH = ch;
      renderW = ch * videoRatio;
      offsetX = (cw - renderW) / 2;
      offsetY = 0;
    } else {
      renderW = cw;
      renderH = cw / videoRatio;
      offsetX = 0;
      offsetY = (ch - renderH) / 2;
    }
    return { x: offsetX, y: offsetY, width: renderW, height: renderH };
  }, []);

  const toScreenCoords = useCallback((nx, ny) => {
    const vr = getVideoRenderRect();
    return [vr.x + nx * vr.width, vr.y + ny * vr.height];
  }, [getVideoRenderRect]);

  const toNormCoords = useCallback((clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return [0, 0];
    const rect = container.getBoundingClientRect();
    const vr = getVideoRenderRect();
    const mx = Math.max(0, Math.min(1, (clientX - rect.left - vr.x) / vr.width));
    const my = Math.max(0, Math.min(1, (clientY - rect.top - vr.y) / vr.height));
    return [Number(mx.toFixed(4)), Number(my.toFixed(4))];
  }, [getVideoRenderRect]);

  // Draw overlays on Canvas
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const width = (canvas.width = rect.width);
    const height = (canvas.height = rect.height);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // If camera is misaligned and pointing away from parking diorama, don't draw slot polygons
    if (cameraMisalignedWarning && mode !== 'calibrate') {
      return;
    }

    // 1. In Calibrate mode: Draw 4 Board Corner Pins & Outer Quad
    if (mode === 'calibrate') {
      const cornerPts = boardCorners.map(([nx, ny]) => toScreenCoords(nx, ny));

      // Draw outer quad boundary
      ctx.beginPath();
      ctx.setLineDash([6, 6]);
      ctx.moveTo(cornerPts[0][0], cornerPts[0][1]);
      ctx.lineTo(cornerPts[1][0], cornerPts[1][1]);
      ctx.lineTo(cornerPts[2][0], cornerPts[2][1]);
      ctx.lineTo(cornerPts[3][0], cornerPts[3][1]);
      ctx.closePath();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.04)';
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw 4 interactive corner pin handles
      const cornerLabels = ['TL (Top-Left)', 'TR (Top-Right)', 'BR (Bottom-Right)', 'BL (Bottom-Left)'];
      cornerPts.forEach(([cx, cy], cIdx) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ctx.fillStyle = activeCornerIndex === cIdx ? '#ef4444' : '#f59e0b';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Corner Label
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(cx - 35, cy - 26, 70, 16);
        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.fillText(cornerLabels[cIdx], cx, cy - 14);
        ctx.textAlign = 'left';
      });
    }

    // 2. Draw Slot Polygons
    slotRois.forEach((slot, sIdx) => {
      const result = resolveSlotStatus(slot.slotCode);
      const activePoly = slot.polygon;
      if (!activePoly || activePoly.length < 3) return;
      const pts = activePoly.map(([nx, ny]) => toScreenCoords(nx, ny));
      if (pts.length < 3) return;

      const isDoubleParking = result?.status === 'DOUBLE_PARKING_VIOLATION' || result?.violationType === 'DOUBLE_PARKING_VIOLATION' || Boolean(result?.occupiedByOverlap);
      const isWrongSlot = result?.status === 'WRONG_SLOT_VIOLATION' || result?.violationType === 'WRONG_SLOT_VIOLATION';
      const isUnauthorized = result?.status === 'UNAUTHORIZED_PARKING' || result?.violationType === 'UNAUTHORIZED_PARKING';
      const isPendingPark = result?.status === 'CHECKED_IN_PENDING_PARK' || result?.violationType === 'CHECKED_IN_PENDING_PARK';
      const isExiting = result?.status === 'EXITING_TO_GATE' || result?.violationType === 'EXITING_TO_GATE';
      const isTransit = isPendingPark || isExiting;
      const isViolation = isDoubleParking || isWrongSlot || isUnauthorized || (Boolean(result?.isViolation) && !isTransit);
      const isOccupied = result?.occupied || result?.status === 'OCCUPIED_VALID' || isViolation;
      const isSelected = sIdx === selectedSlotIndex;

      // Giữ khung bám sát vạch sơn thực tế (hệ số 1.01), tránh phình sang ô bên cạnh khi nhìn góc nghiêng
      let drawPts = pts;
      if (isOccupied && mode !== 'calibrate') {
        const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
        const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
        drawPts = pts.map(([px, py]) => [
          cx + (px - cx) * 1.01,
          cy + (py - cy) * 1.01,
        ]);
      }

      ctx.beginPath();
      ctx.moveTo(drawPts[0][0], drawPts[0][1]);
      for (let i = 1; i < drawPts.length; i++) {
        ctx.lineTo(drawPts[i][0], drawPts[i][1]);
      }
      ctx.closePath();

      if (mode === 'calibrate') {
        ctx.strokeStyle = isSelected ? '#fbbf24' : 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = isSelected ? 2.5 : 1.2;
        ctx.fillStyle = isSelected ? 'rgba(251, 191, 36, 0.18)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        ctx.stroke();

        if (isSelected) {
          pts.forEach(([hx, hy], hIdx) => {
            ctx.beginPath();
            ctx.arc(hx, hy, 6, 0, Math.PI * 2);
            ctx.fillStyle = activeHandleIndex === hIdx ? '#ef4444' : '#fbbf24';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#000';
            ctx.stroke();
          });
        }
      } else {
        // Chế độ Live Monitor: Hiển thị với phong cách Neon Cyber sắc nét
        if (isDoubleParking) {
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 3.5;
          ctx.fillStyle = 'rgba(249, 115, 22, 0.28)';
          ctx.fill();
          ctx.stroke();
        } else if (isWrongSlot) {
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 3.5;
          ctx.fillStyle = 'rgba(244, 63, 94, 0.28)';
          ctx.fill();
          ctx.stroke();
        } else if (isUnauthorized) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 3.0;
          ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
          ctx.fill();
          ctx.stroke();
        } else if (isPendingPark) {
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 3.0;
          ctx.setLineDash([6, 4]);
          ctx.fillStyle = 'rgba(168, 85, 247, 0.22)';
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (isExiting) {
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 3.0;
          ctx.setLineDash([6, 4]);
          ctx.fillStyle = 'rgba(6, 182, 212, 0.22)';
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (isOccupied) {
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 2.5;
          ctx.fillStyle = 'rgba(16, 185, 129, 0.20)';
          ctx.fill();
          ctx.stroke();
        } else if (showGridOverlay) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
          ctx.fill();
          ctx.stroke();
        } else {
          // Ô trống và không bật hiện lưới -> Không vẽ gì để giữ màn hình camera sạch sẽ 100%
          return;
        }
      }

      // Vẽ HUD Brackets ngắm bắn theo đúng 4 cạnh phối cảnh nếu người dùng click chọn ô
      if (isSelected && mode === 'monitor' && selectedSlotIndex >= 0 && drawPts.length === 4) {
        const cxS = drawPts.reduce((sum, p) => sum + p[0], 0) / 4;
        const cyS = drawPts.reduce((sum, p) => sum + p[1], 0) / 4;
        const padPts = drawPts.map(([px, py]) => {
          const dx = px - cxS;
          const dy = py - cyS;
          const len = Math.hypot(dx, dy) || 1;
          return [px + (dx / len) * 5, py + (dy / len) * 5];
        });
        const bLen = 12;

        ctx.save();
        ctx.strokeStyle = isDoubleParking ? '#f97316' : isWrongSlot ? '#f43f5e' : isUnauthorized ? '#f59e0b' : isPendingPark ? '#c084fc' : isExiting ? '#22d3ee' : isOccupied ? '#10b981' : '#38bdf8';
        ctx.lineWidth = 2.5;

        for (let ci = 0; ci < 4; ci++) {
          const curr = padPts[ci];
          const prev = padPts[(ci + 3) % 4];
          const next = padPts[(ci + 1) % 4];
          const prevLen = Math.hypot(prev[0] - curr[0], prev[1] - curr[1]) || 1;
          const nextLen = Math.hypot(next[0] - curr[0], next[1] - curr[1]) || 1;
          const arm1 = Math.min(bLen, prevLen * 0.35);
          const arm2 = Math.min(bLen, nextLen * 0.35);

          ctx.beginPath();
          ctx.moveTo(curr[0] + ((prev[0] - curr[0]) / prevLen) * arm1, curr[1] + ((prev[1] - curr[1]) / prevLen) * arm1);
          ctx.lineTo(curr[0], curr[1]);
          ctx.lineTo(curr[0] + ((next[0] - curr[0]) / nextLen) * arm2, curr[1] + ((next[1] - curr[1]) / nextLen) * arm2);
          ctx.stroke();
        }

        ctx.restore();
      }

      // High-tech Centered Cyber Slot Badge (Clamped to avoid overlap)
      ctx.save();
      ctx.font = 'bold 9.5px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      const plateText = result?.plate || result?.detectedPlate;
      const pendingPlate = result?.expectedPlate || result?.session?.licensePlate;
      const slotText = isDoubleParking
        ? `⛔ ${slot.slotCode}${plateText ? ` • ${formatLicensePlateDisplay(plateText)}` : ' • 2 SLOTS'}`
        : isWrongSlot
          ? `🚨 ${slot.slotCode}${plateText ? ` • ${formatLicensePlateDisplay(plateText)}` : ''}`
        : isUnauthorized
          ? `⚠️ ${slot.slotCode}${plateText ? ` • ${formatLicensePlateDisplay(plateText)}` : ''}`
          : isPendingPark
            ? `⏳ ${slot.slotCode}${pendingPlate ? ` • ${formatLicensePlateDisplay(pendingPlate)}` : ''}`
            : isExiting
              ? `↗ ${slot.slotCode}${pendingPlate ? ` • ${formatLicensePlateDisplay(pendingPlate)}` : ''}`
              : isOccupied
                ? `✅ ${slot.slotCode}${plateText ? ` • ${formatLicensePlateDisplay(plateText)}` : ''}`
                : slot.slotCode;
      
      const textMetrics = ctx.measureText(slotText);
      const pillW = textMetrics.width + 10;
      const pillH = 16;
      const topCenterX = (pts[0][0] + pts[1][0]) / 2;
      const topCenterY = (pts[0][1] + pts[1][1]) / 2;

      // Center horizontally on top edge of slot polygon and clamp within canvas bounds
      let pillX = topCenterX - pillW / 2;
      const canvasW = canvasRef.current?.width || 800;
      pillX = Math.max(4, Math.min(canvasW - pillW - 4, pillX));
      const pillY = Math.max(4, topCenterY - pillH - 3);

      // Pill backdrop with high-tech glow & shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = isDoubleParking
        ? 'rgba(234, 88, 12, 0.95)'
        : isWrongSlot
          ? 'rgba(225, 29, 72, 0.95)'
        : isUnauthorized
          ? 'rgba(217, 119, 6, 0.95)'
          : isPendingPark
            ? 'rgba(124, 58, 237, 0.95)'
            : isExiting
              ? 'rgba(8, 145, 178, 0.95)'
              : isOccupied
                ? 'rgba(5, 150, 105, 0.95)'
                : 'rgba(15, 23, 42, 0.88)';
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 4);
      ctx.fill();

      // Pill border
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = isDoubleParking
        ? 'rgba(255, 255, 255, 0.5)'
        : isWrongSlot
          ? 'rgba(255, 255, 255, 0.45)'
        : isUnauthorized
          ? 'rgba(255, 255, 255, 0.4)'
          : isTransit
            ? 'rgba(255, 255, 255, 0.45)'
            : isOccupied
              ? 'rgba(255, 255, 255, 0.35)'
              : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // White centered crisp text
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(slotText, pillX + pillW / 2, pillY + pillH / 2 + 0.5);
      ctx.restore();
    });
  }, [mode, boardCorners, toScreenCoords, slotRois, resolveSlotStatus, selectedSlotIndex, activeCornerIndex, activeHandleIndex, showGridOverlay]);

  useEffect(() => {
    let animId;
    const render = () => {
      drawOverlay();
      animId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animId);
  }, [drawOverlay]);

  // Interactive Dragging on Calibrate & Selecting Slots
  const handleMouseDown = (e) => {
    const [mx, my] = toNormCoords(e.clientX, e.clientY);

    if (mode === 'calibrate') {
      // 1. Check if clicking on one of the 4 outer corner pins
      for (let cIdx = 0; cIdx < boardCorners.length; cIdx++) {
        const [cx, cy] = boardCorners[cIdx];
        const dist = Math.hypot(cx - mx, cy - my);
        if (dist < 0.055) {
          setActiveCornerIndex(cIdx);
          return;
        }
      }

      // 2. Check if clicking on individual slot handles
      const currentSlot = slotRois[selectedSlotIndex];
      if (currentSlot) {
        for (let i = 0; i < currentSlot.polygon.length; i++) {
          const [px, py] = currentSlot.polygon[i];
          const dist = Math.hypot(px - mx, py - my);
          if (dist < 0.04) {
            setActiveHandleIndex(i);
            return;
          }
        }
      }
    }

    // 3. Check if clicking inside a slot to select it (works in both monitor & calibrate modes)
    for (let sIdx = 0; sIdx < slotRois.length; sIdx++) {
      const slot = slotRois[sIdx];
      let inside = false;
      const poly = slot.polygon;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        const intersect = yi > my !== yj > my && mx < ((xj - xi) * (my - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      if (inside) {
        setSelectedSlotIndex((prev) => (mode === 'monitor' && prev === sIdx ? -1 : sIdx));
        return;
      }
    }
    setSelectedSlotIndex(-1);
  };

  const handleMouseMove = (e) => {
    if (mode !== 'calibrate') return;
    const [mx, my] = toNormCoords(e.clientX, e.clientY);

    // 1. Dragging outer corner pin
    if (activeCornerIndex !== null) {
      const newCorners = [...boardCorners];
      newCorners[activeCornerIndex] = [mx, my];
      setBoardCorners(newCorners);
      const updatedSlots = generateSlotsFromCorners(newCorners, activeFloor, slotScale);
      if (updatedSlots.length > 0) {
        setSlotRois(updatedSlots);
      }
      return;
    }

    // 2. Dragging individual slot vertex handle
    if (activeHandleIndex !== null && selectedSlotIndex !== null) {
      setSlotRois((prev) => {
        const next = [...prev];
        const slot = { ...next[selectedSlotIndex] };
        const poly = slot.polygon.map((pt) => [...pt]);
        poly[activeHandleIndex] = [mx, my];
        slot.polygon = poly;
        next[selectedSlotIndex] = slot;
        return next;
      });
    }
  };

  const handleMouseUp = () => {
    setActiveCornerIndex(null);
    setActiveHandleIndex(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="w-full max-w-7xl h-[92vh] bg-[#0c0f14] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-100 font-sans">

        {/* Top Navigation Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-[#12161f] border-b border-white/10 select-none">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-400/10 text-amber-400 border border-amber-400/20 shadow-sm">
              <Camera size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-wide text-white uppercase font-mono">Floor-Level AI Surveillance</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400/15 text-amber-300 border border-amber-400/30 font-mono">
                  {activeFloor?.name || 'Floor'} • {totalSlots} SLOTS
                </span>
                {violations.length > 0 && hasScanned && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse flex items-center gap-1 font-mono">
                    <ShieldAlert size={11} />
                    <span>{violations.length} ALERTS</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Autonomous Computer Vision • Automatic License Plate Recognition & Real-Time Slot Telemetry</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Toggle */}
            <button
              type="button"
              onClick={toggleSound}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 shadow-sm ${
                isSoundEnabled
                  ? 'bg-amber-400/15 border-amber-400/40 text-amber-300 hover:bg-amber-400/25'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
              }`}
              title={isSoundEnabled ? 'Mute AI Audio Alerts' : 'Enable AI Audio Alerts'}
            >
              {isSoundEnabled ? <Volume2 size={14} className="text-amber-400 animate-pulse" /> : <VolumeX size={14} />}
              <span>Audio: {isSoundEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {/* Mode Switcher */}
            <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setMode('monitor')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 ${
                  mode === 'monitor' ? 'bg-amber-400 text-black shadow-md' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Sparkles size={13} />
                <span>Live Monitor</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('calibrate')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 ${
                  mode === 'calibrate' ? 'bg-amber-400 text-black shadow-md' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Sliders size={13} />
                <span>Calibrate Floor</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition border border-white/10"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Floor & Camera Selector Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-[#151922] border-b border-white/10 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-gray-400 font-bold uppercase tracking-wider text-[11px]">Floor:</span>
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
              {floors.map((f) => (
                <button
                  key={f._id}
                  type="button"
                  onClick={() => {
                    setSelectedFloorId(f._id);
                    setActiveZoneFilter('ALL');
                    setActiveStatusFilter('ALL');
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                    selectedFloorId === f._id ? 'bg-amber-400 text-black shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10">
              <span className="text-gray-400 text-[11px]">Cam:</span>
              <select
                value={selectedCameraId}
                onChange={(e) => {
                  setSelectedCameraId(e.target.value);
                  try {
                    localStorage.setItem('valo_selected_camera_id', e.target.value);
                  } catch (err) {}
                }}
                className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
              >
                {availableCameras.map((cam, i) => (
                  <option key={cam.deviceId || i} value={cam.deviceId} className="bg-[#151922] text-white">
                    {cam.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Auto Scan Toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none bg-black/40 px-3 py-1.5 rounded-xl border border-white/10 hover:border-white/20 transition">
              <input
                type="checkbox"
                checked={autoScanEnabled}
                onChange={(e) => setAutoScanEnabled(e.target.checked)}
                className="rounded accent-amber-400 cursor-pointer"
              />
              <span className="text-gray-300 font-semibold text-xs">Auto Scan (8s)</span>
              {isScanning && <RefreshCw size={12} className="animate-spin text-amber-400" />}
            </label>

            {/* Clean View / Grid Toggle */}
            <button
              type="button"
              onClick={() => setShowGridOverlay(!showGridOverlay)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
                showGridOverlay
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
              }`}
              title="Toggle slot grid boundary overlay"
            >
              {showGridOverlay ? <Eye size={13} className="text-emerald-400" /> : <EyeOff size={13} />}
              <span>{showGridOverlay ? 'Slot Grid: ON' : 'Slot Grid: AUTO'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {mode === 'calibrate' ? (
              <>
                <button
                  type="button"
                  onClick={handleAutoDetectFloor}
                  disabled={isAutoDetecting}
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border border-purple-400/50 text-purple-300 hover:bg-purple-500 hover:text-white font-extrabold text-xs transition flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
                  title="Auto-align slots using YOLOv8-Seg & Homography perspective"
                >
                  <Wand2 size={13} className={isAutoDetecting ? 'animate-spin' : 'text-purple-400'} />
                  <span>{isAutoDetecting ? 'Calibrating...' : 'AI Auto Calibration'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleLayoutLock}
                  className={`px-2.5 py-1.5 rounded-lg font-bold text-xs transition border flex items-center gap-1 ${
                    isLayoutLocked
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300 hover:bg-emerald-500/30'
                      : 'bg-white/5 border-white/15 text-gray-300 hover:bg-white/10'
                  }`}
                  title={isLayoutLocked ? 'Locked: Scan preserves manual layout' : 'Unlocked: Scan auto-aligns perspective & slot grid via AI'}
                >
                  {isLayoutLocked ? <Lock size={12} /> : <Unlock size={12} />}
                  <span>{isLayoutLocked ? 'Locked' : 'Auto-Align'}</span>
                </button>

                {/* Global Scale & Shift Controls */}
                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10" title="Scale and nudge entire layout">
                  <button
                    type="button"
                    onClick={() => handleGlobalScale(1.05)}
                    className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                    title="Scale Up (+5%)"
                  >
                    <ZoomIn size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGlobalScale(0.95)}
                    className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                    title="Scale Down (-5%)"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <div className="w-px h-3 bg-white/15 mx-0.5" />
                  <button
                    type="button"
                    onClick={() => handleSlotDimensionScale(1.08, 1.0)}
                    className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                    title="Expand Width (+8%)"
                  >
                    ↔ Width+
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSlotDimensionScale(0.92, 1.0)}
                    className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                    title="Narrow Width (-8%)"
                  >
                    ↔ Width-
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSlotDimensionScale(1.0, 1.08)}
                    className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                    title="Extend Length (+8%)"
                  >
                    ↕ Length+
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSlotDimensionScale(1.0, 0.92)}
                    className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                    title="Shorten Length (-8%)"
                  >
                    ↕ Length-
                  </button>
                  <div className="w-px h-3 bg-white/15 mx-0.5" />
                  <button
                    type="button"
                    onClick={() => handleGlobalMove(-0.02, 0)}
                    className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                    title="Nudge Left"
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGlobalMove(0.02, 0)}
                    className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                    title="Nudge Right"
                  >
                    <ArrowRight size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGlobalMove(0, -0.02)}
                    className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                    title="Nudge Up"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGlobalMove(0, 0.02)}
                    className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                    title="Nudge Down"
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleResetToDiorama}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs transition border border-amber-500/30 flex items-center gap-1"
                  title="Restore default 27 slots layout"
                >
                  <RotateCcw size={13} />
                  <span>Reset (27 Slots)</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveCalibration}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs transition flex items-center gap-1.5 shadow-md active:scale-95"
                >
                  <Save size={14} />
                  <span>{saveSuccess ? 'Saved!' : 'Save Layout'}</span>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2.5">
                {/* Custom Cyber Glassmorphism AI Engine Selector */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsAiDropdownOpen(!isAiDropdownOpen)}
                    className="flex items-center gap-2 bg-[#121622]/90 hover:bg-[#181d2a] border border-white/10 hover:border-amber-400/40 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm select-none"
                    title="Select AI Vision Engine"
                  >
                    <Sparkles size={13} className="text-amber-400" />
                    <span className="text-gray-200">
                      {aiMode === 'hybrid' ? '🚀 Smart Auto (Hybrid)' : aiMode === 'gemini' ? '✨ Gemini Vision (Cloud)' : '⚡ Edge ALPR (Offline)'}
                    </span>
                    <ChevronDown size={13} className={`text-gray-400 transition-transform duration-200 ${isAiDropdownOpen ? 'rotate-180 text-amber-400' : ''}`} />
                  </button>

                  {isAiDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsAiDropdownOpen(false)} />
                      <div className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-[#0e121b]/95 backdrop-blur-xl border border-white/15 rounded-xl p-1.5 shadow-2xl space-y-1 animate-in fade-in zoom-in-95 duration-150">
                        <button
                          type="button"
                          onClick={() => { setAiMode('hybrid'); setIsAiDropdownOpen(false); }}
                          className={`w-full text-left p-2 rounded-lg text-xs transition flex items-start gap-2.5 ${aiMode === 'hybrid' ? 'bg-amber-400/15 border border-amber-400/40 text-amber-200' : 'hover:bg-white/5 text-gray-300'}`}
                        >
                          <span className="text-base leading-none">🚀</span>
                          <div>
                            <div className="font-bold flex items-center gap-1.5">
                              <span>Smart Auto</span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 text-[9px] font-black uppercase">Recommended</span>
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">Edge ALPR + Cloud Gemini Verification</div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => { setAiMode('local'); setIsAiDropdownOpen(false); }}
                          className={`w-full text-left p-2 rounded-lg text-xs transition flex items-start gap-2.5 ${aiMode === 'local' ? 'bg-emerald-500/15 border border-emerald-400/40 text-emerald-200' : 'hover:bg-white/5 text-gray-300'}`}
                        >
                          <span className="text-base leading-none">⚡</span>
                          <div>
                            <div className="font-bold">Edge ALPR Engine</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">100% on-device YOLOv8, zero token cost</div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => { setAiMode('gemini'); setIsAiDropdownOpen(false); }}
                          className={`w-full text-left p-2 rounded-lg text-xs transition flex items-start gap-2.5 ${aiMode === 'gemini' ? 'bg-purple-500/15 border border-purple-400/40 text-purple-200' : 'hover:bg-white/5 text-gray-300'}`}
                        >
                          <span className="text-base leading-none">✨</span>
                          <div>
                            <div className="font-bold">Gemini 2.5 Flash Vision</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">Cloud multimodal AI for complex perspective</div>
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Main Action Button */}
                <button
                  type="button"
                  onClick={() => captureAndScanSlots(null, aiMode === 'gemini')}
                  disabled={isScanning}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-black text-xs transition flex items-center gap-2 shadow-lg shadow-amber-400/20 active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Scan parking floor and verify vehicle states"
                >
                  <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                  <span>{isScanning ? 'Analyzing...' : '⚡ Scan Parking Lot'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Main Content Area: Video Canvas + Side Status Panel */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-3 gap-0 min-h-[420px]">

          {/* Video & Interactive Canvas */}
          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="lg:col-span-2 relative bg-black flex items-center justify-center overflow-hidden border-r border-white/10 select-none cursor-crosshair"
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain"
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />

            {/* Futuristic Viewfinder Target Brackets */}
            <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-cyan-400/40 pointer-events-none z-10 rounded-tr-sm" />
            <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-cyan-400/40 pointer-events-none z-10 rounded-bl-sm" />
            <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-cyan-400/40 pointer-events-none z-10 rounded-br-sm" />

            {/* Live Telemetry HUD Bar on Camera Feed */}
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-black/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-xs shadow-lg">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="font-mono font-black text-emerald-400 uppercase tracking-wider text-[11px]">AI Computer Vision</span>
              <span className="text-gray-600">•</span>
              <span className="font-mono text-gray-300 text-[11px] flex items-center gap-1">
                {activeAiEngine.includes('gemini') ? (
                  <span className="text-purple-300 font-bold flex items-center gap-1">
                    <Sparkles size={11} className="text-purple-400" />
                    Gemini 2.5 Flash Active
                  </span>
                ) : activeAiEngine.includes('hybrid') ? (
                  <span className="text-cyan-300 font-bold flex items-center gap-1">
                    <Sparkles size={11} className="text-cyan-400" />
                    Hybrid Edge + Cloud Fusion
                  </span>
                ) : (
                  <span className="text-amber-300 font-bold flex items-center gap-1">
                    <Sparkles size={11} className="text-amber-400" />
                    Edge ALPR Engine
                  </span>
                )}
              </span>
              {lastScanDuration && (
                <>
                  <span className="text-gray-600">•</span>
                  <span className="text-gray-400 font-mono text-[10px]">{lastScanDuration}s</span>
                </>
              )}
            </div>

            {/* Camera Misalignment Warning HUD Banner */}
            {cameraMisalignedWarning && (
              <div className="absolute top-14 left-3 right-3 z-30 flex items-center justify-between bg-rose-950/95 backdrop-blur-xl px-4 py-3 rounded-xl border border-rose-500/60 text-xs shadow-2xl animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2.5 text-rose-200">
                  <ShieldAlert size={18} className="text-rose-400 shrink-0 animate-bounce" />
                  <div>
                    <strong className="text-white block font-black uppercase tracking-wide text-[11px]">
                      CAMERA ANGLE MISALIGNED:
                    </strong>
                    <span>{cameraMisalignedWarning}</span>
                  </div>
                </div>
                <span className="font-mono text-[10px] bg-rose-500/30 text-rose-200 px-2.5 py-1 rounded-lg border border-rose-400/50 uppercase font-black tracking-wider shrink-0">
                  ALIGNMENT REQUIRED
                </span>
              </div>
            )}

            {/* Floor Mismatch HUD Warning Banner */}
            {floorMismatch && (
              <div className="absolute top-14 left-3 right-3 z-30 flex items-center justify-between bg-amber-950/95 backdrop-blur-xl px-4 py-3 rounded-xl border border-amber-500/60 text-xs shadow-2xl animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-3 text-amber-200">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
                    <Layers size={18} className="text-amber-400 animate-pulse" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <strong className="text-amber-300 font-black uppercase tracking-wide text-[11px]">
                        FLOOR MISMATCH DETECTED:
                      </strong>
                      <span className="text-[10px] bg-amber-500/30 text-amber-200 px-2 py-0.5 rounded font-mono font-bold">
                        Viewing: {floorMismatch.detectedFloorName}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">
                        (Selected: {floorMismatch.selectedFloorName})
                      </span>
                    </div>
                    <span className="text-gray-300 text-[11.5px] mt-0.5 block">{floorMismatch.warningMessage}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAutoSwitchFloor(floorMismatch.detectedFloorNumber, floorMismatch.detectedFloorName)}
                  className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-black font-black text-xs transition flex items-center gap-1.5 shadow-lg shadow-amber-500/20 active:scale-95 shrink-0 cursor-pointer"
                >
                  <ArrowRight size={14} className="stroke-[3]" />
                  <span>Switch to {floorMismatch.detectedFloorName}</span>
                </button>
              </div>
            )}

            {mode === 'calibrate' && (
              <div className="absolute top-12 left-3 right-3 z-20 flex items-center justify-between bg-amber-950/80 backdrop-blur-md px-3.5 py-2 rounded-xl border border-amber-500/40 text-xs shadow-lg">
                <span className="text-amber-200 font-medium flex items-center gap-2">
                  <Sliders size={14} className="text-amber-400 shrink-0" />
                  <span>Drag <strong>4 corner pins (TL, TR, BR, BL)</strong> to align diorama perspective. Use <strong>↔ Width / ↕ Length</strong> buttons, then click <strong>Save Layout</strong>.</span>
                </span>
                <span className="font-mono text-[10px] bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded border border-amber-400/30">
                  Scale: {Math.round(slotScale.x * 100)}% × {Math.round(slotScale.y * 100)}%
                </span>
              </div>
            )}

            {/* Bottom Status Telemetry */}
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 bg-black/80 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/15 text-xs shadow-md">
              <span className="font-extrabold text-amber-400 font-mono">{activeFloor?.name || 'Floor'}</span>
              <span className="text-gray-600">•</span>
              {hasScanned ? (
                <span className="text-gray-300 flex items-center gap-2 font-medium">
                  <Layers size={13} className="text-cyan-400" />
                  <span>Parked: <strong className="text-emerald-400 font-black">{validCount}</strong></span>
                  <span className="text-gray-600">|</span>
                  <span>Alerts: <strong className={violations.length > 0 ? "text-rose-400 font-black animate-pulse" : "text-gray-400 font-black"}>{violations.length}</strong></span>
                  <span className="text-gray-600">|</span>
                  <span>Available: <strong className="text-sky-400 font-black">{availableCount}</strong></span>
                </span>
              ) : cameraMisalignedWarning ? (
                <span className="text-rose-300 flex items-center gap-1.5 font-bold">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span>⚠️ Camera Misaligned • No physical parking layout detected</span>
                </span>
              ) : (
                <span className="text-gray-300 flex items-center gap-1.5 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>Ready • Click "⚡ Scan Parking Lot" to begin</span>
                </span>
              )}
            </div>
          </div>

          {/* Right Panel: Stats, Violations, Fast Reassign & Slot List */}
          <div className="flex flex-col bg-[#0f1219] overflow-hidden">
            {/* Summary KPI Cards */}
            <div className="grid grid-cols-4 gap-1.5 p-3 border-b border-white/10 bg-[#121622]">
              <div className="bg-white/5 p-2 rounded-xl border border-white/10 text-center">
                <span className="text-[9px] text-gray-400 uppercase font-bold tracking-wider block">Total Slots</span>
                <span className="text-base font-black text-white">{totalSlots}</span>
              </div>
              <div className="bg-emerald-500/10 p-2 rounded-xl border border-emerald-500/20 text-center">
                <span className="text-[9px] text-emerald-300 uppercase font-bold tracking-wider block">Parked</span>
                <span className="text-base font-black text-emerald-400">{hasScanned ? validCount : '--'}</span>
              </div>
              <div className={`p-2 rounded-xl border text-center transition ${
                hasScanned && violations.length > 0 ? 'bg-rose-500/15 border-rose-500/30' : 'bg-white/5 border-white/10'
              }`}>
                <span className={`text-[9px] uppercase font-bold tracking-wider block ${
                  hasScanned && violations.length > 0 ? 'text-rose-300' : 'text-gray-400'
                }`}>Alerts</span>
                <span className={`text-base font-black ${
                  hasScanned && violations.length > 0 ? 'text-rose-400 animate-pulse' : 'text-gray-400'
                }`}>{hasScanned ? violations.length : '--'}</span>
              </div>
              <div className="bg-sky-500/10 p-2 rounded-xl border border-sky-500/20 text-center">
                <span className="text-[9px] text-sky-300 uppercase font-bold tracking-wider block">Available</span>
                <span className="text-base font-black text-sky-400">{hasScanned ? availableCount : '--'}</span>
              </div>
            </div>

            {/* Reassign Success Toast Notification */}
            {reassignSuccessMsg && (
              <div className="mx-3 mt-2.5 p-2 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                <span>{reassignSuccessMsg}</span>
              </div>
            )}

            {/* Unified Cyber Surveillance Toolbar */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#121622] border-b border-white/10 select-none">
              {/* Status Segmented Control */}
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setActiveStatusFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-bold uppercase transition whitespace-nowrap text-[10px] sm:text-[11px] ${
                    activeStatusFilter === 'ALL'
                      ? 'bg-amber-400 text-black shadow font-black'
                      : 'text-gray-400 hover:text-white bg-white/5'
                  }`}
                >
                  All ({totalSlots})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStatusFilter('ALERTS')}
                  className={`px-2.5 py-1 rounded-lg font-bold uppercase transition whitespace-nowrap text-[10px] sm:text-[11px] flex items-center gap-1.5 ${
                    activeStatusFilter === 'ALERTS'
                      ? 'bg-rose-500 text-white shadow font-black'
                      : violations.length > 0
                        ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'
                        : 'text-gray-400 hover:text-white bg-white/5'
                  }`}
                >
                  <span>🚨 Alerts</span>
                  <span className={`font-mono font-black ${violations.length > 0 ? 'text-rose-200' : ''}`}>
                    ({hasScanned ? violations.length : 0})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStatusFilter('VALID')}
                  className={`px-2.5 py-1 rounded-lg font-bold uppercase transition whitespace-nowrap text-[10px] sm:text-[11px] flex items-center gap-1.5 ${
                    activeStatusFilter === 'VALID'
                      ? 'bg-emerald-500 text-black shadow font-black'
                      : 'text-emerald-400 hover:text-white bg-emerald-500/10 border border-emerald-500/20'
                  }`}
                >
                  <span>✅ Parked</span>
                  <span className="font-mono font-black">({hasScanned ? validCount : 0})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStatusFilter('EMPTY')}
                  className={`px-2.5 py-1 rounded-lg font-bold uppercase transition whitespace-nowrap text-[10px] sm:text-[11px] flex items-center gap-1.5 ${
                    activeStatusFilter === 'EMPTY'
                      ? 'bg-sky-500 text-black shadow font-black'
                      : 'text-sky-300 hover:text-white bg-sky-500/10 border border-sky-500/20'
                  }`}
                >
                  <span>🟢 Available</span>
                  <span className="font-mono font-black">({hasScanned ? availableCount : 0})</span>
                </button>
              </div>

              {/* Compact Zone Dropdown */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider hidden sm:inline">Zone:</span>
                <select
                  value={activeZoneFilter}
                  onChange={(e) => setActiveZoneFilter(e.target.value)}
                  className="bg-[#181d2a] hover:bg-[#1f2637] text-gray-200 text-xs font-bold px-2 py-1 rounded-lg border border-white/10 focus:outline-none focus:border-amber-400 transition cursor-pointer"
                >
                  <option value="ALL">All Zones</option>
                  {Object.keys(floorData.zones).map((zKey) => (
                    <option key={zKey} value={zKey}>
                      Zone {zKey} ({floorData.zones[zKey]?.length || 0})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Streamlined Slot List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {floorMismatch ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-gray-400 my-auto min-h-[300px]">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-3 shadow-inner">
                    <Layers size={28} className="animate-pulse" />
                  </div>
                  <h4 className="font-bold text-white text-sm mb-1.5 text-amber-300">Floor Mismatch Detected</h4>
                  <p className="text-xs text-amber-200/90 max-w-[260px] leading-relaxed mb-1">
                    Camera is currently viewing <strong className="text-white">{floorMismatch.detectedFloorName}</strong>, but <strong className="text-white">{floorMismatch.selectedFloorName}</strong> is selected.
                  </p>
                  <p className="text-[11px] text-gray-400 max-w-[260px] leading-relaxed mb-4">
                    Auto-switch to {floorMismatch.detectedFloorName} to correctly project slot boundaries and license telemetry.
                  </p>
                  <div className="flex flex-col gap-2 w-full max-w-[240px]">
                    <button
                      type="button"
                      onClick={() => handleAutoSwitchFloor(floorMismatch.detectedFloorNumber, floorMismatch.detectedFloorName)}
                      className="w-full px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-400/25 active:scale-95 cursor-pointer"
                    >
                      <ArrowRight size={15} className="stroke-[2.5]" />
                      <span>Switch to {floorMismatch.detectedFloorName} (Auto-Adjust)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFloorMismatch(null);
                        captureAndScanSlots(null, aiMode === 'gemini');
                      }}
                      disabled={isScanning}
                      className="w-full px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-bold text-xs transition flex items-center justify-center gap-1.5 border border-white/10 cursor-pointer"
                    >
                      <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
                      <span>Re-scan Current Selection</span>
                    </button>
                  </div>
                </div>
              ) : cameraMisalignedWarning ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-gray-400 my-auto min-h-[300px]">
                  <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-3 shadow-inner">
                    <ShieldAlert size={28} className="animate-pulse" />
                  </div>
                  <h4 className="font-bold text-white text-sm mb-1.5 text-rose-300">Camera Angle Misaligned</h4>
                  <p className="text-xs text-rose-200/90 max-w-[240px] leading-relaxed mb-3">
                    {cameraMisalignedWarning}
                  </p>
                  <p className="text-[11px] text-gray-400 max-w-[240px] leading-relaxed mb-4">
                    Please point camera directly at the parking floor or select another video device.
                  </p>
                  <button
                    type="button"
                    onClick={() => captureAndScanSlots(null, aiMode === 'gemini')}
                    disabled={isScanning}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-400/20 active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                    <span>{isScanning ? 'Analyzing...' : '⚡ Retry Scan'}</span>
                  </button>
                </div>
              ) : !hasScanned ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-gray-400 my-auto min-h-[300px]">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3 shadow-inner">
                    <Camera size={26} />
                  </div>
                  <h4 className="font-bold text-white text-sm mb-1.5">Surveillance Ready</h4>
                  <p className="text-xs text-gray-400 max-w-[240px] leading-relaxed mb-4">
                    Select floor and camera, then click <span className="text-amber-400 font-bold">"⚡ Scan Parking Lot"</span> to analyze vehicle occupancy and license plates.
                  </p>
                  <button
                    type="button"
                    onClick={() => captureAndScanSlots(null, aiMode === 'gemini')}
                    disabled={isScanning}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-400/20 active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    <Zap size={14} className={isScanning ? 'animate-spin' : ''} />
                    <span>{isScanning ? 'Analyzing...' : '⚡ Scan Parking Lot Now'}</span>
                  </button>
                </div>
              ) : sortedAndFilteredSlots.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <p className="text-xs">No parking slots found matching the selected filter.</p>
                </div>
              ) : (
                sortedAndFilteredSlots.map((slot) => {
                  const originalIndex = slotRois.findIndex((s) => s.slotCode === slot.slotCode);
                  const result = resolveSlotStatus(slot.slotCode);
                  const isDoubleParking = result?.status === 'DOUBLE_PARKING_VIOLATION' || result?.violationType === 'DOUBLE_PARKING_VIOLATION' || Boolean(result?.occupiedByOverlap);
                  const isWrongSlot = result?.status === 'WRONG_SLOT_VIOLATION' || result?.violationType === 'WRONG_SLOT_VIOLATION';
                  const isUnauthorized = result?.status === 'UNAUTHORIZED_PARKING' || result?.violationType === 'UNAUTHORIZED_PARKING';
                  const isPendingPark = result?.status === 'CHECKED_IN_PENDING_PARK' || result?.violationType === 'CHECKED_IN_PENDING_PARK';
                  const isExiting = result?.status === 'EXITING_TO_GATE' || result?.violationType === 'EXITING_TO_GATE';
                  const isTransit = isPendingPark || isExiting;
                  const isViolation = isDoubleParking || isWrongSlot || isUnauthorized || (Boolean(result?.isViolation) && !isTransit);
                  const isOccupied = result?.occupied || result?.status === 'OCCUPIED_VALID' || isViolation;
                  const isSelected = originalIndex === selectedSlotIndex;
                  const cardPlate = result?.plate || result?.detectedPlate || result?.expectedPlate || result?.session?.licensePlate;

                  return (
                    <div
                      key={slot.slotCode}
                      onClick={() => setSelectedSlotIndex(originalIndex !== -1 ? originalIndex : 0)}
                      className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-2 ${
                        isDoubleParking
                          ? 'bg-orange-950/35 border-orange-500/55 hover:bg-orange-950/50 shadow-[0_0_12px_rgba(249,115,22,0.14)]'
                          : isWrongSlot
                            ? 'bg-rose-950/30 border-rose-500/50 hover:bg-rose-950/45 shadow-[0_0_12px_rgba(244,63,94,0.12)]'
                            : isUnauthorized
                              ? 'bg-amber-950/30 border-amber-500/50 hover:bg-amber-950/45'
                              : isPendingPark
                                ? 'bg-purple-950/30 border-purple-500/50 hover:bg-purple-950/45'
                                : isExiting
                                  ? 'bg-cyan-950/30 border-cyan-500/50 hover:bg-cyan-950/45'
                                  : isOccupied
                                    ? 'bg-emerald-950/20 border-emerald-500/35 hover:bg-emerald-950/35'
                                    : isSelected
                                      ? 'bg-amber-400/10 border-amber-400/50'
                                      : 'bg-white/5 border-white/5 hover:bg-white/10'
                      }`}
                    >
                      {/* Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-black text-white">{slot.slotCode}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                              isDoubleParking
                                ? 'bg-orange-500 text-white shadow-sm'
                                : isWrongSlot
                                  ? 'bg-rose-500 text-white shadow-sm'
                                  : isUnauthorized
                                    ? 'bg-amber-500 text-black font-black'
                                    : isPendingPark
                                      ? 'bg-purple-500 text-white font-black animate-pulse'
                                      : isExiting
                                        ? 'bg-cyan-500 text-black font-black animate-pulse'
                                        : isOccupied
                                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold'
                                          : 'bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold'
                            }`}
                          >
                            {isDoubleParking
                              ? 'Double Parked'
                              : isWrongSlot
                                ? 'Wrong Slot'
                                : isUnauthorized
                                  ? 'Unregistered'
                                  : isPendingPark
                                    ? 'In Transit'
                                    : isExiting
                                      ? 'Exiting Gate'
                                      : isOccupied
                                        ? 'Parked'
                                        : 'Available'}
                          </span>
                        </div>

                        {cardPlate && (
                          <span
                            className={`font-mono font-black text-xs px-2 py-0.5 rounded border ${
                              isPendingPark
                                ? 'bg-purple-950/60 border-purple-400/40 text-purple-200'
                                : isExiting
                                  ? 'bg-cyan-950/60 border-cyan-400/40 text-cyan-200'
                                  : isDoubleParking
                                    ? 'bg-orange-950/60 border-orange-400/40 text-orange-200'
                                    : isWrongSlot
                                      ? 'bg-rose-950/60 border-rose-400/40 text-rose-200'
                                      : isUnauthorized
                                        ? 'bg-amber-950/60 border-amber-400/40 text-amber-200'
                                        : 'bg-black/60 border-white/20 text-white'
                            }`}
                          >
                            {formatLicensePlateDisplay(cardPlate)}
                          </span>
                        )}
                      </div>

                      {/* Card Session Info */}
                      {result?.session && (
                        <div className="text-[11px] text-gray-300 space-y-1 bg-black/30 p-2 rounded-lg border border-white/5">
                          {result.session.userId?.phone && (
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Phone size={11} />
                              <span>{result.session.userId.phone}</span>
                            </div>
                          )}
                          {result.session.checkInTime && (
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Clock size={11} />
                              <span>Check-in: {new Date(result.session.checkInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Card Alerts & Action Buttons */}
                      {isDoubleParking ? (
                        <div className="mt-1 pt-1.5 border-t border-orange-500/25">
                          <div className="text-[11px] font-bold text-orange-300 flex items-start gap-1.5 leading-snug">
                            <AlertTriangle size={13} className="text-orange-400 shrink-0 mt-0.5 animate-pulse" />
                            <span>{formatViolationEnglish(result, slot.slotCode)}</span>
                          </div>
                        </div>
                      ) : isWrongSlot ? (
                        <div className="mt-1 pt-1.5 border-t border-rose-500/20 space-y-2">
                          <div className="text-[11px] font-bold text-rose-300 flex items-start gap-1.5 leading-snug">
                            <ShieldAlert size={13} className="text-rose-400 shrink-0 mt-0.5 animate-pulse" />
                            <span>{formatViolationEnglish(result, slot.slotCode)}</span>
                          </div>
                          {(result?.session || result?.expectedSession) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickReassignSlot(result.session || result.expectedSession, slot.slotCode);
                              }}
                              disabled={reassigningSlot === slot.slotCode}
                              className="w-full py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs transition flex items-center justify-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                              {reassigningSlot === slot.slotCode ? (
                                <RefreshCw size={12} className="animate-spin text-emerald-200" />
                              ) : (
                                <Zap size={12} className="text-amber-300" />
                              )}
                              <span>Accept vehicle at {slot.slotCode} (Reassign Slot)</span>
                            </button>
                          )}
                        </div>
                      ) : isUnauthorized ? (
                        <div className="mt-1 pt-1.5 border-t border-amber-500/20">
                          <div className="text-[11px] font-bold text-amber-300 flex items-start gap-1.5 leading-snug">
                            <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5 animate-pulse" />
                            <span>{formatViolationEnglish(result, slot.slotCode)}</span>
                          </div>
                        </div>
                      ) : isPendingPark ? (
                        <div className="mt-1 pt-1.5 border-t border-purple-500/30">
                          <div className="text-[11px] font-bold text-purple-300 flex items-start gap-1.5 leading-snug">
                            <Clock size={13} className="text-purple-400 shrink-0 mt-0.5 animate-pulse" />
                            <span>{formatViolationEnglish(result, slot.slotCode)}</span>
                          </div>
                        </div>
                      ) : isExiting ? (
                        <div className="mt-1 pt-1.5 border-t border-cyan-500/30 space-y-2">
                          <div className="text-[11px] font-bold text-cyan-300 flex items-start gap-1.5 leading-snug">
                            <ArrowRight size={13} className="text-cyan-400 shrink-0 mt-0.5 animate-pulse" />
                            <span>{formatViolationEnglish(result, slot.slotCode)}</span>
                          </div>
                          {result?.session && onCheckoutSlot && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCheckoutSlot(result.session);
                              }}
                              className="w-full py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 font-extrabold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <LogOut size={13} className="text-cyan-300" />
                              <span>Complete Gate Checkout</span>
                            </button>
                          )}
                        </div>
                      ) : isOccupied && result?.session && onCheckoutSlot ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCheckoutSlot(result.session);
                          }}
                          className="w-full mt-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <LogOut size={13} className="text-amber-400" />
                          <span>Process Check-out</span>
                        </button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
