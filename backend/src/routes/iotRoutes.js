const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const GateCameraConfig = require('../models/GateCameraConfig');
const { protect, authorize, softProtect } = require('../middlewares/authMiddleware');

const gateStates = {
  ENTRY_1: {
    open: false,
    holdOpen: false,
    forceClose: false,
    triggerId: 0,
    licensePlate: '',
    slotCode: '',
    gate: 'ENTRY_1',
    timestamp: Date.now()
  },
  EXIT_1: {
    open: false,
    holdOpen: false,
    forceClose: false,
    triggerId: 0,
    licensePlate: '',
    slotCode: '',
    gate: 'EXIT_1',
    timestamp: Date.now()
  }
};

let latestBarrierState = { ...gateStates.ENTRY_1 };
let currentLaneMode = 'STANDARD'; // 'STANDARD' | 'PEAK_ENTRY' (2 Cổng Vào) | 'PEAK_EXIT' (2 Cổng Ra)

const getGateState = (gateName = 'ENTRY_1') => {
  const normGate = (gateName || 'ENTRY_1').toUpperCase();
  if (!gateStates[normGate]) {
    gateStates[normGate] = {
      open: false,
      holdOpen: false,
      forceClose: false,
      triggerId: 0,
      licensePlate: '',
      slotCode: '',
      gate: normGate,
      timestamp: Date.now()
    };
  }
  return gateStates[normGate];
};

const toPublicGateState = (state) => ({
  open: Boolean(state.open),
  holdOpen: Boolean(state.holdOpen),
  forceClose: Boolean(state.forceClose),
  triggerId: state.triggerId,
  licensePlate: state.licensePlate || '',
  slotCode: state.slotCode || '',
  gate: state.gate,
  timestamp: state.timestamp,
});

const canViewGateDetails = (req) => ['staff', 'admin'].includes(req.user?.role);

const hasValidBridgeToken = (req) => {
  const configuredToken = process.env.IOT_BRIDGE_TOKEN || 'VALO_IOT_INTERNAL_BRIDGE_DEFAULT_TOKEN';
  const receivedToken = req.get('x-bridge-token') || '';
  if (!receivedToken) return false;

  const isLocalRequest = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(req.hostname) ||
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);

  const isMatch = (expectedStr, actualStr) => {
    try {
      const exp = Buffer.from(expectedStr);
      const act = Buffer.from(actualStr);
      return exp.length === act.length && crypto.timingSafeEqual(exp, act);
    } catch {
      return false;
    }
  };

  return (
    isMatch(configuredToken, receivedToken) ||
    (isLocalRequest && isMatch('VALO_IOT_INTERNAL_BRIDGE_DEFAULT_TOKEN', receivedToken)) ||
    (process.env.JWT_SECRET && isMatch(process.env.JWT_SECRET, receivedToken))
  );
};

const bridgeProtect = (req, res, next) => {
  const receivedToken = req.get('x-bridge-token') || '';
  if (!receivedToken) {
    return res.status(401).json({ success: false, message: 'Bridge authentication token is required' });
  }

  if (!hasValidBridgeToken(req)) {
    return res.status(401).json({ success: false, message: 'Invalid bridge token' });
  }
  req.isBridge = true;
  return next();
};

const ESP_BRIDGE_STALE_MS = 6000;
const espBridgeTelemetry = {
  bridgeLastSeenAt: 0,
  espConnected: false,
  espLastSeenAt: 0,
  port: '',
};

const getEspStatusSnapshot = () => {
  const now = Date.now();
  const bridgeOnline = (now - espBridgeTelemetry.bridgeLastSeenAt) <= ESP_BRIDGE_STALE_MS;
  const espOnline = bridgeOnline && espBridgeTelemetry.espConnected;
  return {
    espOnline,
    bridgeOnline,
    port: espOnline ? espBridgeTelemetry.port : '',
    lastSeenAt: espBridgeTelemetry.bridgeLastSeenAt || null,
  };
};

