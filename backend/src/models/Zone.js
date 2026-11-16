const mongoose = require("mongoose");

const zoneSchema = new mongoose.Schema(
  {
    floorID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ParkingFloor",
      required: true,
    },
    zoneName: {
      type: String,
      required: true,
      trim: true,
    },
    layoutElementId: { type: String },
    zoneType: {
      type: String,
      default: "standard",
    },
    totalSlots: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Zone", zoneSchema);
