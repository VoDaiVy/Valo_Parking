const { validationResult } = require('express-validator');
const Vehicle = require('../models/Vehicle');
const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');
const { getVehicleCapacity } = require('../services/vehicleCapacityService');

// ─── Cloudinary 3D model auto-discovery ──────────────────────────────────────
const normalizeSlug = (str = '') =>
  str.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

/**
 * Look up a raw .glb file on Cloudinary at path:
 *   vehicles/{normalizedBrand}/{normalizedModel}
 * Returns the secure URL if found, otherwise empty string.
 */
const findVehicleModelUrl = async (brand, model) => {
  try {
    const nb = normalizeSlug(brand);
    const nm = normalizeSlug(model || 'default');
    const resource = await cloudinary.api.resource(
      `vehicles/${nb}/${nm}`,
      { resource_type: 'raw' },
    );
    return resource.secure_url || '';
  } catch {
    return ''; // resource not found → no 3D model yet
  }
};

// ─── Upload base64 image to Cloudinary ───────────────────────────────────────
const uploadBase64ToCloudinary = (base64, folder) =>
  new Promise((resolve, reject) => {
    const data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(data, 'base64');
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url)),
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });


const getMyVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ owner: req.user._id }).sort({
      isDefault: -1,
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      count: vehicles.length,
      data: vehicles,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get a single vehicle by ID
 * @route   GET /api/vehicles/:id
 * @access  Private
 */
const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: 'Vehicle not found' });
    }

    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Add a new vehicle
 * @route   POST /api/vehicles
 * @access  Private
 */
const addVehicle = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { licensePlate, vehicleType, brand, model, color, nickname, isDefault, hexColor, registrationCardImage } =
      req.body;
    const normalizedPlate = normalizeLicensePlate(licensePlate);

    // Check duplicate license plate
    const existing = await Vehicle.findOne({
      licensePlate: normalizedPlate,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'This license plate is already registered',
      });
    }

    // Enforce the account-level vehicle limit before external uploads/lookups.
    const count = await Vehicle.countDocuments({ owner: req.user._id });
    const capacity = getVehicleCapacity(count);
    if (capacity.limitReached) {
      return res.status(409).json({
        success: false,
        code: 'VEHICLE_LIMIT_REACHED',
        message: `Each account can register up to ${capacity.limit} vehicles.`,
        data: capacity,
      });
    }

    // If first vehicle, set as default automatically
    const setDefault = count === 0 ? true : !!isDefault;

    // Upload registration card image to Cloudinary
    let cardImageUrl = '';
    if (registrationCardImage) {
      try {
        cardImageUrl = await uploadBase64ToCloudinary(
          registrationCardImage,
          `registrations/${req.user._id}`,
        );
      } catch (uploadErr) {
        console.error('Registration card upload failed:', uploadErr.message);
        // non-fatal: continue without image
      }
    }

    // Auto-discover 3D model on Cloudinary by brand + model convention
    const modelUrl = await findVehicleModelUrl(brand, model || '');

    const vehicle = await Vehicle.create({
      owner: req.user._id,
      licensePlate: normalizedPlate,
      vehicleType,
      brand,
      model,
      color: color || '',
      nickname,
      isDefault: setDefault,
      hexColor: hexColor || '#ffffff',
      modelUrl,
      registrationCardImage: cardImageUrl,
      status: 'pending',
    });

    res.status(201).json({
      success: true,
      message: 'Vehicle added successfully',
      data: vehicle,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This license plate is already registered',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Update a vehicle
 * @route   PUT /api/vehicles/:id
 * @access  Private
 */
const updateVehicle = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: 'Vehicle not found' });
    }

    const { licensePlate, vehicleType, brand, model, color, nickname, isDefault, hexColor } =
      req.body;

    // Check duplicate license plate (excluding this vehicle)
    if (licensePlate) {
      const normalizedPlate = normalizeLicensePlate(licensePlate);
      const duplicate = await Vehicle.findOne({
        licensePlate: normalizedPlate,
        _id: { $ne: req.params.id },
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: 'This license plate is already registered',
        });
      }
      vehicle.licensePlate = normalizedPlate;
    }

    if (vehicleType !== undefined) vehicle.vehicleType = vehicleType;
    if (brand !== undefined) vehicle.brand = brand;
    if (model !== undefined) vehicle.model = model;
    if (color !== undefined) vehicle.color = color;
    if (nickname !== undefined) vehicle.nickname = nickname;
    if (isDefault !== undefined) vehicle.isDefault = isDefault;
    if (hexColor !== undefined) vehicle.hexColor = hexColor;
    // Re-discover 3D model when brand or model changes
    if (brand !== undefined || model !== undefined) {
      vehicle.modelUrl = await findVehicleModelUrl(
        brand !== undefined ? brand : vehicle.brand,
        model !== undefined ? model : vehicle.model,
      );
    }

    await vehicle.save();

    res.status(200).json({
      success: true,
      message: 'Vehicle updated successfully',
      data: vehicle,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This license plate is already registered',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Delete a vehicle
 * @route   DELETE /api/vehicles/:id
 * @access  Private
 */
const deleteVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOneAndDelete({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: 'Vehicle not found' });
    }

    // If deleted vehicle was default, assign default to the newest remaining vehicle
    if (vehicle.isDefault) {
      const next = await Vehicle.findOne({ owner: req.user._id }).sort({
        createdAt: -1,
      });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Vehicle deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Set a vehicle as default
 * @route   PATCH /api/vehicles/:id/default
 * @access  Private
 */
const setDefaultVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });

    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: 'Vehicle not found' });
    }

    vehicle.isDefault = true;
    await vehicle.save(); // pre-save hook clears other defaults

    res.status(200).json({
      success: true,
      message: 'Default vehicle updated',
      data: vehicle,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getMyVehicles,
  getVehicleById,
  addVehicle,
  updateVehicle,
  deleteVehicle,
  setDefaultVehicle,
};