const { getParkingCapacitySnapshot } = require('../services/parkingCapacityService');

// In-memory cache cho công suất để API barrier-status phản hồi tức thì (0ms), không bị nghẽn mạng MongoDB Atlas
let cachedCapacity = { total: 20, occupied: 0, available: 20, vipReserved: 0, maintenance: 0 };
let isUpdatingCapacity = false;

const updateCapacityInBackground = async () => {
  if (isUpdatingCapacity) return;
  isUpdatingCapacity = true;
  try {
    const capSnapshot = await getParkingCapacitySnapshot();
    cachedCapacity = {
      total: Number(capSnapshot.totalSlots) || 0,
      occupied: Number(capSnapshot.occupiedSlots) || 0,
      available: Number(capSnapshot.availableSlots) || 0,
      vipReserved: Number(capSnapshot.vipReservedSlots) || 0,
      maintenance: Number(capSnapshot.maintenanceSlots) || 0,
    };
  } catch (err) {
    // Giữ cache cũ an toàn
  } finally {
    isUpdatingCapacity = false;
  }
};

// Cập nhật công suất bãi xe ngầm mỗi 10 giây (không làm nghẽn Event Loop)
setInterval(updateCapacityInBackground, 10000);
setTimeout(updateCapacityInBackground, 1000);

const fetchCapacitySafe = async () => {
  return cachedCapacity;
};

// ESP32 & Web Kiosks gọi API này để kiểm tra lệnh mở Barrier theo cổng kèm công suất bãi đỗ
router.get('/barrier-status', softProtect, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  if (hasValidBridgeToken(req)) {
    const now = Date.now();
    espBridgeTelemetry.bridgeLastSeenAt = now;
    if (req.query.esp !== undefined) {
      const connected = req.query.esp === '1' || req.query.esp === 'true';
      espBridgeTelemetry.espConnected = connected;
      espBridgeTelemetry.port = connected ? String(req.query.port || '') : '';
      if (connected) {
        espBridgeTelemetry.espLastSeenAt = now;
      }
    }
  }

  const { gate } = req.query;
  const showDetails = canViewGateDetails(req);
  const capacity = await fetchCapacitySafe();
  const espStatus = getEspStatusSnapshot();

  if (gate) {
    const state = getGateState(gate);
    return res.json({
      success: true,
      data: showDetails ? state : toPublicGateState(state),
      gates: showDetails
        ? gateStates
        : Object.fromEntries(Object.entries(gateStates).map(([key, value]) => [key, toPublicGateState(value)])),
      laneMode: currentLaneMode,
      capacity,
      espStatus,
    });
  }

  return res.json({
    success: true,
    data: showDetails ? latestBarrierState : toPublicGateState(latestBarrierState),
    gates: showDetails
      ? gateStates
      : Object.fromEntries(Object.entries(gateStates).map(([key, value]) => [key, toPublicGateState(value)])),
    laneMode: currentLaneMode,
    capacity,
    espStatus,
  });
});

// API lấy và chuyển đổi chế độ Làn đảo chiều cao điểm (Lane Flow Mode)
router.get('/lane-mode', softProtect, (req, res) => {
  return res.json({ success: true, mode: currentLaneMode });
});

router.post('/lane-mode', softProtect, (req, res) => {
  const { mode = 'STANDARD' } = req.body || {};
  const upper = String(mode).trim().toUpperCase();
  if (['STANDARD', 'PEAK_ENTRY', 'PEAK_EXIT'].includes(upper)) {
    currentLaneMode = upper;
    const io = req.app.get('io');
    if (io) {
      io.emit('gate:lane_mode_changed', { mode: currentLaneMode });
    }
    console.log(`[BACKEND IOT] 🔄 CHUYỂN CHẾ ĐỘ LÀN: ${currentLaneMode}`);
    return res.json({ success: true, mode: currentLaneMode });
  }
  return res.status(400).json({ success: false, message: 'Invalid lane mode. Use STANDARD, PEAK_ENTRY, or PEAK_EXIT.' });
});

