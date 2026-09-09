const express = require('express');
const router = express.Router();

let latestBarrierState = {
  open: false,
  triggerId: 0,
  licensePlate: '',
  slotCode: '',
  gate: 'ENTRY_1',
  timestamp: Date.now()
};

// ESP32 gọi API này mỗi 1 giây để kiểm tra lệnh mở Barrier
router.get('/barrier-status', (req, res) => {
  return res.json({
    success: true,
    data: latestBarrierState
  });
});

// API kích hoạt mở Barrier (Dùng cho Kiosk hoặc nút bấm test)
router.post('/open-barrier', (req, res) => {
  const { licensePlate = 'TEST-VEHICLE', slotCode = 'A-01', gate = 'ENTRY_1' } = req.body;
  
  latestBarrierState = {
    open: true,
    triggerId: Date.now(),
    licensePlate,
    slotCode,
    gate,
    timestamp: Date.now()
  };

  const io = req.app.get('io');
  if (io) {
    io.emit('gate:barrier_control', latestBarrierState);
  }

  return res.json({ success: true, message: 'Barrier open triggered', data: latestBarrierState });
});

// Đóng Barrier
router.post('/close-barrier', (req, res) => {
  latestBarrierState.open = false;
  latestBarrierState.timestamp = Date.now();
  return res.json({ success: true, message: 'Barrier closed', data: latestBarrierState });
});

const triggerBarrierOpen = (licensePlate, slotCode, gate = 'ENTRY_1') => {
  latestBarrierState = {
    open: true,
    triggerId: Date.now(),
    licensePlate: licensePlate || '',
    slotCode: slotCode || '',
    gate,
    timestamp: Date.now()
  };
  return latestBarrierState;
};

module.exports = {
  router,
  triggerBarrierOpen
};
