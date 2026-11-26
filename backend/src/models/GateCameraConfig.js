const mongoose = require('mongoose');

const gateCameraConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    splitMode: {
      type: Boolean,
      default: true,
    },
    swapLanes: {
      type: Boolean,
      default: false,
    },
    splitRatio: {
      type: Number,
      min: 0.35,
      max: 0.65,
      default: 0.5,
    },
    laneOverlap: {
      type: Number,
      min: 0,
      max: 0.2,
      default: 0.08,
    },
    entryRotation: {
      type: Number,
      enum: [0, 90, 180, 270],
      default: 0,
    },
    exitRotation: {
      type: Number,
      enum: [0, 90, 180, 270],
      default: 180,
    },
    entryRotate180: {
      type: Boolean,
      default: false,
    },
    exitRotate180: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GateCameraConfig', gateCameraConfigSchema);