// API chuyên dụng lấy công suất bãi xe (Dùng cho Bảng hiển thị LCD ngoài cổng & Kiosk)
const BarrierAuditLog = require('../models/BarrierAuditLog');
const cloudinary = require('../config/cloudinary');

const uploadEvidenceSafe = async (rawImg) => {
  if (!rawImg || typeof rawImg !== 'string') return '';
  const trimmed = rawImg.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('data:image')) {
    try {
      const uploadRes = await cloudinary.uploader.upload(trimmed, {
        folder: 'valo_parking/barrier_audits',
        resource_type: 'image',
      });
      return uploadRes?.secure_url || trimmed;
    } catch (err) {
      console.warn('[BarrierAuditLog] Cloudinary upload note:', err.message);
      return trimmed;
    }
  }
  return trimmed;
};

router.get('/capacity', softProtect, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const capacity = await fetchCapacitySafe();
  return res.json({
    success: true,
    capacity,
  });
});

// API kích hoạt mở Barrier (Dùng cho Kiosk hoặc nút bấm test)
router.post('/open-barrier', protect, authorize('staff', 'admin'), async (req, res) => {
  const {
    licensePlate = 'TEST-VEHICLE',
    slotCode = 'A-01',
    gate = 'ENTRY_1',
    hold = false,
    reason = 'MANUAL_OVERRIDE',
    notes = '',
    evidenceImage = '',
    image = '',
  } = req.body;
  const normGate = (gate || 'ENTRY_1').toUpperCase();

  console.log(`[BACKEND IOT] 🚀 NHẬN LỆNH MỞ CỔNG từ Web: ${normGate} | Biển số: ${licensePlate} | Ô: ${slotCode} | Lý do: ${reason}`);

  if (req.user) {
    try {
      const finalEvidence = await uploadEvidenceSafe(evidenceImage || image);
      await BarrierAuditLog.create({
        gate: normGate,
        action: 'open',
        reason: reason || 'MANUAL_OVERRIDE',
        notes: notes || '',
        licensePlate: licensePlate || '',
        evidenceImage: finalEvidence,
        staffId: req.user._id,
        staffName: req.user.fullName || req.user.username || 'Staff',
      });
    } catch (auditErr) {
      console.error('[BarrierAuditLog] Failed to record open audit:', auditErr.message);
    }
  }

  const newState = {
    open: true,
    holdOpen: Boolean(hold),
    forceClose: false,
    triggerId: Date.now(),
    licensePlate,
    slotCode,
    gate: normGate,
    timestamp: Date.now()
  };

  gateStates[normGate] = newState;
  latestBarrierState = newState;

  const io = req.app.get('io');
  if (io) {
    io.emit('gate:barrier_control', newState);
  }

  return res.json({ success: true, message: `Barrier open triggered for ${normGate}`, data: newState });
});

// Chế độ Tạm dừng Barrier (Vô hiệu hóa cảm biến & Giữ nguyên vị trí)
router.post('/hold-barrier', protect, authorize('staff', 'admin'), async (req, res) => {
  const {
    hold = true,
    gate = 'ENTRY_1',
    reason = '',
    notes = '',
    evidenceImage = '',
    image = '',
  } = req.body;
  const normGate = (gate || 'ENTRY_1').toUpperCase();
  const current = getGateState(normGate);

  if (req.user) {
    try {
      const finalEvidence = await uploadEvidenceSafe(evidenceImage || image);
      await BarrierAuditLog.create({
        gate: normGate,
        action: hold ? 'hold' : 'close',
        reason: reason || (hold ? 'HOLD_PAUSE' : 'RESUME_NORMAL'),
        notes: notes || '',
        evidenceImage: finalEvidence,
        staffId: req.user._id,
        staffName: req.user.fullName || req.user.username || 'Staff',
      });
    } catch (auditErr) {
      console.error('[BarrierAuditLog] Failed to record hold audit:', auditErr.message);
    }
  }

  const newState = {
    ...current,
    holdOpen: Boolean(hold),
    forceClose: false,
    triggerId: Date.now(),
    licensePlate: hold ? 'PAUSED' : current.licensePlate,
    gate: normGate,
    timestamp: Date.now()
  };

  gateStates[normGate] = newState;
  latestBarrierState = newState;

  const io = req.app.get('io');
  if (io) {
    io.emit('gate:barrier_control', newState);
  }

  return res.json({
    success: true,
    message: hold ? `Barrier ${normGate} paused (IR sensor disabled)` : `Barrier ${normGate} resumed normal mode`,
    data: newState
  });
});

