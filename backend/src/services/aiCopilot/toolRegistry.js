const mongoose = require('mongoose');
const statistics = require('../statisticsService');
const Session = require('../../models/Session');
const Slot = require('../../models/Slot');
const ParkingFloor = require('../../models/ParkingFloor');
const User = require('../../models/User');
const TicketPackage = require('../../models/TicketPackage');
const Subscription = require('../../models/Subscription');
const Service = require('../../models/Service');
const BookingService = require('../../models/BookingService');
const Policy = require('../../models/Policy');
const PolicyAcceptance = require('../../models/PolicyAcceptance');
const PricingConfig = require('../../models/PricingConfig');
const AINotification = require('../../models/AINotification');
const pricingEngine = require('../pricingEngine');
const { startOfVietnamDay, parseVietnamCalendarDate } = require('../../utils/bookingDateRange');

const dateProperties = {
  startDate: { type: 'string', description: 'ISO date, inclusive' },
  endDate: { type: 'string', description: 'ISO date, inclusive' },
};
const dateSchema = { type: 'object', properties: dateProperties };
const emptySchema = { type: 'object', properties: {} };

function validateDates(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tham số không hợp lệ.');
  const keys = Object.keys(args);
  if (keys.some((key) => !['startDate', 'endDate'].includes(key))) throw new Error('Tham số không được hỗ trợ.');
  if (keys.some((key) => typeof args[key] !== 'string' || !args[key].trim())) throw new Error('Ngày phải là chuỗi ISO hợp lệ.');
  const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const start = args.startDate ? (isDay(args.startDate) ? parseVietnamCalendarDate(args.startDate) : new Date(args.startDate)) : null;
  const end = args.endDate ? (isDay(args.endDate) ? new Date(parseVietnamCalendarDate(args.endDate).getTime() + 86400000 - 1) : new Date(args.endDate)) : new Date();
  if ((start && !Number.isFinite(start.getTime())) || !Number.isFinite(end.getTime()) || (start && start > end) || (start && end - start > 366 * 86400000) || end > new Date(Date.now() + 86400000)) throw new Error('Khoảng ngày không hợp lệ hoặc quá 366 ngày.');
  return start ? { startDate: start.toISOString(), endDate: end.toISOString() } : { range: 'today' };
}
function noArgs(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('Công cụ này không nhận tham số.');
  return {};
}
const define = (name, description, parameters, validate, run) => ({ name, description, parameters, validate, run });
const tools = [
  define('get_revenue_metrics', 'Doanh thu nền tảng từ booking, gói vé, gia hạn và phí chuyển nhượng; không chỉ tiền phạt.', dateSchema, validateDates, async (p) => statistics.getAdminPlatformRevenueStatistics(p)),
  define('get_session_statistics', 'Thống kê phiên xe theo trạng thái trong khoảng thời gian.', dateSchema, validateDates, async (p) => {
    const match = p.startDate ? { checkInTime: { $gte: new Date(p.startDate), $lte: new Date(p.endDate) } } : { checkInTime: { $gte: startOfVietnamDay(new Date()) } };
    const rows = await Session.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 }, averageDurationHours: { $avg: '$expectedDurationHours' } } }]);
    return { byStatus: rows.map((row) => ({ status: row._id, count: row.count, averageExpectedDurationHours: row.averageDurationHours })), period: p };
  }),
  define('get_parking_occupancy', 'Số chỗ và tình trạng theo tầng hiện tại.', emptySchema, noArgs, async () => {
    const [floors, rows] = await Promise.all([ParkingFloor.find().select('name floorNumber').lean(), Slot.aggregate([{ $group: { _id: { floorID: '$floorID', status: '$status' }, count: { $sum: 1 } } }])]);
    return floors.map((floor) => ({ floorId: String(floor._id), name: floor.name, floorNumber: floor.floorNumber, statuses: rows.filter((r) => String(r._id.floorID) === String(floor._id)).map((r) => ({ status: r._id.status, count: r.count })) }));
  }),
  define('get_user_summary', 'Số tài khoản theo vai trò và trạng thái; không trả PII.', emptySchema, noArgs, async () => User.aggregate([{ $group: { _id: { role: '$role', active: '$status' }, count: { $sum: 1 } } }])),
  define('get_pricing_config', 'Bảng giá đang có hiệu lực; phân biệt cấu hình mặc định.', emptySchema, noArgs, async () => {
    const config = await PricingConfig.findOne({ isActive: true }).sort({ createdAt: -1 }).select('timeBlocks cap12h cap24h createdAt').lean();
    return config ? { ...config, source: 'PricingConfig' } : { ...(await pricingEngine.getActivePricingConfig()), configured: false, source: 'pricingEngine.DEFAULT_CONFIG', note: 'Bảng giá mặc định đang được sử dụng vì DB chưa có cấu hình hoạt động.' };
  }),
  define('get_package_list', 'Danh sách gói vé và số đăng ký thực tế.', emptySchema, noArgs, async () => {
    const [packages, counts] = await Promise.all([TicketPackage.find().select('name type price description isActive maxSlots updatedAt').lean(), Subscription.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: '$ticketPackage', sold: { $sum: 1 } } }])]);
    return packages.map((p) => ({ ...p, sold: counts.find((c) => String(c._id) === String(p._id))?.sold || 0 }));
  }),
  define('get_subscription_stats', 'Thống kê đăng ký và gia hạn gói.', dateSchema, validateDates, async (p) => statistics.getAdminSubscriptionStatistics(p)),
  define('get_service_catalog', 'Dịch vụ hiện có và số lượt đặt.', emptySchema, noArgs, async () => {
    const [services, counts] = await Promise.all([Service.find().select('name price isActive').lean(), BookingService.aggregate([{ $group: { _id: '$serviceId', usage: { $sum: 1 } } }])]);
    return services.map((s) => ({ ...s, usage: counts.find((c) => String(c._id) === String(s._id))?.usage || 0 }));
  }),
  define('get_policy_summary', 'Chính sách đã công bố và lượt chấp nhận.', emptySchema, noArgs, async () => {
    const [policies, counts] = await Promise.all([Policy.find({ status: 'published' }).select('title category currentVersionNumber requiresAcceptance updatedAt').lean(), PolicyAcceptance.aggregate([{ $group: { _id: '$policyId', count: { $sum: 1 } } }])]);
    return policies.map((p) => ({ ...p, acceptanceCount: counts.find((c) => String(c._id) === String(p._id))?.count || 0 }));
  }),
  define('check_system_health', 'Chỉ số sức khỏe có thể xác minh: kết nối DB và số phiên đang hoạt động.', emptySchema, noArgs, async () => ({ databaseConnected: mongoose.connection.readyState === 1, activeSessions: await Session.countDocuments({ status: 'active' }), checkedAt: new Date().toISOString() })),
  define('get_ai_notifications', 'Cảnh báo AI mới nhất có bằng chứng.', emptySchema, noArgs, async () => AINotification.find({ status: 'OPEN' }).sort({ detectedAt: -1 }).limit(10).select('title summary severity evidence detectedAt').lean()),
];
const registry = new Map(tools.map((tool) => [tool.name, tool]));
async function execute(name, args) {
  const tool = registry.get(name);
  if (!tool) throw new Error('Công cụ không nằm trong allowlist.');
  const params = tool.validate(args);
  const data = await tool.run(params);
  return { tool: name, source: name, timestamp: new Date().toISOString(), parameters: params, data };
}
module.exports = { tools, execute, validateDates };
