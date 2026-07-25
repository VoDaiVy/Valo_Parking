const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');

const Notification = require('../models/Notification');
const UserNotification = require('../models/UserNotification');
const User = require('../models/User');
const notificationService = require('../services/notificationService');
const notificationController = require('../controllers/notificationController');
const { createNotificationValidator } = require('../validators/notificationValidator');

const IDS = {
  one: '507f1f77bcf86cd799439011',
  two: '507f1f77bcf86cd799439012',
  three: '507f1f77bcf86cd799439013',
  notification: '507f1f77bcf86cd799439099',
};

const originals = {};
let insertedRecipients;
let userQuery;
let availableUsers;
let rolledBackNotification;
let rolledBackRecipients;

function queryResult(valueFactory) {
  return {
    select() {
      return this;
    },
    async lean() {
      return valueFactory();
    },
  };
}

async function validateCreateBody(body) {
  const req = { body };
  for (const validator of createNotificationValidator) {
    await validator.run(req);
  }
  return validationResult(req);
}

describe('notification request validation', { concurrency: false }, () => {
  test('accepts a system-wide violation notification without targetUsers', async () => {
    const result = await validateCreateBody({
      title: 'Violation notice',
      content: 'System-wide information',
      type: 'VIOLATION',
      targetType: 'ALL_USERS',
    });
    assert.equal(result.isEmpty(), true);
  });

  test('requires one recipient for SINGLE_USER', async () => {
    const result = await validateCreateBody({
      title: 'One',
      content: 'Missing recipient',
      targetType: 'SINGLE_USER',
    });
    assert.equal(result.isEmpty(), false);
  });

  test('requires two distinct recipients for MULTI_USER', async () => {
    const result = await validateCreateBody({
      title: 'Many',
      content: 'Duplicate recipient',
      targetType: 'MULTI_USER',
      targetUsers: [IDS.one, IDS.one],
    });
    assert.match(result.array()[0].msg, /two different recipients/);
  });

  test('rejects selected recipients for ALL_USERS', async () => {
    const result = await validateCreateBody({
      title: 'All',
      content: 'Ambiguous recipients',
      targetType: 'ALL_USERS',
      targetUsers: [IDS.one],
    });
    assert.match(result.array()[0].msg, /must not contain/);
  });

  test('accepts role-based delivery with explicit valid roles', async () => {
    const result = await validateCreateBody({
      title: 'Customers only',
      content: 'Customer announcement',
      targetType: 'ROLE_BASED',
      targetRoles: ['customer'],
    });
    assert.equal(result.isEmpty(), true);
  });

  test('rejects role-based delivery without roles', async () => {
    const result = await validateCreateBody({
      title: 'Missing role',
      content: 'Must not be delivered ambiguously',
      targetType: 'ROLE_BASED',
    });
    assert.equal(result.isEmpty(), false);
    assert.match(result.array()[0].msg, /requires at least one target role/);
  });
});