// Xem lịch sử mở cổng cưỡng bức & thao tác Barrier (Audit Trail)
router.get('/barrier-audit-logs', softProtect, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const filter = {};

    // Lọc theo Cổng
    if (req.query.gate && req.query.gate !== 'ALL') {
      filter.gate = String(req.query.gate).trim().toUpperCase();
    }

    // Lọc theo Hành động (open / hold / close)
    if (req.query.action && req.query.action !== 'ALL') {
      filter.action = String(req.query.action).trim().toLowerCase();
    }

    // Lọc theo Ngày cụ thể (YYYY-MM-DD)
    if (req.query.date) {
      const targetDate = new Date(req.query.date);
      if (!isNaN(targetDate.getTime())) {
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
      }
    } else {
      // Lọc theo khoảng ngày (startDate - endDate)
      if (req.query.startDate || req.query.endDate) {
        filter.createdAt = {};
        if (req.query.startDate) {
          const s = new Date(req.query.startDate);
          if (!isNaN(s.getTime())) {
            s.setHours(0, 0, 0, 0);
            filter.createdAt.$gte = s;
          }
        }
        if (req.query.endDate) {
          const e = new Date(req.query.endDate);
          if (!isNaN(e.getTime())) {
            e.setHours(23, 59, 59, 999);
            filter.createdAt.$lte = e;
          }
        }
      }
    }

    // Tìm kiếm theo từ khóa (Biển số xe, Tên nhân viên, Lý do, Ghi chú)
    if (req.query.search && String(req.query.search).trim()) {
      const searchRegex = new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { licensePlate: searchRegex },
        { staffName: searchRegex },
        { reason: searchRegex },
        { notes: searchRegex },
      ];
    }

    const logs = await BarrierAuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('staffId', 'username fullName role email')
      .lean();
    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const closeBarrierHandler = async (req, res) => {
  const { gate = 'ENTRY_1', fromBridge = false, reason = 'MANUAL_CLOSE', notes = '', evidenceImage = '', image = '' } = req.body || {};
  const normGate = (gate || 'ENTRY_1').toUpperCase();
  const current = getGateState(normGate);

  console.log(`[BACKEND IOT] 🔒 NHẬN LỆNH ĐÓNG CỔNG: ${normGate} (Nguồn: ${fromBridge ? 'ESP32 Bridge' : 'Web Staff'})`);

  if (req.user) {
    try {
      const finalEvidence = await uploadEvidenceSafe(evidenceImage || image);
      await BarrierAuditLog.create({
        gate: normGate,
        action: 'close',
        reason: reason || 'MANUAL_CLOSE',
        notes: notes || '',
        evidenceImage: finalEvidence,
        staffId: req.user._id,
        staffName: req.user.fullName || req.user.username || 'Staff',
      });
    } catch (auditErr) {
      console.error('[BarrierAuditLog] Failed to record close audit:', auditErr.message);
    }
  }

  const newState = {
    open: false,
    holdOpen: false,
    forceClose: !fromBridge,
    triggerId: fromBridge ? current.triggerId : Date.now(),
    licensePlate: current.licensePlate || '',
    slotCode: current.slotCode || '',
    gate: normGate,
    isVehiclePassed: true,
    timestamp: Date.now()
  };

  gateStates[normGate] = newState;
  latestBarrierState = newState;

  const io = req.app.get('io');
  if (io) {
    io.emit('gate:barrier_control', newState);
  }

  return res.json({ success: true, message: `Barrier ${normGate} closed`, data: newState });
};

