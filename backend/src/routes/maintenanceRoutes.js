const express = require("express");
const router = express.Router();
const maintenanceController = require("../controllers/maintenanceController");
const { protect, authorize } = require("../middlewares/authMiddleware");

// Start maintenance
router.post("/start", protect, authorize("admin", "manager", "staff"), maintenanceController.startMaintenance);

// End maintenance
router.post("/end", protect, authorize("admin", "manager", "staff"), maintenanceController.endMaintenance);

module.exports = router;
