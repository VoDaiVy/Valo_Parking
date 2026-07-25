const express = require("express");
const multer = require("multer");
const { protect, authorize } = require("../middlewares/authMiddleware");
const {
  uploadVehicleModel,
  deleteVehicleModel,
  listVehicleModels,
  syncAllVehicleModels,
  getPendingVehicles,
  getApprovedVehicles,
  approveVehicle,
  rejectVehicle,
  searchUsers,
} = require("../controllers/adminController");

const router = express.Router();

// Multer – memory storage (no disk writes), max 50 MB per model file
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".glb")) {
      cb(null, true);
    } else {
      cb(new Error("Only .glb files are allowed"));
    }
  },
});

// All admin routes require a valid JWT
router.use(protect);

// Users (allow both admin and staff)
router.get("/users/search", authorize("admin", "staff"), searchUsers);

// The rest require admin role
router.use(authorize("admin"));

// Policies
router.use("/policies", require("./adminPolicyRoutes"));

// Vehicle 3D models
router.get("/vehicles/models", listVehicleModels);
router.post(
  "/vehicles/upload-model",
  upload.single("file"),
  uploadVehicleModel,
);
router.delete("/vehicles/upload-model", deleteVehicleModel);
router.post("/vehicles/sync-models", syncAllVehicleModels);

// Users
router.get("/users", require("../controllers/adminController").listUsers);
router.put(
  "/users/:id/status",
  require("../controllers/adminController").updateUserStatus,
);
router.put("/users/:id", require("../controllers/adminController").updateUser);

// Vehicle approval
router.get("/vehicles/pending", getPendingVehicles);
router.get("/vehicles/approved", getApprovedVehicles);
router.patch("/vehicles/:id/approve", approveVehicle);
router.delete("/vehicles/:id/reject", rejectVehicle);

// Pricing config management
router.get("/pricing-config", require("../controllers/adminController").getPricingConfig);
router.post("/pricing-config", require("../controllers/adminController").updatePricingConfig);

// Overview Dashboard
router.get("/overview", require("../controllers/adminController").getAdminOverview);

module.exports = router;
