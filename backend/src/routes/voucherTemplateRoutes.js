const express = require('express');
const controller = require('../controllers/voucherTemplateController');

const router = express.Router();
const rewards = require('../controllers/spendRewardController');
router.get('/recipients', rewards.searchRecipients);
router.get('/spending-program', rewards.getProgram);
router.get('/leaderboard', rewards.getLeaderboard);
router.put('/spending-program', rewards.saveProgram);
router.patch('/issued/:voucherId/expiry', rewards.updateVoucherExpiry);
router.post('/:id/distribute', rewards.distribute);

router.get('/', controller.listTemplates);
router.post('/', controller.createTemplate);
router.put('/:id', controller.updateTemplate);
router.patch('/:id/deactivate', controller.deactivateTemplate);
router.delete('/:id', controller.deleteTemplate);

module.exports = router;
