const test = require('node:test');
const assert = require('node:assert/strict');
const { roleMessage, adminLanguageInstruction } = require('../services/aiCopilot/adminLanguage');
const { chat } = require('../services/aiCopilot/chatService');

test('English presentation is Admin only and retains data and approval constraints', () => {
  assert.match(adminLanguageInstruction('admin'), /Respond exclusively in English/);
  assert.match(adminLanguageInstruction('admin'), /Preserve source data verbatim/);
  assert.match(adminLanguageInstruction('admin'), /approval rules/);
  assert.equal(adminLanguageInstruction('staff'), '');
  const message = 'VALO AI đang tạm gián đoạn. Vui lòng thử lại sau.';
  assert.match(roleMessage('admin', message), /temporarily unavailable/);
  assert.equal(roleMessage('staff', message), message);
});

test('chat validation and missing-configuration fallback use English for Admin and retain Vietnamese for Staff', async () => {
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const admin = await chat({ message: 'Check occupancy', actorId: 'admin', actorRole: 'admin' });
    const staff = await chat({ message: 'Check occupancy', actorId: 'staff', actorRole: 'staff' });
    assert.match(admin.message, /not configured/);
    assert.match(staff.message, /chưa được cấu hình/);
    await assert.rejects(chat({ message: '', actorRole: 'admin' }), /between 1 and 2,000/);
    await assert.rejects(chat({ message: '', actorRole: 'staff' }), /Câu hỏi/);
  } finally { if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey; }
});
