const express = require('express');
const controller = require('../controllers/voucherTemplateController');

const router = express.Router();

router.get('/', controller.listTemplates);
router.post('/', controller.createTemplate);
router.put('/:id', controller.updateTemplate);
router.patch('/:id/deactivate', controller.deactivateTemplate);
router.delete('/:id', controller.deleteTemplate);

module.exports = router;