// Phát sự kiện nhận diện xe cho toàn hệ thống Staff theo dõi realtime
router.post('/vehicle-detected', async (req, res) => {
  const {
    gate = 'ENTRY_1',
    mode,
    cleared = false,
    licensePlate = '43B-204.08',
    vehicleModelInfo = 'Peugeot 3008',
    registeredOwnerName = 'Khách hàng',
    phone = '0839404432',
    assignedSlot = 'C1',
    floorName = 'Floor 1',
    isPreBooked = true,
    isRegisteredVehicle = true,
    hasWallet = true,
    canAutoPay = true,
    amountToPay = 0,
    parkingDuration = '1 hrs',
    entryImageBase64 = null,
    exitImageBase64 = null,
  } = req.body || {};

  const normGate = (gate || 'ENTRY_1').toUpperCase();
  const io = req.app.get('io');

  if (cleared || mode === 'cleared') {
    const payload = {
      gate: normGate,
      reason: req.body.reason || 'VEHICLE_BACKED_OUT',
      timestamp: Date.now(),
    };
    if (io) {
      io.emit('gate:vehicle_cleared', payload);
    }
    return res.json({ success: true, message: `Gate ${normGate} cleared`, data: payload });
  }

  const normMode = mode || (normGate.includes('EXIT') ? 'exit' : 'entry');

  const payload = {
    gate: normGate,
    mode: normMode,
    licensePlate,
    vehicleModelInfo,
    registeredOwnerName,
    phone,
    assignedSlot,
    floorName,
    isPreBooked,
    isRegisteredVehicle,
    hasWallet,
    canAutoPay,
    amountToPay,
    parkingDuration,
    entryImageBase64,
    exitImageBase64,
    timestamp: Date.now(),
  };

  if (io) {
    io.emit('gate:vehicle_detected', payload);
  }

  return res.json({ success: true, data: payload });
});

// Phát sự kiện xe rời khỏi khu vực quét (lùi xe, không vào/ra nữa)
router.post('/vehicle-cleared', async (req, res) => {
  const { gate = 'EXIT_1', reason = 'VEHICLE_BACKED_OUT' } = req.body || {};
  const normGate = (gate || 'EXIT_1').toUpperCase();

  const payload = {
    gate: normGate,
    reason,
    timestamp: Date.now(),
  };

  const io = req.app.get('io');
  if (io) {
    io.emit('gate:vehicle_cleared', payload);
  }

  return res.json({ success: true, message: `Gate ${normGate} cleared`, data: payload });
});

// Đóng Barrier thủ công từ Staff/Admin
router.post('/close-barrier', protect, authorize('staff', 'admin'), closeBarrierHandler);

// Đồng bộ đóng Barrier từ bridge nội bộ sau khi ESP32 xác nhận xe đã qua
router.post('/bridge/close-barrier', bridgeProtect, closeBarrierHandler);

const triggerBarrierOpen = (licensePlate, slotCode, gate = 'ENTRY_1', app = null) => {
  const normGate = (gate || 'ENTRY_1').toUpperCase();
  const prevTriggerId = gateStates[normGate]?.triggerId || 0;
  const triggerId = Math.max(Date.now(), prevTriggerId + 1);
  console.log(`[BACKEND IOT] 🚀 TỰ ĐỘNG MỞ CỔNG (Kiosk/System): ${normGate} | Biển số: ${licensePlate || 'N/A'} | Ô: ${slotCode || 'N/A'}`);

  const newState = {
    open: true,
    holdOpen: false,
    forceClose: false,
    triggerId,
    licensePlate: licensePlate || '',
    slotCode: slotCode || '',
    gate: normGate,
    timestamp: Date.now()
  };

  gateStates[normGate] = newState;
  latestBarrierState = newState;

  if (app) {
    const io = typeof app.get === 'function' ? app.get('io') : null;
    if (io) {
      io.emit('gate:barrier_control', newState);
    }
  }

  return newState;
};

