const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const SlotAuditLog = require('../models/SlotAuditLog');
const Slot = require('../models/Slot');
const Session = require('../models/Session');
const cloudinary = require('../config/cloudinary');
const { getViolationLogs, getViolationLogEvidence } = require('../controllers/aiController');
const { persistViolationSnapshots } = require('../utils/violationSnapshotStorage');

const createMockRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const createQueryChain = (result, recorder = {}) => {
  const chain = {
    select(fields) {
      recorder.select = fields;
      return chain;
    },
    sort(spec) {
      recorder.sort = spec;
      return chain;
    },
    skip(n) {
      recorder.skip = n;
      return chain;
    },
    limit(n) {
      recorder.limit = n;
      return chain;
    },
    populate(path, fields) {
      recorder.populates = recorder.populates || [];
      recorder.populates.push({ path, fields });
      return chain;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
  return chain;
};

test('SlotAuditLog defines compound indexes for changeType + createdAt queries', () => {
  const indexes = SlotAuditLog.schema.indexes().map(([spec]) => JSON.stringify(spec));
  assert.ok(indexes.includes(JSON.stringify({ changeType: 1, createdAt: -1 })));
  assert.ok(indexes.includes(JSON.stringify({ floorId: 1, changeType: 1, createdAt: -1 })));
  assert.ok(indexes.includes(JSON.stringify({ changeType: 1, status: 1, createdAt: -1 })));
  assert.ok(indexes.includes(JSON.stringify({ floorId: 1, changeType: 1, status: 1, createdAt: -1 })));
});

test('getViolationLogs excludes snapshot fields, paginates, builds fuzzy plate filter, and computes emptySlotPendingCount', async () => {
  const floorId = new mongoose.Types.ObjectId();
  const slotId1 = new mongoose.Types.ObjectId();
  const slotId2 = new mongoose.Types.ObjectId();
  const logId1 = new mongoose.Types.ObjectId();
  const logId2 = new mongoose.Types.ObjectId();

  const origAuditCount = SlotAuditLog.countDocuments;
  const origAuditFind = SlotAuditLog.find;
  const origAuditAggregate = SlotAuditLog.aggregate;
  const origSlotFind = Slot.find;
  const origSessionFind = Session.find;

  const findRecorders = [];
  const fakeLogs = [
    {
      _id: logId1,
      slotId: slotId1,
      slotCode: 'E1',
      floorId: { _id: floorId, name: 'Floor 2', floorNumber: 2 },
      changeType: 'VIOLATION_DETECTED',
      detectedPlate: '99C-123.45',
      expectedSlot: 'E3',
      status: 'PENDING',
      createdAt: new Date(),
    },
  ];
  const fakePendingCandidates = [
    { _id: logId1, floorId, slotCode: 'E1', detectedPlate: '99C-123.45', status: 'PENDING', sessionId: null },
    { _id: logId2, floorId, slotCode: 'E2', detectedPlate: '30A-999.88', status: 'PENDING', sessionId: null },
  ];

  SlotAuditLog.countDocuments = async () => 12;
  SlotAuditLog.aggregate = async () => [{ _id: '99C-123.45', count: 7 }];
  SlotAuditLog.find = (filter) => {
    const rec = { filter };
    findRecorders.push(rec);
    const isPendingQuery = filter && filter.status === 'PENDING' && !filter.$or;
    return createQueryChain(isPendingQuery ? fakePendingCandidates : fakeLogs, rec);
  };

  Slot.find = (query) => {
    if (query?.slotNumber) {
      return createQueryChain([
        { floorID: floorId, slotNumber: 'E1', status: 'occupied', aiObservation: { occupied: true, detectedPlate: '99C-123.45' } },
        { floorID: floorId, slotNumber: 'E2', status: 'available', aiObservation: { occupied: false, detectedPlate: null } },
      ]);
    }
    return createQueryChain([
      { floorID: { _id: floorId, name: 'Floor 2' }, slotNumber: 'E1', aiObservation: { occupied: true, detectedPlate: '99C-123.45' } },
    ]);
  };

  Session.find = () => createQueryChain([]);

  try {
    const res = createMockRes();
    await getViolationLogs(
      { query: { page: '2', limit: '5', search: '99c12345' } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.total, 12);
    assert.equal(res.body.page, 2);
    assert.equal(res.body.totalPages, 3);
    assert.equal(res.body.hasMore, true);
    assert.equal(res.body.emptySlotPendingCount, 1);
    assert.equal(res.body.data[0].plateViolationCount, 7);

    const mainQuery = findRecorders[0];
    assert.ok(mainQuery.select.includes('-fullSnapshot'));
    assert.ok(mainQuery.select.includes('-evidenceSnapshot'));
    assert.equal(mainQuery.skip, 5);
    assert.equal(mainQuery.limit, 5);
    assert.ok(
      mainQuery.filter.$or.some(
        (cond) => cond.detectedPlate instanceof RegExp && cond.detectedPlate.test('99C-123.45')
      )
    );
  } finally {
    SlotAuditLog.countDocuments = origAuditCount;
    SlotAuditLog.find = origAuditFind;
    SlotAuditLog.aggregate = origAuditAggregate;
    Slot.find = origSlotFind;
    Session.find = origSessionFind;
  }
});

test('getViolationLogEvidence validates ID, handles 404, and lazy-loads snapshots', async () => {
  const validId = new mongoose.Types.ObjectId();
  const origFindById = SlotAuditLog.findById;
  const rec = {};

  SlotAuditLog.findById = (id) => {
    const result =
      String(id) === String(validId)
        ? {
            _id: validId,
            evidenceSnapshot: 'https://res.cloudinary.com/demo/crop.jpg',
            fullSnapshot: 'https://res.cloudinary.com/demo/full.jpg',
          }
        : null;
    return createQueryChain(result, rec);
  };

  try {
    const badRes = createMockRes();
    await getViolationLogEvidence({ params: { id: 'invalid-id' } }, badRes);
    assert.equal(badRes.statusCode, 400);

    const notFoundRes = createMockRes();
    await getViolationLogEvidence({ params: { id: String(new mongoose.Types.ObjectId()) } }, notFoundRes);
    assert.equal(notFoundRes.statusCode, 404);

    const okRes = createMockRes();
    await getViolationLogEvidence({ params: { id: String(validId) } }, okRes);
    assert.equal(okRes.statusCode, 200);
    assert.equal(rec.select, '_id evidenceSnapshot fullSnapshot');
    assert.equal(okRes.body.data.evidenceSnapshot, 'https://res.cloudinary.com/demo/crop.jpg');
    assert.equal(okRes.body.data.fullSnapshot, 'https://res.cloudinary.com/demo/full.jpg');
  } finally {
    SlotAuditLog.findById = origFindById;
  }
});

test('persistViolationSnapshots uploads shared full frame once to Cloudinary and patches logs', async () => {
  const originalEnv = {
    name: process.env.CLOUDINARY_CLOUD_NAME,
    key: process.env.CLOUDINARY_API_KEY,
    secret: process.env.CLOUDINARY_API_SECRET,
  };
  const originalUpload = cloudinary.uploader.upload;

  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';

  const uploadCalls = [];
  cloudinary.uploader.upload = async (_img, options) => {
    uploadCalls.push(options.folder);
    return {
      secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${options.folder}/${options.public_id}.jpg`,
      public_id: `${options.folder}/${options.public_id}`,
    };
  };

  const updates = [];
  const fakeModel = {
    updateOne: async (query, update) => {
      updates.push({ query, update });
    },
  };

  try {
    await persistViolationSnapshots({
      SlotAuditLogModel: fakeModel,
      fullFrameImage: 'data:image/jpeg;base64,FULL_FRAME',
      items: [
        { logId: 'log-1', slotCode: 'E1', cropImage: 'data:image/jpeg;base64,CROP_1' },
        { logId: 'log-2', slotCode: 'E2', cropImage: 'data:image/jpeg;base64,CROP_2' },
      ],
    });

    assert.equal(uploadCalls.filter((f) => f === 'valo-parking/violation-frames').length, 1);
    assert.equal(uploadCalls.filter((f) => f === 'valo-parking/violation-crops').length, 2);
    assert.equal(updates.length, 2);
    assert.ok(updates[0].update.$set.fullSnapshot.startsWith('https://res.cloudinary.com/'));
    assert.ok(updates[0].update.$set.evidenceSnapshot.startsWith('https://res.cloudinary.com/'));
    assert.equal(updates[0].update.$set.fullSnapshot, updates[1].update.$set.fullSnapshot);
  } finally {
    cloudinary.uploader.upload = originalUpload;
    process.env.CLOUDINARY_CLOUD_NAME = originalEnv.name;
    process.env.CLOUDINARY_API_KEY = originalEnv.key;
    process.env.CLOUDINARY_API_SECRET = originalEnv.secret;
  }
});
