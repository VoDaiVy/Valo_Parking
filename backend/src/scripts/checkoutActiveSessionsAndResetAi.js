const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function run() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/valoparking';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB successfully!');

    const Session = require('../models/Session');
    const Slot = require('../models/Slot');
    const Violation = require('../models/Violation');
    const SlotAuditLog = require('../models/SlotAuditLog');

    const now = new Date();

    // 1. Tìm tất cả các phiên đỗ đang active
    const activeSessions = await Session.find({ status: 'active' });
    console.log(`\n🚗 Tìm thấy ${activeSessions.length} phiên đỗ xe đang ACTIVE:`);

    let completedSessionsCount = 0;
    for (const session of activeSessions) {
      const checkIn = session.checkInTime || session.createdAt || now;
      const durationHours = Math.max(0.1, (now.getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60));
      
      session.status = 'completed';
      session.checkOutTime = now;
      if (!session.paymentStatus || session.paymentStatus === 'unpaid') {
        session.paymentStatus = 'paid';
      }
      if (!session.totalAmount || session.totalAmount === 0) {
        // Tính tiền tượng trưng hoặc giữ nguyên nếu đã có
        session.totalAmount = session.totalAmount || Math.round(durationHours * 10000);
      }
      session.notes = (session.notes ? session.notes + ' | ' : '') + 'Auto-checked out by system maintenance on user request';
      await session.save();

      console.log(`  ✅ Đã checkout Session ${session._id} - Biển số: ${session.licensePlate} - Ô: ${session.parkingSlot}`);
      completedSessionsCount++;
    }

    // 2. Cập nhật tất cả các Slot: Đưa về available nếu không bảo trì, và xóa sạch aiObservation cảnh báo
    console.log(`\n🧹 Đang dọn dẹp trạng thái ô đỗ và xóa cảnh báo Camera AI...`);
    const slotUpdateResult = await Slot.updateMany(
      {},
      {
        $set: {
          'aiObservation.occupied': false,
          'aiObservation.detectedPlate': null,
          'aiObservation.confidence': 0,
          'aiObservation.isViolation': false,
          'aiObservation.violationType': null,
          'aiObservation.expectedSlot': null,
          'aiObservation.expectedPlate': null,
          'aiObservation.evidenceSnapshot': null,
          'aiObservation.fullSnapshot': null,
          'aiObservation.violationMessage': null,
          'aiObservation.sessionId': null,
          'aiObservation.lastScannedAt': now,
        }
      }
    );
    console.log(`  ✅ Đã reset cảnh báo aiObservation trên ${slotUpdateResult.modifiedCount} ô đỗ!`);

    // Chuyển các slot đang status = 'occupied' về 'available' (trừ ô 'maintenance' và 'booked')
    const occupiedSlotUpdate = await Slot.updateMany(
      { status: 'occupied' },
      { $set: { status: 'available' } }
    );
    console.log(`  ✅ Đã giải phóng ${occupiedSlotUpdate.modifiedCount} ô đỗ từ OCCUPIED về AVAILABLE!`);

    // 3. Đánh dấu các biên bản vi phạm pending thành RESOLVED để xóa cảnh báo trên Web
    const violationUpdate = await Violation.updateMany(
      { status: { $in: ['PENDING', 'pending', 'OPEN', 'open'] } },
      {
        $set: {
          status: 'RESOLVED',
          resolvedAt: now,
          resolutionNotes: 'Auto-resolved during clean-slate maintenance on user request',
        }
      }
    );
    console.log(`  ✅ Đã giải quyết ${violationUpdate.modifiedCount} cảnh báo vi phạm (Violation) sang RESOLVED!`);

    console.log(`\n🎉 HOÀN TẤT THÀNH CÔNG:`);
    console.log(`   - Số phiên checkout: ${completedSessionsCount}`);
    console.log(`   - Số ô đỗ giải phóng: ${occupiedSlotUpdate.modifiedCount}`);
    console.log(`   - Lịch sử đỗ xe (Parking History) vẫn được lưu giữ trọn vẹn với status = completed!`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi khi thực hiện:', err);
    process.exit(1);
  }
}

run();