describe('notification recipient delivery', { concurrency: false }, () => {
  before(() => {
    originals.notificationCreate = Notification.create;
    originals.notificationDelete = Notification.findByIdAndDelete;
    originals.recipientInsert = UserNotification.insertMany;
    originals.recipientDelete = UserNotification.deleteMany;
    originals.userFind = User.find;

    Notification.create = async (data) => ({ _id: IDS.notification, ...data });
    Notification.findByIdAndDelete = async (id) => {
      rolledBackNotification = id;
      return { acknowledged: true };
    };
    UserNotification.deleteMany = async (query) => {
      rolledBackRecipients = query.notificationId;
      return { acknowledged: true };
    };
    UserNotification.insertMany = async (documents) => {
      insertedRecipients.push(...documents);
      return documents;
    };
    User.find = (query) => {
      userQuery = query;
      return queryResult(() => availableUsers.map((_id) => ({ _id })));
    };
  });

  after(() => {
    Notification.create = originals.notificationCreate;
    Notification.findByIdAndDelete = originals.notificationDelete;
    UserNotification.insertMany = originals.recipientInsert;
    UserNotification.deleteMany = originals.recipientDelete;
    User.find = originals.userFind;
  });

  test('sends to exactly one active user', async () => {
    insertedRecipients = [];
    availableUsers = [IDS.one];

    const result = await notificationService.createForUser(
      IDS.one,
      { title: 'One', content: 'Single recipient' },
      null,
      { requireActive: true }
    );

    assert.equal(result.targetType, 'SINGLE_USER');
    assert.equal(result.recipientCount, 1);
    assert.deepEqual(result.targetUsers, [IDS.one]);
    assert.deepEqual(insertedRecipients.map((item) => item.userId), [IDS.one]);
    assert.equal(userQuery.status, true);
  });

  test('deduplicates recipients when sending to multiple users', async () => {
    insertedRecipients = [];
    availableUsers = [IDS.one, IDS.two];

    const result = await notificationService.createForUsers(
      [IDS.one, IDS.two, IDS.one],
      { title: 'Many', content: 'Multiple recipients' },
      null,
      { requireActive: true }
    );

    assert.equal(result.targetType, 'MULTI_USER');
    assert.equal(result.recipientCount, 2);
    assert.deepEqual(result.targetUsers, [IDS.one, IDS.two]);
    assert.deepEqual(insertedRecipients.map((item) => item.userId), [IDS.one, IDS.two]);
  });

  test('can fan out without exposing the full recipient audience on notification payload', async () => {
    insertedRecipients = [];
    availableUsers = [IDS.one, IDS.two];

    const result = await notificationService.createForUsers(
      [IDS.one, IDS.two],
      { title: 'Marketplace', content: 'New membership listing' },
      null,
      { requireActive: true, includeTargetUsers: false }
    );

    assert.equal(result.recipientCount, 2);
    assert.deepEqual(result.targetUsers, []);
    assert.deepEqual(
      insertedRecipients.map((item) => item.userId),
      [IDS.one, IDS.two]
    );
  });

  test('sends system-wide notifications to all active application roles', async () => {
    insertedRecipients = [];
    availableUsers = [IDS.one, IDS.two, IDS.three];

    const result = await notificationService.createForAllUsers({
      title: 'System',
      content: 'All active users',
    });

    assert.equal(result.notification.targetType, 'ALL_USERS');
    assert.equal(result.notification.recipientCount, 3);
    assert.deepEqual(result.userIds, [IDS.one, IDS.two, IDS.three]);
    assert.deepEqual(userQuery, {
      status: true,
      role: { $in: ['customer', 'staff', 'admin'] },
    });
    assert.equal(insertedRecipients.length, 3);
  });

  test('sends role-based notifications only to users resolved from selected roles', async () => {
    insertedRecipients = [];
    availableUsers = [IDS.one, IDS.two];

    const result = await notificationService.createForRole(
      ['staff'],
      { title: 'Staff only', content: 'Internal staff notice' }
    );

    assert.deepEqual(userQuery, {
      status: true,
      role: { $in: ['staff'] },
    });
    assert.equal(result.notification.targetType, 'ROLE_BASED');
    assert.deepEqual(result.notification.targetRoles, ['staff']);
    assert.deepEqual(result.userIds, [IDS.one, IDS.two]);
    assert.deepEqual(
      insertedRecipients.map((item) => item.userId),
      [IDS.one, IDS.two]
    );
  });

  test('rejects missing or inactive selected recipients before creating delivery rows', async () => {
    insertedRecipients = [];
    availableUsers = [IDS.one];

    await assert.rejects(
      notificationService.createForUsers(
        [IDS.one, IDS.two],
        { title: 'Invalid', content: 'Unavailable recipient' },
        null,
        { requireActive: true }
      ),
      /does not exist or is inactive/
    );
    assert.equal(insertedRecipients.length, 0);
  });

  test('rejects malformed recipient IDs', async () => {
    insertedRecipients = [];
    availableUsers = [];

    await assert.rejects(
      notificationService.createForUser('not-an-object-id', {
        title: 'Invalid',
        content: 'Malformed recipient',
      }),
      /Invalid recipient ID/
    );
    assert.equal(insertedRecipients.length, 0);
  });

  test('rolls back the notification when recipient delivery fails', async () => {
    insertedRecipients = [];
    availableUsers = [IDS.one];
    rolledBackNotification = null;
    rolledBackRecipients = null;
    UserNotification.insertMany = async () => {
      throw new Error('simulated delivery failure');
    };

    await assert.rejects(
      notificationService.createForUser(IDS.one, {
        title: 'Rollback',
        content: 'Must not leave an orphan notification',
      }),
      /simulated delivery failure/
    );

    assert.equal(rolledBackNotification, IDS.notification);
    assert.equal(rolledBackRecipients, IDS.notification);

    UserNotification.insertMany = async (documents) => {
      insertedRecipients.push(...documents);
      return documents;
    };
  });
});

describe('authenticated notification context', { concurrency: false }, () => {
  const originalGetUserNotifications = notificationService.getUserNotifications;

  after(() => {
    notificationService.getUserNotifications = originalGetUserNotifications;
  });

  test('ignores a spoofed query role and uses the authenticated user role', async () => {
    let capturedFilters;
    notificationService.getUserNotifications = async (_userId, filters) => {
      capturedFilters = filters;
      return {
        notifications: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      };
    };

    const req = {
      query: { contextRole: 'admin' },
      user: { _id: IDS.one, role: 'customer' },
    };
    const responseBody = {};
    const res = {
      statusCode: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        Object.assign(responseBody, body);
        return this;
      },
    };

    await notificationController.getUserNotifications(req, res, (error) => {
      throw error;
    });

    assert.equal(res.statusCode, 200);
    assert.equal(responseBody.success, true);
    assert.equal(capturedFilters.contextRole, 'customer');
  });
});
