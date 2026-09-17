const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Service name is required'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Service description is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Service price is required'],
      min: [0, 'Price cannot be negative'],
    },
    timeCost: {
      type: Number,
      default: 30,
      min: [1, 'Service time cost must be at least 1 minute'],
      validate: {
        validator: Number.isInteger,
        message: 'Service time cost must be a whole number of minutes',
      },
    },
    imageUrl: {
      type: String,
      default: '',
    },
    cloudinary_id: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Service', serviceSchema);
