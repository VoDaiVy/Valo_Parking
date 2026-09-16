const { randomUUID } = require('crypto');
const ParkingFloor = require('../../models/ParkingFloor');
const AINotification = require('../../models/AINotification');
const AIMonitorLease = require('../../models/AIMonitorLease');
const { insertEvent } = require('./notificationEvents');

const INTERVAL_MS = 60000;

async function collectFloorSnapshot(now = new Date()) {
  const { getAllBookableSlots, getAvailableSlotsForRange } = require('../../controllers/bookingController');
  const [floors, bookable, available] = await Promise.all([
    ParkingFloor.find().select('_id name').lean(),
    getAllBookableSlots(),
    getAvailableSlotsForRange(now, new Date(now.getTime() + 60000)),
  ]);
  const countByFloor = (rows) => rows.reduce((map, row) => {
    const key = String(row.floorId);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const capacity = countByFloor(bookable);
  const free = countByFloor(available);
  return floors.map((floor) => ({
    floorId: floor._id, name: floor.name,
    capacity: capacity.get(String(floor._id)) || 0,
    available: free.get(String(floor._id)) || 0,
  }));
}

async function runFloorMonitorNow({ app, now = new Date(), snapshot = collectFloorSnapshot } = {}) {
  const floors = await snapshot(now);
  for (const floor of floors) {
    const deduplicationKey = `floor-full:${floor.floorId}`;
    const occupancyKey = `occupancy-high:${floor.floorId}`;
    const floorLabel = /^floor\b/i.test(floor.name) ? floor.name : `Floor ${floor.name}`;
    
    if (floor.capacity > 0) {
      const occupancyRatio = (floor.capacity - floor.available) / floor.capacity;
      
      // 1. FLOOR_FULL / FLOOR_AVAILABLE_AGAIN
      if (floor.available === 0) {
        await insertEvent({
          app, deduplicationKey, notificationType: 'FLOOR_FULL', severity: 'WARNING',
          targetRoles: ['admin', 'staff'],
          title: `${floorLabel} đã đầy`,
          summary: 'Hiện không còn vị trí đặt chỗ chung khả dụng.',
          entityType: 'parkingFloor', entityId: floor.floorId,
          targetRoute: '/admin/parking-lots',
          evidence: { floorId: floor.floorId, capacity: floor.capacity, available: 0 },
          sourceModules: ['ParkingFloor', 'Booking'], detectedAt: now,
        });
      } else {
        const cleared = await AINotification.updateOne(
          { deduplicationKey, status: 'OPEN' },
          { $set: { status: 'CLEARED', clearedAt: now } }
        );
        if (cleared.modifiedCount > 0) {
          await insertEvent({
            app, deduplicationKey: `floor-available:${floor.floorId}-${now.getTime()}`,
            notificationType: 'FLOOR_AVAILABLE_AGAIN', severity: 'INFO',
            targetRoles: ['admin', 'staff'],
            title: `${floorLabel} đã có chỗ trống`,
            summary: `Hiện đã có ${floor.available} vị trí khả dụng.`,
            entityType: 'parkingFloor', entityId: floor.floorId,
            targetRoute: '/admin/parking-lots',
            evidence: { floorId: floor.floorId, capacity: floor.capacity, available: floor.available },
            sourceModules: ['ParkingFloor', 'Booking'], detectedAt: now,
          });
        }
      }
      
      // 2. OCCUPANCY_HIGH
      if (occupancyRatio >= 0.90 && floor.available > 0) {
        // We only emit OCCUPANCY_HIGH if it's not full, or even if full, it will just remain OPEN
        // But if available === 0, FLOOR_FULL is emitted. So OCCUPANCY_HIGH could be emitted before that.
        await insertEvent({
          app, deduplicationKey: occupancyKey, notificationType: 'OCCUPANCY_HIGH', severity: 'WARNING',
          targetRoles: ['admin', 'staff'],
          title: `${floorLabel} sắp đầy (>= 90%)`,
          summary: `Tỷ lệ lấp đầy đạt ${(occupancyRatio * 100).toFixed(0)}%. Chỉ còn ${floor.available} chỗ.`,
          entityType: 'parkingFloor', entityId: floor.floorId,
          targetRoute: '/admin/parking-lots',
          evidence: { floorId: floor.floorId, capacity: floor.capacity, available: floor.available, ratio: occupancyRatio },
          sourceModules: ['ParkingFloor', 'Booking'], detectedAt: now,
        });
      } else if (occupancyRatio <= 0.85) {
        await AINotification.updateOne(
          { deduplicationKey: occupancyKey, status: 'OPEN' },
          { $set: { status: 'CLEARED', clearedAt: now } }
        );
      }
    }
  }
  return floors;
}

let timer;
function startFloorMonitor(app) {
  if (timer) return;
  const tick = async () => {
    const owner = randomUUID();
    try {
      const now = new Date();
      const lease = await AIMonitorLease.findOneAndUpdate(
        { _id: 'floor-full', $or: [{ until: { $lt: now } }, { until: { $exists: false } }] },
        { $set: { owner, until: new Date(now.getTime() + 90000) } },
        { upsert: true, new: true }
      );
      if (lease?.owner !== owner) return;
      try { await runFloorMonitorNow({ app, now }); }
      finally { await AIMonitorLease.updateOne({ _id: 'floor-full', owner }, { $set: { until: new Date(0) } }); }
    } catch (error) {
      if (error.code !== 11000) console.error('[VALO AI Floor Monitor]', error);
    }
  };
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
}

module.exports = { collectFloorSnapshot, runFloorMonitorNow, startFloorMonitor };
