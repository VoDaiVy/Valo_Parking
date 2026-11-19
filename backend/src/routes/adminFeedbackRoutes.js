const router = require('express').Router();
const controller = require('../controllers/feedbackController');
router.get('/', controller.list);
router.get('/stats', controller.stats);
router.get('/:id', controller.detail);
router.put('/:id/reply', controller.reply);
router.put('/:id/publication', controller.publication);
module.exports = router;
