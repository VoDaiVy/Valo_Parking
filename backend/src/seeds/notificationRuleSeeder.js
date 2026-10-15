const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load env from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectDB = require('../config/db');
const NotificationRule = require('../models/NotificationRule');

const DEFAULT_RULES = [
  // ─── Account ────────────────────────────────────────
  {
    eventKey: 'account.registered',
    group: 'Account',
    name: 'Registration successful',
    description: 'When a user creates a new account.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 30,
  },
  {
    eventKey: 'account.email_verified',
    group: 'Account',
    name: 'Email verified successfully',
    description: 'When a user verifies their email.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 45,
  },
  {
    eventKey: 'account.password_changed',
    group: 'Account',
    name: 'Password changed',
    description: 'Security: notify every password change.',
    priority: 'INFO',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 60,
  },
  {
    eventKey: 'account.locked',
    group: 'Account',
    name: 'Account locked',
    description: 'When an account is locked by an admin.',
    priority: 'ERROR',
    enabled: true,
    channels: ['In-app', 'Email', 'SMS'],
    throttleMinutes: 10,
  },
  {
    eventKey: 'account.unlocked',
    group: 'Account',
    name: 'Account unlocked',
    description: 'When an account is unlocked by an admin.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 10,
  },

  // ─── Wallet ───────────────────────────────────────────────
  {
    eventKey: 'wallet.topup_success',
    group: 'Wallet',
    name: 'Top-up successful',
    description: 'When a wallet top-up succeeds.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 5,
  },
  {
    eventKey: 'wallet.topup_failed',
    group: 'Wallet',
    name: 'Top-up failed',
    description: 'When a top-up transaction fails.',
    priority: 'ERROR',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 5,
  },
  {
    eventKey: 'wallet.payment_success',
    group: 'Wallet',
    name: 'Payment successful',
    description: 'When parking fee payment succeeds.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 5,
  },
  {
    eventKey: 'wallet.payment_failed',
    group: 'Wallet',
    name: 'Payment failed',
    description: 'When payment fails due to insufficient balance.',
    priority: 'ERROR',
    enabled: true,
    channels: ['In-app'],
    throttleMinutes: 5,
  },
  {
    eventKey: 'wallet.refund_success',
    group: 'Wallet',
    name: 'Refund successful',
    description: 'When a wallet refund succeeds.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 10,
  },
  {
    eventKey: 'wallet.low_balance',
    group: 'Wallet',
    name: 'Low balance',
    description: 'When wallet balance is below 30,000 VND.',
    priority: 'WARNING',
    enabled: true,
    channels: ['In-app', 'SMS'],
    throttleMinutes: 60,
  },

  // ─── Parking ────────────────────────────────────────────
  {
    eventKey: 'loyalty.points_earned',
    group: 'Loyalty',
    name: 'Loyalty points earned',
    description: 'When a customer earns loyalty points from a completed booking or paid subscription.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app'],
    throttleMinutes: 0,
  },

  {
    eventKey: 'parking.entry',
    group: 'Parking',
    name: 'Vehicle entry',
    description: 'When a vehicle is recorded entering the parking lot.',
    priority: 'INFO',
    enabled: true,
    channels: ['In-app'],
    throttleMinutes: 5,
  },
  {
    eventKey: 'parking.exit',
    group: 'Parking',
    name: 'Vehicle exit',
    description: 'When a vehicle leaves the parking lot.',
    priority: 'INFO',
    enabled: true,
    channels: ['In-app'],
    throttleMinutes: 5,
  },
  {
    eventKey: 'parking.remaining_30',
    group: 'Parking',
    name: '30 minutes left',
    description: 'Warn when a parking session has 30 minutes left.',
    priority: 'INFO',
    enabled: true,
    channels: ['In-app', 'Push'],
    throttleMinutes: 10,
  },
  {
    eventKey: 'parking.remaining_15',
    group: 'Parking',
    name: '15 minutes left',
    description: 'Warn when a parking session has 15 minutes left.',
    priority: 'WARNING',
    enabled: true,
    channels: ['In-app', 'Push'],
    throttleMinutes: 10,
  },
  {
    eventKey: 'parking.remaining_5',
    group: 'Parking',
    name: '5 minutes left',
    description: 'Urgent warning when a parking session has 5 minutes left.',
    priority: 'WARNING',
    enabled: true,
    channels: ['In-app', 'Push'],
    throttleMinutes: 5,
  },
  {
    eventKey: 'parking.expired',
    group: 'Parking',
    name: 'Parking time expired',
    description: 'The parking session has expired.',
    priority: 'ERROR',
    enabled: true,
    channels: ['In-app', 'Email', 'Push', 'SMS'],
    throttleMinutes: 10,
  },

  // ─── Booking ──────────────────────────────────────────
  {
    eventKey: 'booking.checkin_overdue',
    group: 'Booking',
    name: 'Check-in overdue',
    description: 'When a customer misses the booking check-in time.',
    priority: 'WARNING',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 15,
  },
  {
    eventKey: 'booking.created',
    group: 'Booking',
    name: 'Booking successful',
    description: 'When a new booking is created successfully.',
    priority: 'SUCCESS',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 10,
  },
  {
    eventKey: 'booking.cancelled',
    group: 'Booking',
    name: 'Booking cancelled',
    description: 'When a booking is cancelled.',
    priority: 'WARNING',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 10,
  },

  // ─── System ─────────────────────────────────────────
  {
    eventKey: 'system.maintenance',
    group: 'System',
    name: 'System maintenance',
    description: 'System maintenance notice for all users.',
    priority: 'SYSTEM',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 60,
  },
  {
    eventKey: 'system.update',
    group: 'System',
    name: 'Version update',
    description: 'New version notice.',
    priority: 'INFO',
    enabled: true,
    channels: ['In-app', 'Email'],
    throttleMinutes: 120,
  },
];

async function seedRules() {
  try {
    console.log('🌱 Seeding notification rules...');

    for (const rule of DEFAULT_RULES) {
      await NotificationRule.findOneAndUpdate(
        { eventKey: rule.eventKey },
        { $setOnInsert: rule },
        { upsert: true, new: true }
      );
    }

    const count = await NotificationRule.countDocuments();
    console.log(`✅ Notification rules seeded. Total rules: ${count}`);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    throw err;
  }
}

// Allow running directly: node src/seeds/notificationRuleSeeder.js
if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await seedRules();
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  })();
}

module.exports = { seedRules, DEFAULT_RULES };
