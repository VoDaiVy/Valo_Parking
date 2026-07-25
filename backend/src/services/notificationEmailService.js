const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const NotificationRule = require('../models/NotificationRule');
const User = require('../models/User');
const notificationService = require('./notificationService');

const LOGO_URL =
  'https://res.cloudinary.com/dlelhpfjn/image/upload/v1780239706/valo_parking/assets/xrgz2v4wkd84qyipa9p4.png';

const EVENT_TEMPLATE_MAP = {
  'account.registered': 'REGISTRATION_SUCCESS',
  'wallet.topup_success': 'TOPUP_SUCCESS',
  'wallet.topup_failed': 'TOPUP_FAILED',
  'wallet.payment_success': 'PAYMENT_SUCCESS',
  'booking.created': 'BOOKING_SUCCESS',
  'booking.cancelled': 'BOOKING_CANCELLED',
  'parking.expired': 'PARKING_EXPIRED',
  'system.maintenance': 'SYSTEM_MAINTENANCE',
  'system.update': 'SYSTEM_UPDATE',
};

const PRIORITY_ACCENTS = {
  SUCCESS: '#22c55e',
  INFO: '#60a5fa',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
  SYSTEM: '#FFDF00',
};

const createTransporter = () =>
  nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

const getActionUrl = (eventKey) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  if (eventKey.startsWith('wallet.')) return `${clientUrl}/customer/wallet`;
  if (eventKey.startsWith('booking.')) return `${clientUrl}/customer/booking`;
  if (eventKey.startsWith('parking.')) return `${clientUrl}/customer/history`;
  return clientUrl;
};

const getRuleWithEmailChannel = async (eventKey) => {
  const rule = await NotificationRule.findOne({ eventKey }).lean();
  if (!rule) return null;
  if (!Array.isArray(rule.channels) || !rule.channels.includes('Email')) return null;
  return rule;
};

const getTemplatePayload = (eventKey, templateData = {}) => {
  const templateKey = templateData.templateKey || EVENT_TEMPLATE_MAP[eventKey];
  if (!templateKey) return null;

  const template = notificationService.NOTIFICATION_TEMPLATES[templateKey];
  if (!template) return null;

  return notificationService.fillTemplate(template, templateData);
};

const renderDetails = (templateData = {}) => {
  const rows = [
    ['Amount', templateData.amount ? `${templateData.amount} VND` : null],
    ['Balance', templateData.balance ? `${templateData.balance} VND` : null],
    ['Parking slot', templateData.slotInfo || templateData.slot || null],
    ['Reason', templateData.reason || null],
    ['Booking ID', templateData.bookingId || null],
  ].filter(([, value]) => value);

  if (!rows.length) return '';

  const rowHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding: 10px 0; color: #94a3b8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</td>
          <td style="padding: 10px 0; color: #f1f5f9; font-size: 14px; font-weight: 700; text-align: right;">${value}</td>
        </tr>
      `
    )
    .join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px; border-top: 1px solid #334155; border-bottom: 1px solid #334155;">
      ${rowHtml}
    </table>
  `;
};

const renderEmailHtml = ({ title, content, priority, eventKey, templateData }) => {
  const accent = PRIORITY_ACCENTS[priority] || PRIORITY_ACCENTS.INFO;
  const actionUrl = getActionUrl(eventKey);

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
      <div style="background: #000000; padding: 25px; text-align: center; border-bottom: 3px solid #FFDF00;">
        <img src="${LOGO_URL}" alt="VALO PARKING" style="max-height: 50px; width: auto; margin: 0 auto; display: block;" />
      </div>
      <div style="padding: 32px;">
        <p style="color: ${accent}; margin: 0 0 10px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">${priority || 'INFO'}</p>
        <h2 style="color: #f1f5f9; margin: 0 0 16px 0; font-size: 22px; line-height: 1.35;">${title}</h2>
        <p style="color: #cbd5e1; line-height: 1.7; margin: 0; font-size: 15px;">${content}</p>
        ${renderDetails(templateData)}
        <div style="text-align: center; margin-top: 32px;">
          <a href="${actionUrl}" style="display: inline-block; background-color: #FFDF00; color: #000000; font-weight: bold; text-decoration: none; padding: 13px 28px; border-radius: 999px; letter-spacing: 0.5px; text-transform: uppercase; font-size: 13px;">Open VALO Parking</a>
        </div>
      </div>
      <div style="background-color: #000000; padding: 20px; text-align: center;">
        <p style="color: #666; font-size: 12px; margin: 0;">© 2026 Valo Parking. All rights reserved.</p>
        <p style="color: #444; font-size: 11px; margin: 5px 0 0 0;">Need help? Reply to this email or contact VALO Parking support.</p>
      </div>
    </div>
  `;
};

const sendRenderedEmail = async (user, eventKey, payload, templateData = {}) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
    to: user.email,
    subject: `${payload.title} - VALO Parking`,
    html: renderEmailHtml({
      ...payload,
      eventKey,
      templateData,
    }),
  });
};

const sendNotificationEmail = async (userId, eventKey, templateData = {}) => {
  try {
    if (!userId || !eventKey || !mongoose.Types.ObjectId.isValid(userId)) return;

    const rule = await getRuleWithEmailChannel(eventKey);
    if (!rule) return;

    const payload = getTemplatePayload(eventKey, templateData);
    if (!payload) return;

    const user = await User.findById(userId)
      .select('email isEmailVerified status username role')
      .lean();

    if (!user) {
      console.warn(`[EmailNotif] ${eventKey} warning: user not found ${userId}`);
      return;
    }

    if (!user.email || !user.isEmailVerified || user.status === false) return;

    await sendRenderedEmail(user, eventKey, payload, templateData);
  } catch (err) {
    console.error(`[EmailNotif] ${eventKey} error: ${err.message}`);
  }
};

const sendBroadcastNotificationEmail = async (userIds, eventKey, templateData = {}) => {
  try {
    if (!Array.isArray(userIds) || userIds.length === 0 || !eventKey) return;

    const rule = await getRuleWithEmailChannel(eventKey);
    if (!rule) return;

    const payload = getTemplatePayload(eventKey, templateData);
    if (!payload) return;

    const validUserIds = userIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!validUserIds.length) return;

    const users = await User.find({
      _id: { $in: validUserIds },
      role: 'customer',
      status: true,
      isEmailVerified: true,
      email: { $exists: true, $ne: '' },
    })
      .select('email isEmailVerified status username role')
      .lean();

    await Promise.allSettled(
      users.map((user) =>
        sendRenderedEmail(user, eventKey, payload, templateData).catch((err) => {
          console.error(`[EmailNotif] ${eventKey} error: ${err.message}`);
        })
      )
    );
  } catch (err) {
    console.error(`[EmailNotif] ${eventKey} error: ${err.message}`);
  }
};

const sendCustomEmail = async (userId, payload) => {
  try {
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return;

    const user = await User.findById(userId).lean();
    if (!user || !user.email) return;

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"VALO Parking" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: `${payload.title} - VALO Parking`,
      html: renderEmailHtml({
        title: payload.title,
        content: payload.content,
        priority: payload.priority || 'INFO',
        eventKey: payload.eventKey || 'wallet.refund_success',
        templateData: payload.templateData || {},
      }),
    });
  } catch (err) {
    console.error('[NotificationEmailService] sendCustomEmail error:', err.message);
  }
};

module.exports = {
  sendNotificationEmail,
  sendBroadcastNotificationEmail,
  sendCustomEmail,
};
