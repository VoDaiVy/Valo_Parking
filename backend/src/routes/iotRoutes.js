const express = require('express');
const router = express.Router();

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

// ESP32 & Web Kiosks gọi API này để kiểm tra lệnh mở Barrier theo cổng
router.get('/barrier-status', (req, res) => {
  const { gate } = req.query;
  if (gate) {
    const state = getGateState(gate);
    return res.json({
      success: true,
      data: state,
      gates: gateStates
    });
  }

  return res.json({
    success: true,
    data: latestBarrierState,
    gates: gateStates
  });
});

// API kích hoạt mở Barrier (Dùng cho Kiosk hoặc nút bấm test)
router.post('/open-barrier', (req, res) => {
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
router.post('/hold-barrier', (req, res) => {
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

// Đóng Barrier
router.post('/close-barrier', (req, res) => {
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
});

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

