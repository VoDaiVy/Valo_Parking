const mongoose = require("mongoose");

const parkingFloorSchema = new mongoose.Schema(
  {
    parkingLotID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ParkingLot",
      // required: true, // We will keep it optional for backwards compatibility during dev, but typically should be true
    },
    floorNumber: {
      type: Number,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      default: function() {
        return `Floor ${this.floorNumber}`;
      }
    },
    code: { type: String, trim: true, uppercase: true, unique: true, sparse: true },
    // Missing status on existing records continues to mean active.
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active' },
    acceptsBookings: { type: Boolean, default: true },
    revision: { type: Number, default: 0 },
    layoutVersion: { type: Number, default: 0 },
    draftLayoutData: { type: mongoose.Schema.Types.Mixed, default: undefined },
    publishedAt: { type: Date, default: null },
    bookingMutationAt: { type: Date },
    layoutData: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        width: 1000,
        height: 600,
        elements: []
      }
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ParkingFloor", parkingFloorSchema);
