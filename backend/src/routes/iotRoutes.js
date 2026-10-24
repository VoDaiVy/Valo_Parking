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
  gate: state.gate,
  timestamp: state.timestamp,
});

const canViewGateDetails = (req) => ['staff', 'admin'].includes(req.user?.role);

const bridgeProtect = (req, res, next) => {
  const configuredToken = process.env.IOT_BRIDGE_TOKEN || process.env.SESSION_QR_SECRET || process.env.JWT_SECRET || 'VALO_IOT_INTERNAL_BRIDGE_DEFAULT_TOKEN';
  const receivedToken = req.get('x-bridge-token') || '';
  if (!configuredToken || !receivedToken) {
    return res.status(401).json({ success: false, message: 'Bridge authentication is not configured' });
  }
  const expected = Buffer.from(configuredToken);
  const actual = Buffer.from(receivedToken);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(401).json({ success: false, message: 'Invalid bridge token' });
  }
  req.isBridge = true;
  return next();
};

// ESP32 & Web Kiosks gọi API này để kiểm tra lệnh mở Barrier theo cổng
router.get('/barrier-status', softProtect, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const { gate } = req.query;
  const showDetails = canViewGateDetails(req);
  if (gate) {
    const state = getGateState(gate);
    return res.json({
      success: true,
      data: showDetails ? state : toPublicGateState(state),
      gates: showDetails
        ? gateStates
        : Object.fromEntries(Object.entries(gateStates).map(([key, value]) => [key, toPublicGateState(value)])),
    });
  }

  return res.json({
    success: true,
    data: showDetails ? latestBarrierState : toPublicGateState(latestBarrierState),
    gates: showDetails
      ? gateStates
      : Object.fromEntries(Object.entries(gateStates).map(([key, value]) => [key, toPublicGateState(value)])),
  });
});

// API kích hoạt mở Barrier (Dùng cho Kiosk hoặc nút bấm test)
router.post('/open-barrier', protect, authorize('staff', 'admin'), (req, res) => {
  const { licensePlate = 'TEST-VEHICLE', slotCode = 'A-01', gate = 'ENTRY_1', hold = false } = req.body;
  const normGate = (gate || 'ENTRY_1').toUpperCase();

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
