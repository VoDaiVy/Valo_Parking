const { body } = require('express-validator');
const { isValidCarLicensePlate, normalizeLicensePlate } = require('../utils/licensePlateUtils');

const VEHICLE_TYPES = ['car', 'electric_car'];

exports.addVehicleValidator = [
  body('licensePlate')
    .customSanitizer(normalizeLicensePlate)
    .notEmpty()
    .withMessage('License plate is required')
    .custom(isValidCarLicensePlate)
    .withMessage('Biển số ô tô không hợp lệ. Ví dụ: 43A12345.'),

  body('vehicleType')
    .notEmpty()
    .withMessage('Vehicle type is required')
    .isIn(VEHICLE_TYPES)
    .withMessage(`Vehicle type must be one of: ${VEHICLE_TYPES.join(', ')}`),

  body('brand')
    .trim()
    .notEmpty()
    .withMessage('Brand is required')
    .isLength({ max: 50 })
    .withMessage('Brand must not exceed 50 characters'),

  body('model')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Model must not exceed 50 characters'),

  body('color')
    .optional()
    .trim()
    .isLength({ max: 30 })
    .withMessage('Color must not exceed 30 characters'),

  body('nickname')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Nickname must not exceed 50 characters'),

  body('isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean'),

  body('hexColor')
    .optional()
    .trim()
    .matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
    .withMessage('Invalid hex color format (e.g. #fff or #ffffff)'),
];

exports.updateVehicleValidator = [
  body('licensePlate')
    .optional()
    .customSanitizer(normalizeLicensePlate)
    .custom(isValidCarLicensePlate)
    .withMessage('Biển số ô tô không hợp lệ. Ví dụ: 43A12345.'),

  body('vehicleType')
    .optional()
    .isIn(VEHICLE_TYPES)
    .withMessage(`Vehicle type must be one of: ${VEHICLE_TYPES.join(', ')}`),

  body('brand')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Brand must not exceed 50 characters'),

  body('model')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Model must not exceed 50 characters'),

  body('color')
    .optional()
    .trim()
    .isLength({ max: 30 })
    .withMessage('Color must not exceed 30 characters'),

  body('nickname')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Nickname must not exceed 50 characters'),

  body('isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean'),

  body('hexColor')
    .optional()
    .trim()
    .matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
    .withMessage('Invalid hex color format (e.g. #fff or #ffffff)'),
];
