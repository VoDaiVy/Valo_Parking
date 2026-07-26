const { body, query } = require('express-validator');

const BOOKING_SHORTFALL_PURPOSE = 'booking_shortfall';
const DEFAULT_MIN_TOP_UP = 10000;
const BOOKING_SHORTFALL_MIN_TOP_UP = 2000; // PayOS / VietQR minimum limit
const MAX_TOP_UP = 10000000;

const getMinimumTopUpAmount = (purpose) =>
  purpose === BOOKING_SHORTFALL_PURPOSE
    ? BOOKING_SHORTFALL_MIN_TOP_UP
    : DEFAULT_MIN_TOP_UP;

/**
 * Validation rules for wallet top-up
 */
const topUpValidator = [
  body('purpose')
    .optional()
    .isIn([BOOKING_SHORTFALL_PURPOSE])
    .withMessage('Invalid top-up purpose'),
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isInt()
    .withMessage('Amount must be a whole number')
    .custom((value, { req }) => {
      const amount = Number(value);
      const minimum = getMinimumTopUpAmount(req.body?.purpose);
      return amount >= minimum && amount <= MAX_TOP_UP;
    })
    .withMessage('Amount is outside the allowed top-up range'),
];

/**
 * Validation rules for transaction history query
 */
const transactionQueryValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  query('type')
    .optional()
    .isIn(['TOP_UP', 'PAYMENT', 'REFUND'])
    .withMessage('Type must be TOP_UP, PAYMENT, or REFUND'),
  query('status')
    .optional()
    .isIn(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'])
    .withMessage('Status must be PENDING, COMPLETED, FAILED, or CANCELLED'),
];

module.exports = {
  BOOKING_SHORTFALL_PURPOSE,
  getMinimumTopUpAmount,
  topUpValidator,
  transactionQueryValidator,
};