const DEFAULT_CAMERA_CONFIG = {
  splitMode: true,
  swapLanes: false,
  splitRatio: 0.5,
  laneOverlap: 0.08,
  entryRotation: 0,
  exitRotation: 180,
  entryRotate180: false,
  exitRotate180: true,
};

let cachedCameraConfig = { ...DEFAULT_CAMERA_CONFIG };

const normalizeRotation = (val, fallback = 0) => {
  const num = Number(val);
  return [0, 90, 180, 270].includes(num) ? num : fallback;
};

const clampNumber = (val, min, max, fallback) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num * 100) / 100));
};

const serializeCameraConfig = (doc) => {
  const entryRotation = doc?.entryRotation != null
    ? normalizeRotation(doc.entryRotation, DEFAULT_CAMERA_CONFIG.entryRotation)
    : (typeof doc?.entryRotate180 === 'boolean' ? (doc.entryRotate180 ? 180 : 0) : DEFAULT_CAMERA_CONFIG.entryRotation);
  const exitRotation = doc?.exitRotation != null
    ? normalizeRotation(doc.exitRotation, DEFAULT_CAMERA_CONFIG.exitRotation)
    : (typeof doc?.exitRotate180 === 'boolean' ? (doc.exitRotate180 ? 180 : 0) : DEFAULT_CAMERA_CONFIG.exitRotation);

  return {
    splitMode: typeof doc?.splitMode === 'boolean' ? doc.splitMode : DEFAULT_CAMERA_CONFIG.splitMode,
    swapLanes: typeof doc?.swapLanes === 'boolean' ? doc.swapLanes : DEFAULT_CAMERA_CONFIG.swapLanes,
    splitRatio: clampNumber(doc?.splitRatio, 0.35, 0.65, DEFAULT_CAMERA_CONFIG.splitRatio),
    laneOverlap: clampNumber(doc?.laneOverlap, 0, 0.2, DEFAULT_CAMERA_CONFIG.laneOverlap),
    entryRotation,
    exitRotation,
    entryRotate180: entryRotation === 180,
    exitRotate180: exitRotation === 180,
  };
};

// Lấy cấu hình cắt vùng & xoay camera 2 làn (Kiosk Vào / Kiosk Ra / Gate Control cùng dùng chung)
router.get('/camera-config', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const doc = await GateCameraConfig.findOne({ key: 'default' }).lean();
    if (doc) {
      cachedCameraConfig = serializeCameraConfig(doc);
    }
  } catch (err) {
    console.warn('[BACKEND IOT] Fallback to cached camera config:', err.message);
  }
  return res.json({ success: true, data: cachedCameraConfig });
});

