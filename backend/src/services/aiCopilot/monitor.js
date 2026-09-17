const { randomUUID } = require('crypto');
const Session = require('../../models/Session');
const AINotification = require('../../models/AINotification');
const AIMonitorLease = require('../../models/AIMonitorLease');
const statistics = require('../statisticsService');

const WINDOW_MS = 30 * 60000;
const WEEK_MS = 7 * 86400000;
const median = (values) => { const s = [...values].sort((a, b) => a - b); return (s[1] + s[2]) / 2; };
function candidateFromSeries(metric, current, historical, checkedAt) {
  if (historical.length !== 4 || historical.filter((n) => Number.isFinite(n) && n > 0).length < 3) return { candidate: false, insufficientBaseline: true, reason: 'Not enough comparable historical periods' };
  const center = median(historical);
  const mad = median(historical.map((n) => Math.abs(n - center)));
  if (!mad) return { candidate: false, insufficientBaseline: true, reason: 'Historical distribution has no measurable variation' };
  const robustDeviation = Math.abs(current - center) / (1.4826 * mad);
  if (robustDeviation < 3.5) return { candidate: false, insufficientBaseline: false };
  
  if (metric === 'revenue') {
    const rawThreshold = Number(process.env.AI_REVENUE_MIN_ABSOLUTE_CHANGE_VND);
    const minAbsoluteChange = (Number.isNaN(rawThreshold) || rawThreshold < 0) ? 500000 : rawThreshold;
    if (Math.abs(current - center) < minAbsoluteChange) {
      return { candidate: false, insufficientBaseline: false, reason: 'Absolute change below anti-spam threshold' };
    }
  }
  
  return { candidate: true, metric, current, baseline: historical, median: center, robustDeviation, direction: current > center ? 'increase' : 'decrease', checkedAt };
}
async function collectWindow(end) {
  const start = new Date(end.getTime() - WINDOW_MS);
  const [sessions, revenue] = await Promise.all([
    Session.countDocuments({ checkInTime: { $gte: start, $lt: end } }),
    statistics.getAdminPlatformRevenueStatistics({ startDate: start.toISOString(), endDate: end.toISOString() }),
  ]);
  return { sessions, revenue: Number(revenue.totalRevenue || 0) };
}
const recommendedActionsFor = (metric) => metric === 'revenue'
  ? ['Kiểm tra số liệu doanh thu và cấu hình giá trong cùng khoảng thời gian để tìm nguyên nhân.']
  : ['Kiểm tra thống kê phiên xe và tình trạng chỗ đỗ trong cùng khoảng thời gian để tìm nguyên nhân.'];
async function runMonitorNow({ io } = {}) {
  const now = new Date();
  const windows = await Promise.all([0, 1, 2, 3, 4].map((week) => collectWindow(new Date(now.getTime() - week * WEEK_MS))));
  const output = [];
  for (const [metric, label] of [['sessions', 'Lượt xe'], ['revenue', 'Doanh thu']]) {
    const signal = candidateFromSeries(metric, windows[0][metric], windows.slice(1).map((w) => w[metric]), now.toISOString());
    if (!signal.candidate) {
      if (!signal.insufficientBaseline) {
        const keys = [`weekly-30m:${metric}:increase`, `weekly-30m:${metric}:decrease`];
        for (const key of keys) {
          const item = await AINotification.findOneAndUpdate({ deduplicationKey: key, status: 'OPEN' }, { $inc: { cleanChecks: 1 } }, { new: true });
          if (item?.cleanChecks >= 2) await AINotification.updateOne({ _id: item._id, status: 'OPEN' }, { $set: { status: 'CLEARED', clearedAt: now } });
        }
      }
      output.push({ metric, ...signal }); continue;
    }
    const actions = recommendedActionsFor(metric);
    const title = `${label} thay đổi khác biệt so với các kỳ tương đương`;
    const summary = `${label} trong 30 phút gần nhất: ${signal.current}; trung vị của bốn khung cùng giờ, cùng thứ: ${signal.median}. Đây là tín hiệu thống kê, chưa xác định nguyên nhân.`;
    const deduplicationKey = `weekly-30m:${metric}:${signal.direction}`;
    await AINotification.updateOne({ deduplicationKey: `weekly-30m:${metric}:${signal.direction === 'increase' ? 'decrease' : 'increase'}`, status: 'OPEN' }, { $set: { status: 'CLEARED', clearedAt: now } });
    const severity = signal.robustDeviation >= 5 ? 'WARNING' : 'NOTICE';
    const existing = await AINotification.findOne({ deduplicationKey, status: 'OPEN' });
    const notification = existing ? await AINotification.findByIdAndUpdate(existing._id, { $set: { evidence: signal, affectedMetrics: [{ name: metric, currentValue: signal.current, baselineValue: signal.median }], recommendedActions: actions, lastDetectedAt: now, cleanChecks: 0 } }, { new: true }) : await AINotification.findOneAndUpdate({ deduplicationKey, status: 'OPEN' }, { $setOnInsert: { title, summary, severity, notificationType: metric === 'revenue' ? 'REVENUE_ANOMALY' : 'SESSION_CHANGE', evidence: signal, affectedMetrics: [{ name: metric, currentValue: signal.current, baselineValue: signal.median }], recommendedActions: actions, sourceModules: metric === 'revenue' ? ['statisticsService'] : ['Session'], detectedAt: now, lastDetectedAt: now } }, { upsert: true, new: true });
    if (!existing && io) io.to('valo-ai-admins').emit('ai:notification', { id: notification._id, title, severity });
    output.push({ metric, candidate: true, persisted: true, notificationId: notification._id });
  }
  return output;
}
let timer;
function startMonitor(app) {
  const parsed = Number(process.env.AI_MONITOR_INTERVAL_MS);
  const interval = Number.isFinite(parsed) && parsed >= 60000 ? parsed : 1800000;
  if (timer) return;
  timer = setInterval(async () => {
    const owner = randomUUID();
    try {
      const lease = await AIMonitorLease.findOneAndUpdate(
        { _id: 'primary', $or: [{ until: { $lt: new Date() } }, { until: { $exists: false } }] },
        { $set: { owner, until: new Date(Date.now() + Math.max(interval, 15 * 60000)) } },
        { upsert: true, new: true }
      );
      if (!lease || lease.owner !== owner) return;
      try { await runMonitorNow({ io: app.get('io') }); }
      finally { await AIMonitorLease.updateOne({ _id: 'primary', owner }, { $set: { until: new Date(0) } }); }
    } catch (error) { if (error.code !== 11000) console.error('[AI Monitor]', error.message); }
  }, interval);
  timer.unref?.();
}
module.exports = { candidateFromSeries, runMonitorNow, startMonitor };
