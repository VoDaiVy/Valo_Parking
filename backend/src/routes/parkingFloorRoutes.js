const express = require("express");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  getAllFloors,
  createFloor,
  updateFloorInfo,
  updateFloorLayout,
  deleteFloor,
  getFloorSlots,
  getLiveMapData
} = require("../controllers/parkingFloorController");

const router = express.Router();

// Public routes (for Kiosk, mobile and live map)
router.get("/", getAllFloors);
router.get("/live-map", getLiveMapData);
router.get("/:id/slots", getFloorSlots);

// Admin-protected routes
router.use(protect);
router.use(authorize("admin"));

router.post("/", createFloor);
router.patch("/:id", updateFloorInfo);
router.put("/:id/layout", updateFloorLayout);
router.delete("/:id", deleteFloor);

module.exports = router;
