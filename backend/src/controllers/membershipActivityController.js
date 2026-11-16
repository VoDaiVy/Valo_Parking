const { validationResult } = require('express-validator');
const service = require('../services/membershipActivityService');

exports.history = async (req, res, next) => {
  try {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ success: false, message: 'Invalid history filters.' });
    const data = await service.history(req.user._id, {
      page: Number(req.query.page || 1), limit: Number(req.query.limit || 15), filter: req.query.filter || 'all',
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
};
