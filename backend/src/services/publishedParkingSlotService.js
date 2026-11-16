const ParkingFloor = require('../models/ParkingFloor');
const Slot = require('../models/Slot');

const assertPublishedSlot = async (floorId, slotCode, session = null) => {
  if (!floorId) {
    const error = new Error('Thiếu thông tin tầng đỗ xe');
    error.statusCode = 400;
    throw error;
  }

  const floorQuery = ParkingFloor.findById(floorId);
  if (session) floorQuery.session(session);
  const floor = await floorQuery.lean();

  if (!floor) {
    const error = new Error('Tầng đỗ xe không tồn tại');
    error.statusCode = 404;
    throw error;
  }

  if (floor.status === 'archived') {
    const error = new Error('Tầng đỗ xe đã bị lưu trữ hoặc ngừng hoạt động');
    error.statusCode = 400;
    throw error;
  }

  if (slotCode) {
    const normalized = String(slotCode).trim().toUpperCase();
    let slotFound = false;
    for (const el of floor.layoutData?.elements || []) {
      if (el.type && el.type.startsWith('slot') && String(el.name || '').trim().toUpperCase() === normalized) {
        slotFound = true;
        break;
      }
    }
    if (!slotFound) {
      const dbSlotQuery = Slot.findOne({ floorID: floorId, slotNumber: normalized });
      if (session) dbSlotQuery.session(session);
      const dbSlot = await dbSlotQuery.lean();
      if (dbSlot) slotFound = true;
    }

    if (!slotFound) {
      const error = new Error(`Ô đỗ ${normalized} không tồn tại trên tầng này`);
      error.statusCode = 400;
      throw error;
    }
  }

  return true;
};

module.exports = {
  assertPublishedSlot,
};

