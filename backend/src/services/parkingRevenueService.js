const Revenue = require('../models/Revenue');
const PaymentIntent = require('../models/PaymentIntent');

const recordParkingRevenue = async ({ session, amount, paymentMethod, paymentIntentId = null, createdBy = null }) => {
  const normalizedAmount = Number(amount || 0);
  if (!session?._id || normalizedAmount <= 0) return null;

  try {
    const revenue = await Revenue.findOneAndUpdate(
      {
        type: 'PARKING',
        sourceModel: 'Session',
        sourceId: session._id,
      },
      {
        $setOnInsert: {
          type: 'PARKING',
          amount: normalizedAmount,
          sourceId: session._id,
          sourceModel: 'Session',
          userId: session.userId || null,
          createdBy: createdBy || null,
          paymentIntentId: paymentIntentId || null,
          metadata: {
            paymentMethod: paymentMethod || null,
            sessionType: session.type || null,
            licensePlate: session.licensePlate || null,
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (paymentIntentId) {
      await PaymentIntent.findOneAndUpdate(
        { _id: paymentIntentId, purpose: 'KIOSK_CHECKOUT' },
        { $set: { revenueRecordedAt: new Date() } }
      );
    }
    return revenue;
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return Revenue.findOne({ type: 'PARKING', sourceModel: 'Session', sourceId: session._id });
  }
};

module.exports = { recordParkingRevenue };
