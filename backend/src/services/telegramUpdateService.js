const Update = require('../models/TelegramUpdate');

async function persistUpdate(update) {
  if (!Number.isSafeInteger(update?.update_id)) {
    throw Object.assign(new Error('Invalid Telegram update'), { statusCode: 400 });
  }
  // Store only the fields used by the bot, for both webhook and polling transport.
  const input = update.message;
  const payload = input ? { message: {
    text: typeof input.text === 'string' ? input.text.slice(0, 256) : undefined,
    from: { id: Number.isSafeInteger(input.from?.id) ? input.from.id : undefined, username: typeof input.from?.username === 'string' ? input.from.username.slice(0, 64) : undefined },
    chat: { id: Number.isSafeInteger(input.chat?.id) ? input.chat.id : undefined, type: ['private', 'group', 'supergroup', 'channel'].includes(input.chat?.type) ? input.chat.type : undefined },
    ...(input.contact ? { contact: { user_id: Number.isSafeInteger(input.contact.user_id) ? input.contact.user_id : undefined, phone_number: typeof input.contact.phone_number === 'string' ? input.contact.phone_number.slice(0, 32) : undefined } } : {}),
  } } : {};
  try {
    await Update.updateOne({ updateId: update.update_id }, {
      $setOnInsert: { updateId: update.update_id, payload },
    }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

module.exports = { persistUpdate };