// Cập nhật cấu hình cắt vùng & xoay camera 2 làn và đồng bộ realtime qua Socket.IO
router.put('/camera-config', protect, authorize('staff', 'admin'), async (req, res) => {
  const body = req.body || {};
  const nextEntryRot = body.entryRotation != null
    ? normalizeRotation(body.entryRotation, cachedCameraConfig.entryRotation)
    : (typeof body.entryRotate180 === 'boolean' ? (body.entryRotate180 ? 180 : 0) : cachedCameraConfig.entryRotation);
  const nextExitRot = body.exitRotation != null
    ? normalizeRotation(body.exitRotation, cachedCameraConfig.exitRotation)
    : (typeof body.exitRotate180 === 'boolean' ? (body.exitRotate180 ? 180 : 0) : cachedCameraConfig.exitRotation);

  const nextConfig = {
    splitMode: typeof body.splitMode === 'boolean' ? body.splitMode : cachedCameraConfig.splitMode,
    swapLanes: typeof body.swapLanes === 'boolean' ? body.swapLanes : cachedCameraConfig.swapLanes,
    splitRatio: body.splitRatio != null
      ? clampNumber(body.splitRatio, 0.35, 0.65, cachedCameraConfig.splitRatio)
      : cachedCameraConfig.splitRatio,
    laneOverlap: body.laneOverlap != null
      ? clampNumber(body.laneOverlap, 0, 0.2, cachedCameraConfig.laneOverlap)
      : cachedCameraConfig.laneOverlap,
    entryRotation: nextEntryRot,
    exitRotation: nextExitRot,
    entryRotate180: nextEntryRot === 180,
    exitRotate180: nextExitRot === 180,
  };

  cachedCameraConfig = nextConfig;

  try {
    const saved = await GateCameraConfig.findOneAndUpdate(
      { key: 'default' },
      { $set: { key: 'default', ...nextConfig } },
      { upsert: true, new: true, lean: true }
    );
    cachedCameraConfig = serializeCameraConfig(saved);
  } catch (err) {
    console.warn('[BACKEND IOT] Failed to persist camera config to DB:', err.message);
  }

  const io = req.app.get('io');
  if (io) {
    io.emit('gate:camera_config', cachedCameraConfig);
  }

  return res.json({ success: true, data: cachedCameraConfig });
});

// Đồng bộ biển số (VIP / Booking khi quét hoặc Check-in hoàn tất) từ Staff Gate Control sang màn hình Check-in Kiosk
router.post('/kiosk-entry-sync', protect, authorize('staff', 'admin'), (req, res) => {
  const {
    mode = 'verified',
    gate = 'ENTRY_1',
    licensePlate,
    verifyData = null,
    session = null,
    entryImageBase64 = null,
  } = req.body || {};
  if (!licensePlate || (!verifyData && !session)) {
    return res.status(400).json({ success: false, message: 'licensePlate and verifyData or session are required' });
  }

  const payload = {
    mode,
    gate: String(gate || 'ENTRY_1').toUpperCase(),
    licensePlate,
    verifyData,
    session,
    entryImageBase64,
    syncedAt: Date.now(),
  };

  const io = req.app.get('io');
  if (io) {
    io.emit('kiosk:entry_plate_synced', payload);
  }

  return res.json({ success: true, data: payload });
});

// Đồng bộ hóa đơn / phiên ra từ Staff Gate Control sang màn hình Check-out Kiosk Out
router.post('/kiosk-exit-sync', protect, authorize('staff', 'admin'), (req, res) => {
  const {
    gate = 'EXIT_1',
    licensePlate,
    invoiceData = null,
    exitImageBase64 = null,
  } = req.body || {};

  if (!licensePlate || !invoiceData) {
    return res.status(400).json({ success: false, message: 'licensePlate and invoiceData are required' });
  }

  const payload = {
    gate: String(gate || 'EXIT_1').toUpperCase(),
    licensePlate,
    invoiceData,
    exitImageBase64,
    syncedAt: Date.now(),
  };

  const io = req.app.get('io');
  if (io) {
    io.emit('kiosk:exit_plate_synced', payload);
  }

  return res.json({ success: true, data: payload });
});

// Broadcast Live Camera Frame từ PC Staff sang các màn hình Kiosk trên Tablet
router.post('/camera-live-frame', (req, res) => {
  const { lane = 'entry', frameBase64, gate = 'ENTRY_1' } = req.body || {};
  if (!frameBase64) {
    return res.status(400).json({ success: false, message: 'frameBase64 is required' });
  }

  const io = req.app.get('io');
  if (io) {
    io.emit('gate:live_frame', {
      lane, // 'entry' | 'exit'
      gate: String(gate).toUpperCase(),
      frameBase64,
      timestamp: Date.now(),
    });
  }

  return res.json({ success: true });
});

module.exports = {
  router,
  triggerBarrierOpen
};
