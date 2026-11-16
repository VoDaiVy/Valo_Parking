const cloudinary = require('../config/cloudinary');

const MAX_FALLBACK_CROP_BYTES = 180 * 1024; // ~180KB cap when Cloudinary is unavailable

const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );

const isRemoteUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const normalizeImageDataUri = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isRemoteUrl(trimmed)) return trimmed;
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(trimmed)) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
};

const uploadSnapshotToCloudinary = async (
  imageData,
  { folder = 'valo-parking/violations', publicId, maxWidth = 1280 } = {}
) => {
  const normalized = normalizeImageDataUri(imageData);
  if (!normalized) return null;
  if (isRemoteUrl(normalized)) {
    return { url: normalized, publicId: null };
  }
  if (!isCloudinaryConfigured()) {
    return null;
  }

  const options = {
    folder,
    resource_type: 'image',
    transformation: [
      {
        width: maxWidth,
        crop: 'limit',
        quality: 'auto:good',
        fetch_format: 'auto',
      },
    ],
  };
  if (publicId) options.public_id = publicId;

  const result = await cloudinary.uploader.upload(normalized, options);
  return {
    url: result.secure_url,
    publicId: result.public_id || null,
  };
};

/**
 * Upload violation crop + shared full-frame image to Cloudinary asynchronously
 * and patch the created SlotAuditLog records without blocking scanParkingSlots.
 */
const persistViolationSnapshots = async ({
  SlotAuditLogModel,
  items = [],
  fullFrameImage = null,
}) => {
  if (!SlotAuditLogModel || !Array.isArray(items) || items.length === 0) return;

  const hasCloudinary = isCloudinaryConfigured();

  if (!hasCloudinary) {
    // Keep only compact crop images if Cloudinary is not configured; never bloat DB with full frames
    const fallbackUpdates = items
      .filter(({ logId, cropImage }) => logId && typeof cropImage === 'string' && cropImage.length <= MAX_FALLBACK_CROP_BYTES)
      .map(({ logId, cropImage }) =>
        SlotAuditLogModel.updateOne(
          { _id: logId },
          { $set: { evidenceSnapshot: cropImage } }
        ).catch(() => {})
      );
    if (fallbackUpdates.length > 0) {
      await Promise.all(fallbackUpdates);
    }
    return;
  }

  const timestamp = Date.now();

  // Upload the full camera frame at most ONCE per scan cycle and share its URL
  let fullUploadPromise = Promise.resolve(null);
  if (fullFrameImage) {
    fullUploadPromise = uploadSnapshotToCloudinary(fullFrameImage, {
      folder: 'valo-parking/violation-frames',
      publicId: `frame-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      maxWidth: 1280,
    }).catch((err) => {
      console.warn('[ViolationSnapshot] Full frame Cloudinary upload failed:', err.message);
      return null;
    });
  }

  const itemUploadPromises = items.map(async ({ logId, slotCode, cropImage }) => {
    if (!logId) return;
    let cropResult = null;
    if (cropImage) {
      try {
        cropResult = await uploadSnapshotToCloudinary(cropImage, {
          folder: 'valo-parking/violation-crops',
          publicId: `slot-${String(slotCode || 'unknown').toLowerCase()}-${timestamp}-${String(logId).slice(-6)}`,
          maxWidth: 720,
        });
      } catch (err) {
        console.warn(`[ViolationSnapshot] Crop Cloudinary upload failed for ${slotCode}:`, err.message);
      }
    }
    return { logId, cropImage, cropResult };
  });

  const [fullResult, cropResults] = await Promise.all([
    fullUploadPromise,
    Promise.all(itemUploadPromises),
  ]);

  const dbUpdatePromises = cropResults
    .filter(Boolean)
    .map(({ logId, cropImage, cropResult }) => {
      const setFields = {};
      if (cropResult?.url) {
        setFields.evidenceSnapshot = cropResult.url;
        if (cropResult.publicId) setFields.evidencePublicId = cropResult.publicId;
      } else if (typeof cropImage === 'string' && cropImage.length <= MAX_FALLBACK_CROP_BYTES) {
        // Fallback for small crop if Cloudinary upload failed transiently
        setFields.evidenceSnapshot = cropImage;
      }

      if (fullResult?.url) {
        setFields.fullSnapshot = fullResult.url;
        if (fullResult.publicId) setFields.fullSnapshotPublicId = fullResult.publicId;
      }

      if (Object.keys(setFields).length === 0) return Promise.resolve();
      return SlotAuditLogModel.updateOne({ _id: logId }, { $set: setFields }).catch((err) => {
        console.warn(`[ViolationSnapshot] Failed to patch SlotAuditLog ${logId}:`, err.message);
      });
    });

  await Promise.all(dbUpdatePromises);
};

const scheduleViolationSnapshotUpload = (params) => {
  setImmediate(() => {
    persistViolationSnapshots(params).catch((err) => {
      console.warn('[ViolationSnapshot] Background upload error:', err.message);
    });
  });
};

module.exports = {
  isCloudinaryConfigured,
  isRemoteUrl,
  normalizeImageDataUri,
  uploadSnapshotToCloudinary,
  persistViolationSnapshots,
  scheduleViolationSnapshotUpload,
};

