const { randomUUID } = require('crypto');
const Session = require('../../models/Session');
const AINotification = require('../../models/AINotification');
const AIMonitorLease = require('../../models/AIMonitorLease');
const { insertEvent } = require('./notificationEvents');

const INTERVAL_MS = 60000;

async function runSessionOverdueMonitorNow({ app, now = new Date(), baseline }) {
  // Query sessions that are active and strictly overdue
  // Expected end = checkInTime + (expectedDurationHours * 3600000)
  // Must be strictly < now
  // Must also cross the overdue line AFTER the baseline (to prevent historical replay)
  
  const overdueSessions = await Session.aggregate([
    {
      $match: {
        status: 'active',
        checkInTime: { $ne: null },
        expectedDurationHours: { $gt: 0, $type: 'number' },
      }
    },
    {
      $addFields: {
        expectedEndTime: {
          $add: ["$checkInTime", { $multiply: ["$expectedDurationHours", 3600000] }]
        }
      }
    },
    {
      $match: {
        expectedEndTime: { $lt: now },
        $or: [
          { checkInTime: { $gte: baseline } },
          { expectedEndTime: { $gte: baseline } }
        ]
      }
    }
  ]);

  for (const session of overdueSessions) {
    const deduplicationKey = `session-overdue:${session._id.toString()}`;
    await insertEvent({
      app, deduplicationKey, notificationType: 'SESSION_OVERDUE', severity: 'WARNING',
      targetRoles: ['admin', 'staff'],
      title: `Phiên đỗ xe quá hạn`,
      summary: `Xe ${session.licensePlate || 'Không rõ biển số'} tại vị trí ${session.parkingSlot || 'N/A'} đã đỗ quá thời gian dự kiến.`,
      entityType: 'session', entityId: session._id, targetRoute: '/admin/sessions',
      evidence: { sessionId: session._id, licensePlate: session.licensePlate, checkInTime: session.checkInTime, expectedEndTime: session.expectedEndTime },
      sourceModules: ['Session'], detectedAt: now,
    });
  }

  // Cleanup: Find any OPEN SESSION_OVERDUE notifications where the session is no longer active
  const openOverdueNotifications = await AINotification.find({
    notificationType: 'SESSION_OVERDUE',
    status: 'OPEN'
  }).lean();

  if (openOverdueNotifications.length > 0) {
    const activeSessionIds = new Set(
      (await Session.find({
        _id: { $in: openOverdueNotifications.map(n => n.entityId) },
        status: 'active'
      }).select('_id').lean()).map(s => s._id.toString())
    );

    const toClear = openOverdueNotifications
      .filter(n => !activeSessionIds.has(n.entityId.toString()))
      .map(n => n._id);

    if (toClear.length > 0) {
      await AINotification.updateMany(
        { _id: { $in: toClear } },
        { $set: { status: 'CLEARED', clearedAt: now } }
      );
    }
  }

  return overdueSessions.length;
}

let timer;
function startSessionOverdueMonitor(app) {
  if (timer) return;
  const tick = async () => {
    const owner = randomUUID();
    try {
      const now = new Date();
      // Use AIMonitorLease to manage baseline and locking
      const lease = await AIMonitorLease.findOneAndUpdate(
        { _id: 'session-overdue', $or: [{ until: { $lt: now } }, { until: { $exists: false } }] },
        { $setOnInsert: { baseline: now }, $set: { owner, until: new Date(now.getTime() + 90000) } },
        { upsert: true, new: true }
      );
      if (lease?.owner !== owner) return;
      
      try { 
        await runSessionOverdueMonitorNow({ app, now, baseline: lease.baseline }); 
      } finally { 
        await AIMonitorLease.updateOne({ _id: 'session-overdue', owner }, { $set: { until: new Date(0) } }); 
      }
    } catch (error) {
      if (error.code !== 11000) console.error('[VALO AI Session Overdue Monitor]', error);
    }
  };
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
}

module.exports = { runSessionOverdueMonitorNow, startSessionOverdueMonitor };
