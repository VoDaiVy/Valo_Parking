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
const readTools = require('./readTools');
const { getVehicleApprovalStatistics } = require('../vehicleApprovalStatisticsService');
const { MEMBERSHIP_KPIS } = require('./membershipResponses');

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
function subscriptionStatisticsArgs(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['range', 'startDate', 'endDate', 'kpis'].includes(key))) throw new Error('Invalid membership statistics filters.');
  if (args.range !== undefined && !['today', '7d', '30d', 'month', 'all'].includes(args.range)) throw new Error('Invalid membership statistics range.');
  if (args.kpis !== undefined && (!Array.isArray(args.kpis) || args.kpis.some(key => !MEMBERSHIP_KPIS.includes(key)))) throw new Error('Invalid membership KPIs.');
  const dates = Object.fromEntries(['startDate', 'endDate'].filter(key => args[key] !== undefined).map(key => [key, args[key]]));
  const period = dates.startDate ? validateDates(dates) : dates.endDate ? { endDate: validateDates({ startDate: dates.endDate, endDate: dates.endDate }).endDate } : Object.keys(dates).length ? validateDates(dates) : { range: args.range || 'today' };
  return { ...period, ...(args.kpis !== undefined ? { kpis: args.kpis } : {}) };
}
/* passthrough validator: returns args as-is so readTools functions handle their own validation */
function passArgs(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tham số không hợp lệ.');
  return args;
}
const define = (name, description, parameters, validate, run) => ({ name, description, parameters, validate, run });
const tools = [
  /* ── 11 existing aggregate / summary tools (untouched) ─────────────── */
  define(
    'get_revenue_metrics', 
    'QUAN TRỌNG: Từ khóa "doanh thu hệ thống", "tổng doanh thu", "platform revenue" => dùng scope="platform". Từ khóa "doanh thu bãi đỗ xe", "doanh thu booking", "tiền đặt chỗ" => dùng scope="parking". Trả về tổng doanh thu và breakdown theo từng ngày (timeline) trong khoảng thời gian.', 
    {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'ISO date hoặc YYYY-MM-DD, inclusive' },
        endDate: { type: 'string', description: 'ISO date hoặc YYYY-MM-DD, inclusive' },
        scope: { type: 'string', enum: ['platform', 'parking'], description: 'platform (Recorded Sales) hay parking (Parking Revenue).' }
      }
    }, 
    (args = {}) => {
      const datesArgs = {};
      if (args.startDate) datesArgs.startDate = args.startDate;
      if (args.endDate) datesArgs.endDate = args.endDate;
      return { ...validateDates(datesArgs), scope: args.scope || 'platform' };
    }, 
    async (p) => {
      if (p.scope === 'parking') {
        const stats = await statistics.getAdminPlatformRevenueStatistics(p);
        return {
          period: stats.period,
          scope: 'parking',
          parkingRevenue: stats.booking.revenue,
          completedBookingCount: stats.booking.completedCount
        };
      } else {
        // Use canonical platform-revenue service directly
        const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
        const start = p.startDate ? new Date(p.startDate) : null;
        const end = p.endDate ? new Date(p.endDate) : new Date();
        // Determine best mode from the date range
        const daysDiff = start ? Math.round((end - start) / 86400000) : 0;
        let mode = 'month';
        let modeFilters = {};
        if (start) {
          const localStart = new Date(start.getTime() + 7 * 3600000);
          const localEnd = new Date(end.getTime() + 7 * 3600000);
          if (daysDiff <= 7) {
            mode = '7d';
          } else if (daysDiff <= 31) {
            mode = 'month';
            modeFilters = { year: String(localStart.getUTCFullYear()), month: String(localStart.getUTCMonth() + 1) };
          } else if (daysDiff <= 93) {
            mode = 'quarter';
            modeFilters = { year: String(localStart.getUTCFullYear()), quarter: String(Math.ceil((localStart.getUTCMonth() + 1) / 3)) };
          } else {
            mode = 'year';
            modeFilters = { year: String(localStart.getUTCFullYear()) };
          }
        }

        const stats = await statistics.getAdminPlatformRevenueStatistics({
          mode,
          ...modeFilters,
        });

        const summary = stats.summary || {};
        const totalRevenue = summary.totalRevenue ?? stats.totalRevenue ?? 0;
        const recordedSales = totalRevenue;
        return {
          period: stats.period,
          scope: 'platform',
          totalRevenue,
          recordedSales,
          bookingRevenue: summary.bookingRevenue ?? stats.booking?.revenue ?? 0,
          serviceRevenue: summary.serviceRevenue ?? stats.service?.revenue ?? 0,
          packageRevenue: summary.packageRevenue ?? stats.vip?.revenue ?? 0,
          membershipTransferFees: summary.membershipTransferFees ?? stats.membershipTransferFeesDetail?.revenue ?? 0,
          parkingRevenue: summary.parkingRevenue ?? stats.parking?.revenue ?? 0,
          refunds: summary.refunds ?? 0,
          sourceCompositionTotal: summary.sourceCompositionTotal ?? totalRevenue,
          timeline: (stats.trend || []).map((pt) => ({
            date: pt.period,
            totalRevenue: pt.totalRevenue ?? 0,
            recordedSales: pt.totalRevenue ?? 0,
            bookingRevenue: pt.bookingRevenue ?? 0,
            serviceRevenue: pt.serviceRevenue ?? 0,
            packageRevenue: pt.packageRevenue ?? 0,
            membershipTransferFees: pt.membershipTransferFees ?? 0,
            parkingRevenue: pt.parkingRevenue ?? 0,
          })),
        };
      }
    }
  ),
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
  define('get_subscription_stats', 'Read only requested membership KPIs. Expiring Soon uses the dashboard definition: active subscriptions expiring today through Vietnam calendar day 30, without a paid-only filter. Pending Transfers counts PENDING_ADMIN among the dashboard latest 100 transfer reviews, never pending subscriptions. Other sales/renewal KPIs use the requested period. Financial coverage is partial.',
    { type: 'object', properties: { ...dateProperties, range: { type: 'string', enum: ['today', '7d', '30d', 'month', 'all'] }, kpis: { type: 'array', items: { type: 'string', enum: MEMBERSHIP_KPIS }, description: 'Only the KPIs explicitly requested. expiringSoon means 30 calendar days; expiringWithin7Days is a separate explicit 7-day KPI.' } } }, subscriptionStatisticsArgs, async (p) => readTools.getMembershipStatistics(p)),
  define('get_service_catalog', 'Dịch vụ hiện có và số lượt đặt.', emptySchema, noArgs, async () => {
    const [services, counts] = await Promise.all([Service.find().select('_id name price timeCost description isActive updatedAt').lean(), BookingService.aggregate([{ $group: { _id: '$serviceId', usage: { $sum: 1 } } }])]);
    return services.map((s) => ({ ...s, usage: counts.find((c) => String(c._id) === String(s._id))?.usage || 0 }));
  }),
  define('get_policy_summary', 'Chính sách đã công bố và lượt chấp nhận.', emptySchema, noArgs, async () => {
    const [policies, counts] = await Promise.all([Policy.find({ status: 'published' }).select('title category currentVersionNumber requiresAcceptance updatedAt').lean(), PolicyAcceptance.aggregate([{ $group: { _id: '$policyId', count: { $sum: 1 } } }])]);
    return policies.map((p) => ({ ...p, acceptanceCount: counts.find((c) => String(c._id) === String(p._id))?.count || 0 }));
  }),
  define('check_system_health', 'Chỉ số sức khỏe có thể xác minh: kết nối DB và số phiên đang hoạt động.', emptySchema, noArgs, async () => ({ databaseConnected: mongoose.connection.readyState === 1, activeSessions: await Session.countDocuments({ status: 'active' }), checkedAt: new Date().toISOString() })),
  define('get_ai_notifications', 'Cảnh báo AI mới nhất có bằng chứng.', emptySchema, noArgs, async () => AINotification.find({ status: 'OPEN' }).sort({ detectedAt: -1 }).limit(10).select('title summary severity evidence detectedAt').lean()),
  define(
    'get_vehicle_approval_statistics',
    'Đếm số xe đã được duyệt theo thời điểm duyệt, gồm AI Gemini và admin. Dùng khi hỏi hôm nay đã duyệt bao nhiêu xe hoặc thống kê duyệt xe theo ngày; mặc định là hôm nay theo giờ Việt Nam.',
    dateSchema,
    validateDates,
    async (params) => getVehicleApprovalStatistics(params),
  ),

  /* ── 12 new drill-down read tools ──────────────────────────────────── */

  define('get_active_sessions',
    'Danh sách phiên xe đang hoạt động (status=active) với biển số, tầng, người dùng. Dùng khi Admin hỏi "phiên nào đang hoạt động", "xe nào đang trong bãi".',
    { type: 'object', properties: {
      floorId: { type: 'string', description: 'ObjectId tầng, tuỳ chọn.' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 10, tối đa 20).' },
    } },
    passArgs, async (p, actorRole) => readTools.getActiveSessions(p, actorRole)),

  define('search_sessions',
    'Tìm kiếm phiên xe theo biển số, trạng thái, ngày, hoặc userId. Nếu không truyền tham số nào, trả các phiên hôm nay (Asia/Ho_Chi_Minh).',
    { type: 'object', properties: {
      phone: { type: 'string', description: 'Match the phone stored on the session, including unlinked walk-ins. Accept Vietnamese national or +84 format. Do not search accounts instead.' },
      plateMatchMode: { type: 'string', enum: ['exact', 'contains'], description: 'Complete license plates match exactly by default. Use contains only when a partial plate is requested; never add, remove, or guess digits.' },
      plateNumber: { type: 'string', description: 'Biển số xe (có thể nhập một phần).' },
      status: { type: 'string', enum: ['active', 'completed', 'cancelled'], description: 'Trạng thái phiên.' },
      startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD hoặc ISO.' },
      endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD hoặc ISO.' },
      userId: { type: 'string', description: 'ObjectId người dùng.' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 10, tối đa 20).' },
    } },
    passArgs, async (p, actorRole) => readTools.searchSessions(p, actorRole)),

  define('get_session_detail',
    'Chi tiết một phiên xe cụ thể: biển số, trạng thái, tầng, người dùng, thời gian check-in/out, giá.',
    { type: 'object', properties: {
      sessionId: { type: 'string', description: 'ObjectId của phiên cần xem.' },
    }, required: ['sessionId'] },
    passArgs, async (p, actorRole) => readTools.getSessionDetail(p, actorRole)),

  define('search_users',
    'Search Admin accounts by username, email, full name or exact/partial phone. Filters include role, active status and effective VIP/expiry; honor requested sort. The result includes items, total, returned and limit: always use total for counts, never count the limited items array.',
    { type: 'object', properties: {
      page: { type: 'number', description: 'One-based result page.' },
      vip: { type: 'boolean', description: 'Effective VIP membership, respecting expiry.' },
      vipStatus: { type: 'string', enum: ['active', 'expired', 'standard'] },
      sortBy: { type: 'string', enum: ['createdAt', 'username', 'email', 'role', 'status', 'membership.expireAt'] },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
      matchMode: { type: 'string', enum: ['contains', 'exact'] },
      query: { type: 'string', description: 'Username, email, full name or phone, including a partial phone prefix.' },
      role: { type: 'string', enum: ['guest', 'customer', 'staff', 'admin'], description: 'Lọc theo vai trò.' },
      status: { type: 'boolean', description: 'true=active, false=inactive.' },
      limit: { type: 'number', description: 'Số kết quả tối đa cho mảng items (mặc định 10).' },
    } },
    passArgs, async (p, actorRole) => readTools.searchUsers(p, actorRole)),

  define('get_current_user', 'Read the currently authenticated Admin account. Never supply a user ID; identity comes only from the verified server auth context.', emptySchema, noArgs, async (p, role, context) => readTools.getUserDetail({ userId: context.actorId }, role)),

  define('get_user_detail',
    'Thông tin profile/account an toàn của một người dùng cụ thể. Không trả password/token/OTP.',
    { type: 'object', properties: {
      userId: { type: 'string', description: 'ObjectId của người dùng.' },
    }, required: ['userId'] },
    passArgs, async (p, actorRole) => readTools.getUserDetail(p, actorRole)),

  define('search_notification_recipients',
    'Chỉ dùng để chọn người nhận khi Staff chuẩn bị SEND_NOTIFICATION. Tìm tài khoản active theo username/email với cùng quyền của Notification Management. Nếu có nhiều kết quả và không có exactMatchUserId, phải hỏi Staff chọn lại; không được tự đoán.',
    { type: 'object', properties: {
      query: { type: 'string', description: 'Username hoặc email cần tìm, từ 1 đến 100 ký tự.' },
    }, required: ['query'] },
    passArgs, async (p, actorRole) => {
      if (actorRole !== 'staff') throw new Error('Công cụ này chỉ dành cho Staff Notification Management.');
      return readTools.searchNotificationRecipients(p, actorRole);
    }),

  define('search_vehicles',
    'Tìm xe theo biển số, chủ xe (userId), loại xe, hoặc trạng thái duyệt.',
    { type: 'object', properties: {
      plateNumber: { type: 'string', description: 'Biển số xe (có thể nhập một phần).' },
      userId: { type: 'string', description: 'ObjectId chủ xe.' },
      vehicleType: { type: 'string', enum: ['car', 'electric_car'], description: 'Loại xe.' },
      status: { type: 'string', enum: ['pending', 'approved', 'rejected'], description: 'Trạng thái duyệt.' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 10).' },
    } },
    passArgs, async (p, actorRole) => readTools.searchVehicles(p, actorRole)),

  define('search_bookings',
    'Tìm booking theo userId, biển số, trạng thái, khoảng ngày. Hỗ trợ tìm kiếm theo dateType (tạo trong khoảng, bắt đầu trong khoảng, hoặc có hiệu lực giao với khoảng này). Mặc định tìm các booking đang có hiệu lực / overlap.',
    { type: 'object', properties: {
      userId: { type: 'string', description: 'ObjectId người đặt.' },
      plateNumber: { type: 'string', description: 'Biển số xe.' },
      status: { type: 'string', enum: ['PENDING', 'PAID', 'ACTIVE', 'PAUSED', 'EXPIRED', 'COMPLETED', 'CANCELLED'], description: 'Trạng thái booking.' },
      startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD hoặc ISO.' },
      endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD hoặc ISO.' },
      dateType: { type: 'string', enum: ['overlap', 'start', 'create'], description: '"overlap" = đang có hiệu lực / giao nhau với khoảng (ví dụ: "booking hôm nay"). "start" = có lịch bắt đầu trong khoảng. "create" = tạo trong khoảng. Mặc định là "overlap".' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 10, tối đa 20).' },
    } },
    passArgs, async (p, actorRole) => readTools.searchBookings(p, actorRole)),

  define('get_booking_detail',
    'Chi tiết một booking cụ thể: slot, tầng, người đặt, xe, thanh toán, trạng thái.',
    { type: 'object', properties: {
      bookingId: { type: 'string', description: 'ObjectId của booking.' },
    }, required: ['bookingId'] },
    passArgs, async (p, actorRole) => readTools.getBookingDetail(p, actorRole)),

  define('get_parking_floors',
    'Danh sách tất cả tầng đỗ xe với tên và số tầng. Dùng để resolve floorId trước khi xem slot.',
    emptySchema, noArgs, async () => readTools.getParkingFloors()),

  define('get_parking_slots',
    'Danh sách slot ở tầng cụ thể, có thể lọc theo trạng thái (available/occupied/maintenance/booked) hoặc loại slot.',
    { type: 'object', properties: {
      floorId: { type: 'string', description: 'ObjectId tầng.' },
      status: { type: 'string', enum: ['available', 'occupied', 'maintenance', 'booked'], description: 'Trạng thái slot.' },
      slotType: { type: 'string', description: 'Loại slot (hourly, monthly, ...).' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 50).' },
    } },
    passArgs, async (p, actorRole) => readTools.getParkingSlots(p, actorRole)),

  define('search_transactions',
    'Tìm giao dịch ví theo userId, loại (TOP_UP/PAYMENT/REFUND/TRANSFER_OUT/TRANSFER_IN/TRANSFER_FEE), trạng thái, khoảng ngày.',
    { type: 'object', properties: {
      userId: { type: 'string', description: 'ObjectId người dùng.' },
      type: { type: 'string', enum: ['TOP_UP', 'PAYMENT', 'REFUND', 'TRANSFER_OUT', 'TRANSFER_IN', 'TRANSFER_FEE'], description: 'Loại giao dịch.' },
      status: { type: 'string', enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'], description: 'Trạng thái.' },
      startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD hoặc ISO.' },
      endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD hoặc ISO.' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 10, tối đa 20).' },
    } },
    passArgs, async (p, actorRole) => readTools.searchTransactions(p, actorRole)),

  define('get_subscription_members',
    'Read membership subscriptions, including original purchaser and current slot owners. Filter by verified user/package/subscription ID or stored status. With no filters defaults to stored active; use status=all for all records. effectiveStatus separately accounts for elapsed expiry. Never substitute account VIP flags for subscription records.',
    { type: 'object', properties: {
      subscriptionId: { type: 'string', description: 'Exact verified membership/subscription ID.' },
      includeVehicles: { type: 'boolean', description: 'Include vehicles on file via Vehicle.owner for the original purchaser/current slot owners, regardless of subscription status, including cancelled. These are current stored owner relationships, not historical vehicle-use records.' },
      userId: { type: 'string', description: 'ObjectId người dùng.' },
      packageId: { type: 'string', description: 'ObjectId gói vé.' },
      status: { type: 'string', enum: ['pending', 'active', 'expired', 'cancelled', 'failed', 'all'], description: 'Stored subscription status; all includes every status. Inspect effectiveStatus for elapsed expiry.' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 15).' },
    } },
    passArgs, async (p, actorRole) => readTools.getSubscriptionMembers(p, actorRole)),

  define('get_subscription_detail',
    'Read one membership subscription by its verified ID, including package, original purchaser, current slot owners, assigned spaces, dates, amount, payment and effective status. Read-only; not the customer membership/QR endpoint.',
    { type: 'object', properties: { subscriptionId: { type: 'string' }, includeVehicles: { type: 'boolean', description: 'Include stored vehicle-owner relationships, including for cancelled memberships.' } }, required: ['subscriptionId'] },
    passArgs, async (p, actorRole) => readTools.getSubscriptionDetail(p, actorRole)),

  define('search_ticket_packages',
    'Read the complete Ticket Packages catalog by name, description, type or status, including daily/inactive packages. Returns verified details, updatedAt and total count. Read-only; not the public active membership-package subset.',
    { type: 'object', properties: {
      query: { type: 'string', description: 'Literal name, description, or type search text.' },
      type: { type: 'string', enum: ['hourly', 'daily', 'monthly', 'yearly'] },
      isActive: { type: 'boolean' },
      status: { type: 'string', enum: ['active', 'inactive', 'all'] },
      limit: { type: 'number' },
    } }, passArgs, async (p, actorRole) => readTools.searchTicketPackages(p, actorRole)),
  define('get_ticket_package_detail', 'Read exact Ticket Package details by verified ID: name, description, type, price, isActive, updatedAt and renewal configuration. Read-only.',
    { type: 'object', properties: { packageId: { type: 'string' }, name: { type: 'string', description: 'Exact stored package name. Ambiguous names require an ID; never reuse a previous package ID for a newly named package.' } } }, passArgs, async (p) => readTools.getTicketPackageDetail(p)),
  define('get_ticket_package_stats', 'Read inventory statistics for Ticket Packages, with optional search/type/status filters. Counts all matching records, active/inactive totals, counts by type, and latest stored updatedAt. Catalog statistics, not membership subscriptions or revenue.',
    { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ['hourly', 'daily', 'monthly', 'yearly'] }, status: { type: 'string', enum: ['active', 'inactive', 'all'] }, isActive: { type: 'boolean' } } }, passArgs, async (p) => readTools.getTicketPackageStatistics(p)),

  define('search_services',
    'Search stored services by name/description, price and status. Highest-to-lowest uses sortBy=price sortOrder=desc, before the result limit. For catalog averages use get_service_stats.',
    { type: 'object', properties: {
      name: { type: 'string', description: 'Từ khoá tìm kiếm theo tên dịch vụ.' },
      query: { type: 'string', description: 'Literal name or description search.' },
      status: { type: 'string', enum: ['active', 'inactive', 'all'] },
      sortBy: { type: 'string', enum: ['price', 'name', 'createdAt', 'updatedAt', 'timeCost'] },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
      minPrice: { type: 'number', description: 'Giá thấp nhất.' },
      maxPrice: { type: 'number', description: 'Giá cao nhất.' },
      isActive: { type: 'boolean', description: 'Trạng thái hoạt động.' },
      limit: { type: 'number', description: 'Số kết quả tối đa (mặc định 20, tối đa 50).' },
    } },
    passArgs, async (p, actorRole) => readTools.searchServices(p, actorRole)),
  define('get_service_detail', 'Read exact stored service details by verified ID before proposing edits.',
    { type: 'object', properties: { serviceId: { type: 'string' } }, required: ['serviceId'] }, passArgs, p => readTools.getServiceDetail(p)),
  define('get_service_stats', 'Admin Services dashboard KPIs: total, active, inactive and average price over all services including inactive. Optional filters scope all matching records, never just a search page. No booking/revenue weighting.',
    { type: 'object', properties: { query: { type: 'string' }, name: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive', 'all'] }, isActive: { type: 'boolean' }, minPrice: { type: 'number' }, maxPrice: { type: 'number' } } }, passArgs, p => readTools.getServiceStatistics(p)),
];
const STAFF_TOOLS = [
  'get_active_sessions',
  'search_sessions',
  'get_session_detail',
  'search_bookings',
  'get_booking_detail',
  'get_parking_floors',
  'get_parking_slots',
  'get_parking_occupancy',
  'get_subscription_members',
  'search_users',
  'get_user_detail',
  'search_notification_recipients',
  'search_vehicles'
];
const STAFF_ONLY_TOOLS = new Set(['search_notification_recipients']);

function getToolsForRole(role) {
  if (!['admin', 'staff'].includes(role)) return [];
  if (role === 'staff') {
    return tools.filter(t => STAFF_TOOLS.includes(t.name));
  }
  return tools.filter((tool) => !STAFF_ONLY_TOOLS.has(tool.name));
}

const registry = new Map(tools.map((tool) => [tool.name, tool]));
async function execute(name, args, actorRole = 'admin', context = {}) {
  if (!['admin', 'staff'].includes(actorRole)) throw new Error('You do not have permission to use this tool.');
  const tool = registry.get(name);
  if (!tool) throw new Error('Công cụ không nằm trong allowlist.');
  
  if (actorRole === 'staff' && !STAFF_TOOLS.includes(name)) {
    throw new Error('Bạn không có quyền sử dụng công cụ này.');
  }
  if (actorRole !== 'staff' && STAFF_ONLY_TOOLS.has(name)) {
    throw new Error('Công cụ này chỉ dành cho Staff Notification Management.');
  }

  const params = tool.validate(args);
  // Pass actorRole down to the tool run function
  const data = await tool.run(params, actorRole, context);
  return { tool: name, source: name, timestamp: new Date().toISOString(), parameters: params, data };
}
module.exports = { tools, getToolsForRole, execute, validateDates };
