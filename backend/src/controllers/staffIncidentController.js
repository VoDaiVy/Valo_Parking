const mongoose = require('mongoose');
const StaffIncident = require('../models/StaffIncident');
const User = require('../models/User');
const { createWithRecipients } = require('../services/notificationService');
const { emitNotification } = require('../sockets/notificationSocket');

const ownerScope = user => user.role === 'staff' ? { reporterId: user._id } : {};
const trim = value => typeof value === 'string' ? value.trim() : '';
const actorName = user => user.username || (user.role === 'admin' ? 'Admin' : 'Staff');
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function incidentTransition(status, role, action) {
  if (status === 'CLOSED') throw error('This report is already closed.', 409);
  if (role === 'admin' && action === 'reply') return 'IN_PROGRESS';
  if (role === 'staff' && status === 'IN_PROGRESS' && action === 'reply') return 'IN_PROGRESS';
  if (role === 'staff' && status === 'IN_PROGRESS' && action === 'close') return 'CLOSED';
  throw error('This action is unavailable at the current report stage.', 409);
}

async function notificationsFor({ incident, user, title, toAdmins, session }) {
  const recipients = toAdmins
    ? await User.find({ role: 'admin', status: true }).select('_id').session(session).lean()
    : [{ _id: incident.reporterId }];
  const ids = recipients.map(item => item._id);
  if (!ids.length) return null;
  const path = `/${toAdmins ? 'admin' : 'staff'}/notifications?incident=${incident._id}`;
  const notification = await createWithRecipients({
    title, content: 'Open the issue report to review the latest update.',
    type: 'SYSTEM', priority: incident.priority, createdBy: user._id,
    targetType: toAdmins ? 'ROLE_BASED' : 'SINGLE_USER',
    targetRoles: [toAdmins ? 'admin' : 'staff'],
    targetUsers: toAdmins ? [] : ids,
    metadata: { eventType: 'STAFF_INCIDENT', incidentId: String(incident._id), deepLink: path },
  }, ids, session);
  return { notification, ids };
}

function publish(req, delivery) {
  const io = req.app.get('io');
  if (!io || !delivery) return;
  for (const id of delivery.ids) {
    emitNotification(io, id, delivery.notification, { notifyAdmins: false, includeAudience: false })
      .catch(err => console.error('[Staff incident] Live notification failed:', err.message));
  }
}

exports.create = async (req, res, next) => {
  try {
    const content = trim(req.body?.content);
    const priority = req.body?.priority || 'WARNING';
    if (!content || content.length > 2000 || !['INFO', 'WARNING', 'ERROR'].includes(priority)) {
      throw error('Enter a report of up to 2,000 characters and select its priority.', 400);
    }
    const result = await mongoose.connection.transaction(async session => {
      const [incident] = await StaffIncident.create([{
        reporterId: req.user._id, reporterName: actorName(req.user), content, priority,
      }], { session });
      const delivery = await notificationsFor({ incident, user: req.user, toAdmins: true, session,
        title: priority === 'ERROR' ? 'Urgent staff issue report' : 'New staff issue report' });
      return { incident, delivery };
    });
    publish(req, result.delivery);
    res.status(201).json({ success: true, data: result.incident, adminNotified: Boolean(result.delivery) });
  } catch (err) { next(err); }
};

exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(1000, parseInt(req.query.page, 10) || 1));
    const status = req.query.status === 'CLOSED' ? 'CLOSED' : { $in: ['OPEN', 'IN_PROGRESS'] };
    const query = { ...ownerScope(req.user), status };
    const records = await StaffIncident.find(query).select('-messages').sort({ priority: 1, updatedAt: -1, _id: -1 })
      .skip((page - 1) * 30).limit(31).lean();
    res.json({ success: true, data: records.slice(0, 30), hasMore: records.length > 30 });
  } catch (err) { next(err); }
};

const incidentQuery = req => {
  if (!mongoose.isValidObjectId(req.params.id)) throw error('Issue report not found.', 404);
  return { _id: req.params.id, ...ownerScope(req.user) };
};

exports.get = async (req, res, next) => {
  try {
    const incident = await StaffIncident.findOne(incidentQuery(req)).lean();
    if (!incident) throw error('Issue report not found.', 404);
    res.json({ success: true, data: incident });
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const query = incidentQuery(req);
    const { action, revision } = req.body || {};
    const content = trim(req.body?.content);
    if (!['reply', 'close'].includes(action) || !Number.isInteger(revision) || revision < 0
      || content.length > 2000 || !content) throw error('Enter your update before submitting.', 400);
    const result = await mongoose.connection.transaction(async session => {
      const current = await StaffIncident.findOne(query).session(session);
      if (!current) throw error('Issue report not found.', 404);
      if (current.revision !== revision) throw error('This report has a new update. Refresh and try again.', 409);
      if (current.messages.length >= 250 && action !== 'close') throw error('This report has reached its message limit.', 409);
      const status = incidentTransition(current.status, req.user.role, action);
      const now = new Date();
      current.status = status;
      current.revision += 1;
      if (status === 'CLOSED') current.closedAt = now;
      current.messages.push({ actorId: req.user._id, actorName: actorName(req.user), role: req.user.role,
        content, closed: status === 'CLOSED', createdAt: now });
      await current.save({ session });
      const toAdmins = req.user.role === 'staff';
      const delivery = await notificationsFor({ incident: current, user: req.user, toAdmins, session,
        title: status === 'CLOSED' ? 'Staff confirmed the issue was resolved'
          : toAdmins ? 'Staff updated an issue report' : 'Admin replied to your issue report' });
      return { incident: current, delivery };
    });
    publish(req, result.delivery);
    res.json({ success: true, data: result.incident });
  } catch (err) { next(err); }
};

exports.incidentTransition = incidentTransition;
