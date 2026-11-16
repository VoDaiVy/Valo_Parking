const Service = require('../models/Service');
const { uploadToCloudinary } = require('../middlewares/uploadMiddleware');
const cloudinary = require('../config/cloudinary');

const normalizeService = (service) => {
  const serviceObject = service.toObject ? service.toObject() : service;
  return {
    ...serviceObject,
    timeCost: serviceObject.timeCost ?? 30,
  };
};

// @desc    Create a new service
// @route   POST /api/admin/services
// @access  Private/Admin
exports.createService = async (req, res, next) => {
  try {
    const { name, description, price, timeCost, isActive } = req.body;

    if (!name || !description || price === undefined || price === '') {
      return res.status(400).json({ success: false, message: 'Please provide all required fields' });
    }

    const parsedPrice = Number(price);
    const parsedTimeCost = timeCost === undefined || timeCost === '' ? 30 : Number(timeCost);

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ success: false, message: 'Price must be a valid non-negative number' });
    }

    if (!Number.isInteger(parsedTimeCost) || parsedTimeCost < 1) {
      return res.status(400).json({ success: false, message: 'Time cost must be a whole number of minutes and at least 1 minute' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image for the service' });
    }

    // Upload image to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: 'valo-parking/services',
    });

    const service = await Service.create({
      name,
      description,
      price: parsedPrice,
      timeCost: parsedTimeCost,
      isActive: isActive === 'true' || isActive === true,
      imageUrl: result.secure_url,
      cloudinary_id: result.public_id,
    });

    res.status(201).json({
      success: true,
      data: normalizeService(service),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all active services
// @route   GET /api/services
// @access  Public
exports.getAllServices = async (req, res, next) => {
  try {
    // Admin can fetch all, users only active ones. We handle query params.
    const filter = {};
    // If not admin, or if query explicitly asks for active
    if (req.query.activeOnly !== 'false') {
      filter.isActive = true;
    }

    const services = await Service.find(filter).sort('-createdAt');

    res.status(200).json({
      success: true,
      count: services.length,
      data: services.map(normalizeService),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single service
// @route   GET /api/services/:id
// @access  Public
exports.getServiceById = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    res.status(200).json({
      success: true,
      data: normalizeService(service),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update service
// @route   PUT /api/admin/services/:id
// @access  Private/Admin
exports.updateService = async (req, res, next) => {
  try {
    let service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const updateData = { ...req.body };

    // Parse boolean if it's passed as string from FormData
    if (updateData.isActive !== undefined) {
      updateData.isActive = updateData.isActive === 'true' || updateData.isActive === true;
    }

    if (updateData.price !== undefined) {
      if (updateData.price === '') {
        return res.status(400).json({ success: false, message: 'Price is required' });
      }

      updateData.price = Number(updateData.price);

      if (!Number.isFinite(updateData.price) || updateData.price < 0) {
        return res.status(400).json({ success: false, message: 'Price must be a valid non-negative number' });
      }
    }

    if (updateData.timeCost !== undefined) {
      if (updateData.timeCost === '') {
        return res.status(400).json({ success: false, message: 'Time cost is required' });
      }

      updateData.timeCost = Number(updateData.timeCost);

      if (!Number.isInteger(updateData.timeCost) || updateData.timeCost < 1) {
        return res.status(400).json({ success: false, message: 'Time cost must be a whole number of minutes and at least 1 minute' });
      }
    }

    // If new image is uploaded, handle replacement
    if (req.file) {
      // 1. Delete old image from Cloudinary
      if (service.cloudinary_id) {
        await cloudinary.uploader.destroy(service.cloudinary_id);
      }

      // 2. Upload new image
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'valo-parking/services',
      });

      updateData.imageUrl = result.secure_url;
      updateData.cloudinary_id = result.public_id;
    }

    service = await Service.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      data: normalizeService(service),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete service
// @route   DELETE /api/admin/services/:id
// @access  Private/Admin
exports.deleteService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    // Delete image from Cloudinary
    if (service.cloudinary_id) {
      await cloudinary.uploader.destroy(service.cloudinary_id);
    }

    await service.deleteOne();

    res.status(200).json({
      success: true,
      data: {},
      message: 'Service deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
