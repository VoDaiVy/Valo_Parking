const express = require('express');
const router = express.Router();
const crypto = require('crypto');
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

const bridgeProtect = (req, res, next) => {
  const configuredToken = process.env.IOT_BRIDGE_TOKEN || 'VALO_IOT_INTERNAL_BRIDGE_DEFAULT_TOKEN';
  const receivedToken = req.get('x-bridge-token') || '';
  if (!receivedToken) {
    return res.status(401).json({ success: false, message: 'Bridge authentication token is required' });
  }

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

  const isAuthorized = isMatch(configuredToken, receivedToken) ||
    (isLocalRequest && isMatch('VALO_IOT_INTERNAL_BRIDGE_DEFAULT_TOKEN', receivedToken)) ||
    (process.env.JWT_SECRET && isMatch(process.env.JWT_SECRET, receivedToken));

  if (!isAuthorized) {
    return res.status(401).json({ success: false, message: 'Invalid bridge token' });
  }
  req.isBridge = true;
  return next();
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
  const { gate } = req.query;
  const showDetails = canViewGateDetails(req);
  const capacity = await fetchCapacitySafe();

  if (gate) {
    const state = getGateState(gate);
    return res.json({
      success: true,
      data: showDetails ? state : toPublicGateState(state),
      gates: showDetails
        ? gateStates
        : Object.fromEntries(Object.entries(gateStates).map(([key, value]) => [key, toPublicGateState(value)])),
      capacity,
    });
  }

  return res.json({
    success: true,
    data: showDetails ? latestBarrierState : toPublicGateState(latestBarrierState),
    gates: showDetails
      ? gateStates
      : Object.fromEntries(Object.entries(gateStates).map(([key, value]) => [key, toPublicGateState(value)])),
    capacity,
  });
});

// API chuyên dụng lấy công suất bãi xe (Dùng cho Bảng hiển thị LCD ngoài cổng & Kiosk)
router.get('/capacity', softProtect, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const capacity = await fetchCapacitySafe();
  return res.json({
    success: true,
    capacity,
  });
});

// API kích hoạt mở Barrier (Dùng cho Kiosk hoặc nút bấm test)
router.post('/open-barrier', protect, authorize('staff', 'admin'), (req, res) => {
  const { licensePlate = 'TEST-VEHICLE', slotCode = 'A-01', gate = 'ENTRY_1', hold = false } = req.body;
  const normGate = (gate || 'ENTRY_1').toUpperCase();

  console.log(`[BACKEND IOT] 🚀 NHẬN LỆNH MỞ CỔNG từ Web: ${normGate} | Biển số: ${licensePlate} | Ô: ${slotCode}`);

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
router.post('/hold-barrier', protect, authorize('staff', 'admin'), (req, res) => {
  const { hold = true, gate = 'ENTRY_1' } = req.body;
  const normGate = (gate || 'ENTRY_1').toUpperCase();
  const current = getGateState(normGate);

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

const closeBarrierHandler = (req, res) => {
  const { gate = 'ENTRY_1', fromBridge = false } = req.body || {};
  const normGate = (gate || 'ENTRY_1').toUpperCase();
  const current = getGateState(normGate);

  console.log(`[BACKEND IOT] 🔒 NHẬN LỆNH ĐÓNG CỔNG: ${normGate} (Nguồn: ${fromBridge ? 'ESP32 Bridge' : 'Web Staff'})`);

  const newState = {
    open: false,
    holdOpen: false,
    forceClose: !fromBridge,
    triggerId: fromBridge ? current.triggerId : Date.now(),
    licensePlate: '',
    slotCode: '',
    gate: normGate,
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

// Đóng Barrier thủ công từ Staff/Admin
router.post('/close-barrier', protect, authorize('staff', 'admin'), closeBarrierHandler);

// Đồng bộ đóng Barrier từ bridge nội bộ sau khi ESP32 xác nhận xe đã qua
router.post('/bridge/close-barrier', bridgeProtect, closeBarrierHandler);

const triggerBarrierOpen = (licensePlate, slotCode, gate = 'ENTRY_1', app = null) => {
  const normGate = (gate || 'ENTRY_1').toUpperCase();
  const newState = {
    open: true,
    holdOpen: false,
    forceClose: false,
    triggerId: Date.now(),
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

module.exports = {
  router,
  triggerBarrierOpen
};
