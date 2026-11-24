const router = require('express').Router();
const controller = require('../controllers/feedbackController');

router.get('/', controller.publicList);
module.exports = router;
