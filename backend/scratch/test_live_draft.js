const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });
const User = require('./src/models/User');
const Notification = require('./src/models/Notification');
const UserNotification = require('./src/models/UserNotification');
const AIDraft = require('./src/models/AIDraft');
const { chat } = require('./src/services/aiCopilot/chatService');
const { approveDraft } = require('./src/services/aiCopilot/draftService');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const staff = await User.findOne({ role: 'staff' });
  const staffId = staff._id;
  
  const notifCountBefore = await Notification.countDocuments();
  const userNotifCountBefore = await UserNotification.countDocuments();
  
  console.log('Notifications before:', notifCountBefore);
  console.log('UserNotifications before:', userNotifCountBefore);

  console.log('Sending chat request...');
  const chatResponse = await chat(
    [{ role: 'user', content: 'hãy đặt thông báo đến cho vyvo123 là tôi đã hoàn thành xong valo AI ở staff rồi. hãy tạo bản nháp' }],
    staffId,
    'staff'
  );

  console.log('Chat response type:', chatResponse.type);
  if (chatResponse.drafts && chatResponse.drafts.length > 0) {
    const draft = chatResponse.drafts[0];
    console.log('Draft created with ID:', draft._id);
    console.log('Draft payload:', draft.payload);
    
    // Check counts again before approval
    const notifCountAfterDraft = await Notification.countDocuments();
    const userNotifCountAfterDraft = await UserNotification.countDocuments();
    console.log('Notifications after draft:', notifCountAfterDraft);
    console.log('UserNotifications after draft:', userNotifCountAfterDraft);
    
    console.log('Approving draft...');
    const result = await approveDraft(draft._id, staffId, 'staff');
    console.log('Approve result:', result);
    
    // Check counts after approval
    const notifCountAfterApprove = await Notification.countDocuments();
    const userNotifCountAfterApprove = await UserNotification.countDocuments();
    console.log('Notifications after approve:', notifCountAfterApprove);
    console.log('UserNotifications after approve:', userNotifCountAfterApprove);
    
    // Try to approve again
    console.log('Attempting second approval...');
    try {
      await approveDraft(draft._id, staffId, 'staff');
      console.log('Second approval succeeded?! This should not happen.');
    } catch (e) {
      console.log('Second approval failed (as expected):', e.message);
    }
    
    const notifCountFinal = await Notification.countDocuments();
    console.log('Notifications final count:', notifCountFinal);
  } else {
    console.log('No draft created!');
    console.log(chatResponse);
  }
  
  process.exit(0);
}

run().catch(console.error);
