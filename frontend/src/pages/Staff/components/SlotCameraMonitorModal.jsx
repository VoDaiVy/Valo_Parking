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
  EyeOff
} from 'lucide-react';
import { API_BASE } from '../../../services/api';
import { formatLicensePlateDisplay } from '../../../utils/licensePlate';

export const ROBOFLOW_CALIBRATED_SLOTS = [
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

export default function SlotCameraMonitorModal({
  isOpen,
  onClose,
  floors = [],
  currentFloorId,
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
    [0.035, 0.060], // 0: Top-Left (TL)
    [0.965, 0.060], // 1: Top-Right (TR)
    [0.965, 0.940], // 2: Bottom-Right (BR)
    [0.035, 0.940], // 3: Bottom-Left (BL)
  ], []);

  const [boardCorners, setBoardCorners] = useState(DEFAULT_BOARD_CORNERS);
  const [activeCornerIndex, setActiveCornerIndex] = useState(null);

  const [slotScale, setSlotScale] = useState({ x: 1.0, y: 1.0 });

  // Bilinear interpolation from 4 corners for (u, v) in [0, 1]
  const bilinearPoint = useCallback((u, v, corners) => {
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

    const getSlotPoly = (colIdx, rowIdx, isRightZone) => {
      const baseUStart = isRightZone ? 0.52 : 0.03;
      const colWidth = 0.090;
      const slotWidth = colWidth * 0.88 * sx;
      const uCenter = baseUStart + colIdx * colWidth + (colWidth / 2);
      const u1 = uCenter - slotWidth / 2;
      const u2 = uCenter + slotWidth / 2;

      let v1, v2;
      if (rowIdx === 0) {
        // Hàng 1 (Trên): A1..A5 / B1..B5
        const vCenter = 0.21;
        const vHeight = 0.22 * sy;
        v1 = vCenter - vHeight / 2;
        v2 = vCenter + vHeight / 2;
      } else if (rowIdx === 1) {
        // Hàng 2 (Giữa): A6..A10 / B6..B7
        const vCenter = 0.46;
        const vHeight = 0.22 * sy;
        v1 = vCenter - vHeight / 2;
        v2 = vCenter + vHeight / 2;
      } else {
        // Hàng 3 (Dưới): C1..C5 / D1..D5
        const vCenter = 0.82;
        const vHeight = 0.24 * sy;
        v1 = vCenter - vHeight / 2;
        v2 = vCenter + vHeight / 2;
      }

      // Mỗi ô đỗ tự động tạo thành một hình tứ giác phối cảnh (perspective quadrilateral)
      return [
        bilinearPoint(u1, v1, corners),
        bilinearPoint(u2, v1, corners),
        bilinearPoint(u2, v2, corners),
        bilinearPoint(u1, v2, corners),
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

    // Zone 3 (Bottom-Left: Row 2 = 1..5)
    const zoneC = zonesMap[zC] || [];
    zoneC.forEach((el, idx) => {
      const c = idx % 5;
      result.push({
        slotCode: el.name,
        polygon: getSlotPoly(c, 2, false),
      });
    });

    // Zone 4 (Bottom-Right: Row 2 = 1..5)
    const zoneD = zonesMap[zD] || [];
    zoneD.forEach((el, idx) => {
      const c = idx % 5;
      result.push({
        slotCode: el.name,
        polygon: getSlotPoly(c, 2, true),
      });
    });

    return result;
  }, [bilinearPoint]);

  // Generate Floor Grid default
  const generateFloorLayoutGrid = useCallback((floor) => {
    return generateSlotsFromCorners(boardCorners, floor, slotScale);
  }, [boardCorners, generateSlotsFromCorners, slotScale]);

  const [slotRois, setSlotRois] = useState(() => generateFloorLayoutGrid(activeFloor));
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [activeHandleIndex, setActiveHandleIndex] = useState(null);

  // Per-floor persistent scan results: { [floorId]: [slotResults] }
  const [floorScanResultsMap, setFloorScanResultsMap] = useState({});
  const [scanResults, setScanResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showGridOverlay, setShowGridOverlay] = useState(false); // Mặc định ẩn 27 khung xanh, chỉ hiện khi phát hiện có xe/vi phạm

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

  // When active floor changes, restore its scan results if any
  useEffect(() => {
    if (!activeFloor) return;
    const floorId = activeFloor._id || activeFloor.name || 'default';
    setScanResults(floorScanResultsMap[floorId] || []);
  }, [activeFloor, floorScanResultsMap]);

  const lastLoadedFloorIdRef = useRef(null);

  useEffect(() => {
    if (!activeFloor) return;
    const floorId = activeFloor._id || activeFloor.name || 'default';

    // Chỉ tải lại layout khi người dùng thực sự đổi sang tầng khác
    if (lastLoadedFloorIdRef.current === floorId) {
      return;
    }
    lastLoadedFloorIdRef.current = floorId;

    const storageKey = `valo_slot_roi_floor_${floorId}`;
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
          parsed.every((s) => s.slotCode && expectedSlotNames.has(s.slotCode.toUpperCase()));

        if (isValidForThisFloor) {
          setSlotRois(parsed);
          setSelectedSlotIndex(0);
          loaded = true;
        }
      }
    } catch (e) {}

    if (!loaded) {
      const layoutGrid = generateFloorLayoutGrid(activeFloor);
      setSlotRois(layoutGrid);
      setSelectedSlotIndex(0);
    }
  }, [activeFloor, floorData.allSlots, generateFloorLayoutGrid]);

  // Load cameras
  useEffect(() => {
    async function loadCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === 'videoinput');
        setAvailableCameras(videoDevices);
        if (videoDevices.length > 0 && !selectedCameraId) {
          setSelectedCameraId(videoDevices[0].deviceId);
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

  // Save Calibration to LocalStorage
  const handleSaveCalibration = () => {
    if (!activeFloor) return;
    const storageKey = `valo_slot_roi_floor_${activeFloor._id || activeFloor.name || 'default'}`;
    localStorage.setItem(storageKey, JSON.stringify(slotRois));
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleResetToDiorama = () => {
    if (!activeFloor) return;
    const storageKey = `valo_slot_roi_floor_${activeFloor._id || activeFloor.name || 'default'}`;
    localStorage.removeItem(storageKey);
    setBoardCorners(DEFAULT_BOARD_CORNERS);
    setSlotScale({ x: 1.0, y: 1.0 });
    const layout = generateSlotsFromCorners(DEFAULT_BOARD_CORNERS, activeFloor, { x: 1.0, y: 1.0 });
    setSlotRois(layout);
    localStorage.setItem(storageKey, JSON.stringify(layout));
    setSelectedSlotIndex(0);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };



  // AI Auto Detect Floor Grid
  const handleAutoDetectFloor = async () => {
    if (!videoRef.current || !videoRef.current.videoWidth || isAutoDetecting) return;
    setIsAutoDetecting(true);
    try {
      const video = videoRef.current;
      const offscreen = document.createElement('canvas');
      offscreen.width = video.videoWidth;
      offscreen.height = video.videoHeight;
      const ctx = offscreen.getContext('2d');
      ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
      const base64Image = offscreen.toDataURL('image/jpeg', 0.95);

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
        if (Array.isArray(data.slots) && data.slots.length > 0) {
          setSlotRois(data.slots);
          setSelectedSlotIndex(0);
          if (Array.isArray(data.corners) && data.corners.length === 4) {
            setBoardCorners(data.corners);
          }
          if (activeFloor) {
            const storageKey = `valo_slot_roi_floor_${activeFloor._id || activeFloor.name || 'default'}`;
            localStorage.setItem(storageKey, JSON.stringify(data.slots));
          }
        } else if (Array.isArray(data.corners) && data.corners.length === 4) {
          setBoardCorners(data.corners);
          const alignedSlots = generateSlotsFromCorners(data.corners, activeFloor, slotScale);
          if (alignedSlots.length > 0) {
            setSlotRois(alignedSlots);
            setSelectedSlotIndex(0);
            if (activeFloor) {
              const storageKey = `valo_slot_roi_floor_${activeFloor._id || activeFloor.name || 'default'}`;
              localStorage.setItem(storageKey, JSON.stringify(alignedSlots));
            }
          }
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
  const captureAndScanSlots = useCallback(async () => {
    if (!videoRef.current || !videoRef.current.videoWidth || isScanning || slotRois.length === 0) return;
    setIsScanning(true);
    try {
      const video = videoRef.current;
      const offscreen = document.createElement('canvas');
      offscreen.width = video.videoWidth;
      offscreen.height = video.videoHeight;
      const ctx = offscreen.getContext('2d');
      ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
      const base64Image = offscreen.toDataURL('image/jpeg', 0.95);

      const token = localStorage.getItem('token') || localStorage.getItem('accessToken') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_BASE}/ai/scan-slots`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image: base64Image,
          slots: slotRois,
        }),
      });

      const data = await response.json();
      if (data.success && Array.isArray(data.slots)) {
        const currentFloorKey = activeFloor?._id || activeFloor?.name || 'default';
        const freshSlots = data.slots;

        const currentPlates = new Set(
          freshSlots
            .filter((r) => r.occupied && (r.plate || r.detectedPlate))
            .map((r) => (r.plate || r.detectedPlate).replace(/[^A-Z0-9]/gi, '').toUpperCase())
        );

        setScanResults(freshSlots);
        setFloorScanResultsMap((prev) => {
          const updated = {};
          Object.entries(prev).forEach(([fId, fSlots]) => {
            if (fId === currentFloorKey) return;
            updated[fId] = fSlots.filter((s) => {
              const p = (s.plate || s.detectedPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
              return !p || !currentPlates.has(p);
            });
          });
          updated[currentFloorKey] = freshSlots;
          return updated;
        });

        if (onSlotStatusUpdate) {
          onSlotStatusUpdate(freshSlots, currentFloorKey);
        }
      }
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  }, [activeFloor, isScanning, slotRois, onSlotStatusUpdate]);

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
      const cornerLabels = ['TL (Góc Trên-Trái)', 'TR (Góc Trên-Phải)', 'BR (Góc Dưới-Phải)', 'BL (Góc Dưới-Trái)'];
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
      const pts = slot.polygon.map(([nx, ny]) => toScreenCoords(nx, ny));
      if (pts.length < 3) return;

      const result = scanResults.find((r) => r.slotCode === slot.slotCode);
      const isWrongSlot = result?.status === 'WRONG_SLOT_VIOLATION' || result?.violationType === 'WRONG_SLOT_VIOLATION';
      const isUnauthorized = result?.status === 'UNAUTHORIZED_PARKING' || result?.violationType === 'UNAUTHORIZED_PARKING';
      const isViolation = isWrongSlot || isUnauthorized || result?.isViolation;
      const isOccupied = result?.occupied || result?.status === 'OCCUPIED_VALID' || isViolation;
      const isSelected = sIdx === selectedSlotIndex;

      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
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
        // Chế độ Live Monitor: Ẩn hoàn toàn khung nếu ô trống!
        if (isWrongSlot) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 3.5;
          ctx.fillStyle = 'rgba(239, 68, 68, 0.32)';
          ctx.fill();
          ctx.stroke();
        } else if (isUnauthorized) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 3.0;
          ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
          ctx.fill();
          ctx.stroke();
        } else if (isOccupied) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
          ctx.fill();
          ctx.stroke();
        } else if (showGridOverlay) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
          ctx.fill();
          ctx.stroke();
        } else {
          // Ô trống và không bật hiện lưới -> Không vẽ gì để giữ màn hình camera sạch sẽ 100%
          return;
        }
      }

      // Slot Badge
      const labelX = pts[0][0];
      const labelY = pts[0][1] - 8;
      ctx.font = 'bold 11px Inter, sans-serif';
      const plateText = result?.plate || result?.detectedPlate;
      const slotText = isWrongSlot
        ? `⚠️ WRONG SLOT: ${slot.slotCode}${plateText ? ` • ${formatLicensePlateDisplay(plateText)}` : ''}${result?.expectedSlot ? ` (ASSIGNED: ${result.expectedSlot})` : ''}`
        : isUnauthorized
          ? `⚠️ UNCHECKED-IN: ${slot.slotCode}${plateText ? ` • ${formatLicensePlateDisplay(plateText)}` : ''} (No Session)`
          : isOccupied
            ? `✅ VALID: ${slot.slotCode}${plateText ? ` • ${formatLicensePlateDisplay(plateText)}` : ''}`
            : slot.slotCode;
      const textWidth = ctx.measureText(slotText).width;

      ctx.fillStyle = isWrongSlot ? '#ef4444' : isUnauthorized ? '#d97706' : isOccupied ? '#0284c7' : 'rgba(30, 41, 59, 0.8)';
      ctx.beginPath();
      ctx.roundRect(labelX, Math.max(8, labelY - 14), textWidth + 12, 18, 4);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(slotText, labelX + 6, Math.max(21, labelY));
    });
  }, [boardCorners, activeCornerIndex, slotRois, scanResults, selectedSlotIndex, activeHandleIndex, mode, showGridOverlay, toScreenCoords]);

  useEffect(() => {
    let animId;
    const render = () => {
      drawOverlay();
      animId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animId);
  }, [drawOverlay]);

  // Interactive Dragging on Calibrate
  const handleMouseDown = (e) => {
    if (mode !== 'calibrate') return;
    const [mx, my] = toNormCoords(e.clientX, e.clientY);

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

    // 3. Check if clicking inside a slot to select it
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
        setSelectedSlotIndex(sIdx);
        return;
      }
    }
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

  const totalSlots = slotRois.length;
  const occupiedSlots = scanResults.filter((r) => r.occupied || r.status === 'OCCUPIED_VALID' || r.status === 'WRONG_SLOT_VIOLATION' || r.isViolation).length;
  const violations = useMemo(() => {
    const list = scanResults.filter((r) => r.status === 'WRONG_SLOT_VIOLATION' || r.isViolation);
    const seenPlates = new Set();
    return list.filter((v) => {
      const p = (v.plate || v.detectedPlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (p) {
        if (seenPlates.has(p)) return false;
        seenPlates.add(p);
      }
      return true;
    });
  }, [scanResults]);
  const availableCount = Math.max(0, totalSlots - occupiedSlots);

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
                <h2 className="text-base font-black tracking-wide text-white uppercase">Floor-Level AI Surveillance</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400/15 text-amber-300 border border-amber-400/30">
                  {activeFloor?.name || 'Floor'} • {totalSlots} SLOTS
                </span>
              </div>
              <p className="text-xs text-gray-400">Full-Floor Real-Time Overhead Vision • 100% Synced with 2D/3D Floor Map</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setMode('monitor')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 ${mode === 'monitor' ? 'bg-amber-400 text-black shadow-md' : 'text-gray-400 hover:text-white'
                  }`}
              >
                <Sparkles size={13} />
                <span>Live Monitor</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('calibrate')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition flex items-center gap-1.5 ${mode === 'calibrate' ? 'bg-amber-400 text-black shadow-md' : 'text-gray-400 hover:text-white'
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
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition ${selectedFloorId === f._id ? 'bg-amber-400 text-black shadow' : 'text-gray-400 hover:text-white'
                    }`}
                >
                  {f.name}
                </button>
              ))}
            </div>

            {/* Camera Select */}
            <div className="flex items-center gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10">
              <span className="text-gray-400 text-[11px]">Cam:</span>
              <select
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
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
            <label className="flex items-center gap-2 cursor-pointer select-none bg-black/40 px-3 py-1.5 rounded-lg border border-white/10">
              <input
                type="checkbox"
                checked={autoScanEnabled}
                onChange={(e) => setAutoScanEnabled(e.target.checked)}
                className="rounded accent-amber-400"
              />
              <span className="text-gray-300 font-semibold">Background AI Scan (8s)</span>
              {isScanning && <RefreshCw size={12} className="animate-spin text-amber-400" />}
            </label>

            {/* Clean View / Grid Toggle */}
            <button
              type="button"
              onClick={() => setShowGridOverlay(!showGridOverlay)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 ${showGridOverlay
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
                }`}
              title="Toggle 27-slot grid overlay"
            >
              {showGridOverlay ? <Eye size={13} className="text-emerald-400" /> : <EyeOff size={13} />}
              <span>{showGridOverlay ? 'Grid: ON' : 'Grid: OFF'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={handleAutoDetectFloor}
              disabled={isAutoDetecting}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/20 to-indigo-500/20 border border-purple-400/50 text-purple-300 hover:bg-purple-500 hover:text-white font-extrabold text-xs transition flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
              title="Auto-detect & map 27 slots using Roboflow AI Model"
            >
              <Wand2 size={13} className={isAutoDetecting ? 'animate-spin' : 'text-purple-400'} />
              <span>{isAutoDetecting ? 'Detecting...' : 'AI Roboflow Calibration'}</span>
            </button>

            {/* Global Scale & Shift Controls */}
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10" title="Scale and shift all parking slot boxes">
              <button
                type="button"
                onClick={() => handleGlobalScale(1.05)}
                className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                title="Zoom in all slots (+5%)"
              >
                <ZoomIn size={13} />
              </button>
              <button
                type="button"
                onClick={() => handleGlobalScale(0.95)}
                className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                title="Zoom out all slots (-5%)"
              >
                <ZoomOut size={13} />
              </button>
              <div className="w-px h-3 bg-white/15 mx-0.5" />
              <button
                type="button"
                onClick={() => handleSlotDimensionScale(1.08, 1.0)}
                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                title="Increase width (+8%)"
              >
                ↔ Width+
              </button>
              <button
                type="button"
                onClick={() => handleSlotDimensionScale(0.92, 1.0)}
                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                title="Decrease width (-8%)"
              >
                ↔ Width-
              </button>
              <button
                type="button"
                onClick={() => handleSlotDimensionScale(1.0, 1.08)}
                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                title="Increase length (+8%)"
              >
                ↕ Length+
              </button>
              <button
                type="button"
                onClick={() => handleSlotDimensionScale(1.0, 0.92)}
                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition font-mono text-[10px] font-bold"
                title="Decrease length (-8%)"
              >
                ↕ Length-
              </button>
              <div className="w-px h-3 bg-white/15 mx-0.5" />
              <button
                type="button"
                onClick={() => handleGlobalMove(-0.02, 0)}
                className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                title="Move Left"
              >
                <ArrowLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() => handleGlobalMove(0.02, 0)}
                className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                title="Move Right"
              >
                <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => handleGlobalMove(0, -0.02)}
                className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                title="Move Up"
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => handleGlobalMove(0, 0.02)}
                className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition"
                title="Move Down"
              >
                <ArrowDown size={13} />
              </button>
            </div>

            {mode === 'calibrate' ? (
              <>
                <button
                  type="button"
                  onClick={handleResetToDiorama}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs transition border border-amber-500/30 flex items-center gap-1"
                  title="Reset 27 slots to standard Roboflow calibration"
                >
                  <RotateCcw size={13} />
                  <span>Reset Roboflow (27 Slots)</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveCalibration}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs transition flex items-center gap-1.5 shadow-md active:scale-95"
                >
                  <Save size={14} />
                  <span>{saveSuccess ? 'Saved!' : 'Save Calibration'}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={captureAndScanSlots}
                disabled={isScanning}
                className="px-3.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-extrabold text-xs transition flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50"
              >
                <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                <span>Scan Entire Floor</span>
              </button>
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

            {mode === 'calibrate' && (
              <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between bg-amber-950/80 backdrop-blur-md px-3.5 py-2 rounded-xl border border-amber-500/40 text-xs shadow-lg">
                <span className="text-amber-200 font-medium flex items-center gap-2">
                  <Sliders size={14} className="text-amber-400 shrink-0" />
                  <span>Drag the <strong>4 corner pins (TL, TR, BR, BL)</strong> to fit the diorama board. Use <strong>↔ Width+ / ↕ Length+</strong> buttons, then click <strong>Save Calibration</strong>.</span>
                </span>
                <span className="font-mono text-[10px] bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded border border-amber-400/30">
                  Scale: {Math.round(slotScale.x * 100)}% × {Math.round(slotScale.y * 100)}%
                </span>
              </div>
            )}

            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-xs">
              <span className="font-extrabold text-amber-400">{activeFloor?.name || 'Floor'}</span>
              <span className="text-gray-400">•</span>
              <span className="text-gray-300 flex items-center gap-1">
                <Layers size={13} className="text-cyan-400" />
                Full-floor surveillance active. Real-time synced with 2D/3D map
              </span>
            </div>
          </div>

          {/* Right Panel: Stats, Violations & Slot List */}
          <div className="flex flex-col bg-[#0f1219] overflow-hidden">
            {/* Summary KPI Cards */}
            <div className="grid grid-cols-3 gap-2 p-4 border-b border-white/10 bg-[#121622]">
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/10 text-center">
                <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider block">Total</span>
                <span className="text-lg font-black text-white">{totalSlots}</span>
              </div>
              <div className="bg-sky-500/10 p-2.5 rounded-xl border border-sky-500/20 text-center">
                <span className="text-[10px] text-sky-300 uppercase font-bold tracking-wider block">Occupied</span>
                <span className="text-lg font-black text-sky-400">{occupiedSlots}</span>
              </div>
              <div className="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 text-center">
                <span className="text-[10px] text-emerald-300 uppercase font-bold tracking-wider block">Available</span>
                <span className="text-lg font-black text-emerald-400">{availableCount}</span>
              </div>
            </div>

            {/* Violation Alert Banner */}
            {violations.length > 0 && (
              <div className="p-3 bg-red-500/15 border-b border-red-500/30">
                <div className="flex items-center gap-2 text-red-400 font-black text-xs uppercase tracking-wider mb-2">
                  <ShieldAlert size={15} className="animate-pulse" />
                  <span>{violations.length} Slot Violation(s) Detected!</span>
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {violations.map((v) => (
                    <div key={v.slotCode} className="bg-red-950/40 p-2 rounded-lg border border-red-500/30 text-xs">
                      <div className="flex items-center justify-between font-bold">
                        <span className="text-white font-mono bg-red-500/30 px-1.5 py-0.5 rounded text-[11px]">
                          {(v.plate || v.detectedPlate) ? formatLicensePlateDisplay(v.plate || v.detectedPlate) : 'Vehicle'}
                        </span>
                        <span className="text-red-300">Slot: {v.slotCode}</span>
                      </div>
                      <p className="text-[11px] text-red-200 mt-1">
                        Assigned: <strong className="text-amber-300">{v.expectedSlot || 'Other'}</strong> → Parked: <strong className="text-white">{v.slotCode}</strong>
                      </p>
                      {v.violationMessage && (
                        <p className="text-[10px] text-red-300/80 italic mt-0.5">{v.violationMessage}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Zone Filter Tabs */}
            <div className="flex items-center gap-1 px-4 py-2 bg-[#121622] border-b border-white/10 overflow-x-auto text-xs">
              <button
                type="button"
                onClick={() => setActiveZoneFilter('ALL')}
                className={`px-2.5 py-1 rounded font-bold uppercase transition whitespace-nowrap text-[11px] ${activeZoneFilter === 'ALL' ? 'bg-amber-400 text-black' : 'text-gray-400 hover:text-white'
                  }`}
              >
                All ({slotRois.length})
              </button>
              {Object.keys(floorData.zones).map((zKey) => (
                <button
                  key={zKey}
                  type="button"
                  onClick={() => setActiveZoneFilter(zKey)}
                  className={`px-2.5 py-1 rounded font-bold uppercase transition whitespace-nowrap text-[11px] ${activeZoneFilter === zKey ? 'bg-amber-400 text-black' : 'text-gray-400 hover:text-white'
                    }`}
                >
                  Zone {zKey} ({floorData.zones[zKey]?.length || 0})
                </button>
              ))}
            </div>

            {/* Slot List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {slotRois
                .filter((s) => {
                  if (activeZoneFilter === 'ALL') return true;
                  return s.slotCode.startsWith(activeZoneFilter);
                })
                .map((slot, sIdx) => {
                  const result = scanResults.find((r) => r.slotCode === slot.slotCode);
                  const isWrongSlot = result?.status === 'WRONG_SLOT_VIOLATION' || result?.violationType === 'WRONG_SLOT_VIOLATION';
                  const isUnauthorized = result?.status === 'UNAUTHORIZED_PARKING' || result?.violationType === 'UNAUTHORIZED_PARKING';
                  const isViolation = isWrongSlot || isUnauthorized || result?.isViolation;
                  const isOccupied = result?.occupied || result?.status === 'OCCUPIED_VALID' || isViolation;
                  const isSelected = sIdx === selectedSlotIndex;

                  return (
                    <div
                      key={slot.slotCode}
                      onClick={() => setSelectedSlotIndex(sIdx)}
                      className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-2 ${isWrongSlot
                          ? 'bg-red-500/10 border-red-500/40 hover:bg-red-500/20'
                          : isUnauthorized
                            ? 'bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/20'
                            : isOccupied
                              ? 'bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/15'
                              : isSelected
                                ? 'bg-amber-400/10 border-amber-400/50'
                                : 'bg-white/5 border-white/5 hover:bg-white/10'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-black text-white">{slot.slotCode}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${isWrongSlot
                                ? 'bg-red-500 text-white'
                                : isUnauthorized
                                  ? 'bg-amber-500 text-black font-black'
                                  : isOccupied
                                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                          >
                            {isWrongSlot ? 'Wrong Slot' : isUnauthorized ? 'Unchecked-In' : isOccupied ? 'Occupied' : 'Available'}
                          </span>
                        </div>

                        {(result?.plate || result?.detectedPlate) && (
                          <span className="font-mono font-black text-xs px-2 py-0.5 rounded bg-black/60 border border-white/20 text-white">
                            {formatLicensePlateDisplay(result.plate || result.detectedPlate)}
                          </span>
                        )}
                      </div>

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
                              <span>In: {new Date(result.session.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Actions & Alerts */}
                      {isWrongSlot ? (
                        <div className="mt-1 pt-1 border-t border-red-500/20">
                          <span className="text-[11px] font-black text-red-400 flex items-center gap-1">
                            <ShieldAlert size={12} className="animate-pulse" />
                            {result?.violationMessage || 'Vehicle parked in wrong slot!'}
                          </span>
                        </div>
                      ) : isUnauthorized ? (
                        <div className="mt-1 pt-1 border-t border-amber-500/20">
                          <span className="text-[11px] font-black text-amber-400 flex items-center gap-1">
                            <AlertTriangle size={12} className="animate-pulse" />
                            {result?.violationMessage || 'No active check-in session found!'}
                          </span>
                        </div>
                      ) : isOccupied && result?.session && onCheckoutSlot ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCheckoutSlot(result.session);
                          }}
                          className="w-full mt-1 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-extrabold text-xs transition flex items-center justify-center gap-1.5"
                        >
                          <LogOut size={13} className="text-amber-400" />
                          <span>Process Check-out</span>
                        </button>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
