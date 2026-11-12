const MAX_CAPTURE_DIM = 720;
const MOTION_SAMPLE_SIZE = 24;

export const DEFAULT_CAMERA_CONFIG = {
  splitMode: true,
  swapLanes: false,
  splitRatio: 0.5,
  laneOverlap: 0.08,
  entryRotation: 0,
  exitRotation: 180,
  entryRotate180: false,
  exitRotate180: true,
};

export function normalizeRotation(value, fallback = 0) {
  const num = Number(value);
  return [0, 90, 180, 270].includes(num) ? num : fallback;
}

function clampConfigNumber(val, min, max, fallback) {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num * 100) / 100));
}

export function normalizeCameraConfig(raw) {
  const entryRotation = raw?.entryRotation != null
    ? normalizeRotation(raw.entryRotation, DEFAULT_CAMERA_CONFIG.entryRotation)
    : (typeof raw?.entryRotate180 === 'boolean' ? (raw.entryRotate180 ? 180 : 0) : DEFAULT_CAMERA_CONFIG.entryRotation);
  const exitRotation = raw?.exitRotation != null
    ? normalizeRotation(raw.exitRotation, DEFAULT_CAMERA_CONFIG.exitRotation)
    : (typeof raw?.exitRotate180 === 'boolean' ? (raw.exitRotate180 ? 180 : 0) : DEFAULT_CAMERA_CONFIG.exitRotate180);

  return {
    splitMode: typeof raw?.splitMode === 'boolean' ? raw.splitMode : DEFAULT_CAMERA_CONFIG.splitMode,
    swapLanes: typeof raw?.swapLanes === 'boolean' ? raw.swapLanes : DEFAULT_CAMERA_CONFIG.swapLanes,
    splitRatio: clampConfigNumber(raw?.splitRatio, 0.35, 0.65, DEFAULT_CAMERA_CONFIG.splitRatio),
    laneOverlap: clampConfigNumber(raw?.laneOverlap, 0, 0.2, DEFAULT_CAMERA_CONFIG.laneOverlap),
    entryRotation,
    exitRotation,
    entryRotate180: entryRotation === 180,
    exitRotate180: exitRotation === 180,
  };
}

/**
 * Resolve source crop side ('left' | 'right' | 'full'), split boundary/overlap, and rotation (0|90|180|270).
 */
export function resolveLaneTransform(lane = 'full', cameraConfig = DEFAULT_CAMERA_CONFIG) {
  const cfg = normalizeCameraConfig(cameraConfig);
  if (lane !== 'entry' && lane !== 'exit') {
    return {
      side: 'full',
      rotation: 0,
      rotate180: false,
      splitRatio: cfg.splitRatio,
      laneOverlap: cfg.laneOverlap,
    };
  }

  const rotation = lane === 'entry' ? cfg.entryRotation : cfg.exitRotation;
  if (!cfg.splitMode) {
    return {
      side: 'full',
      rotation,
      rotate180: rotation === 180,
      splitRatio: cfg.splitRatio,
      laneOverlap: cfg.laneOverlap,
    };
  }

  let side = lane === 'entry' ? 'right' : 'left';
  if (cfg.swapLanes) {
    side = side === 'left' ? 'right' : 'left';
  }
  return {
    side,
    rotation,
    rotate180: rotation === 180,
    splitRatio: cfg.splitRatio,
    laneOverlap: cfg.laneOverlap,
  };
}

export function getSourceRectForSide(width, height, side = 'full', splitRatio = 0.5, laneOverlap = 0.08) {
  if (side === 'left') {
    const endRatio = Math.min(1, Math.max(0.25, splitRatio + laneOverlap));
    return { sx: 0, sy: 0, sw: Math.max(1, Math.round(width * endRatio)), sh: height };
  }
  if (side === 'right') {
    const startRatio = Math.max(0, Math.min(0.75, splitRatio - laneOverlap));
    const sx = Math.round(width * startRatio);
    return { sx, sy: 0, sw: Math.max(1, width - sx), sh: height };
  }
  return { sx: 0, sy: 0, sw: width, sh: height };
}

/**
 * Render an image/video crop onto target canvas with 0/90/180/270-degree rotation.
 */
export function renderOrientedCanvas(canvas, source, { sx, sy, sw, sh }, outW, outH, rotation = 0) {
  const deg = normalizeRotation(rotation, 0);
  const swapDims = deg === 90 || deg === 270;
  const targetW = swapDims ? outH : outW;
  const targetH = swapDims ? outW : outH;

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (deg === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (deg === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else if (deg === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  ctx.restore();
}

/**
 * Capture a single lane ROI from a dual-lane camera video element using shared config.
 */
export function captureVideoLaneBase64(video, canvas, lane = 'full', cameraConfig = DEFAULT_CAMERA_CONFIG) {
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

  const vWidth = video.videoWidth;
  const vHeight = video.videoHeight;
  const { side, rotation, splitRatio, laneOverlap } = resolveLaneTransform(lane, cameraConfig);
  const rect = getSourceRectForSide(vWidth, vHeight, side, splitRatio, laneOverlap);

  const scale = Math.min(1.0, MAX_CAPTURE_DIM / Math.max(rect.sw, rect.sh));
  const outW = Math.max(1, Math.round(rect.sw * scale));
  const outH = Math.max(1, Math.round(rect.sh * scale));

  renderOrientedCanvas(canvas, video, rect, outW, outH, rotation);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Crop & orient an uploaded data URL image to the target lane when using a shared dual-lane photo.
 */
export function cropImageDataUrlForLane(dataUrl, lane = 'full', cameraConfig = DEFAULT_CAMERA_CONFIG) {
  const { side, rotation, splitRatio, laneOverlap } = resolveLaneTransform(lane, cameraConfig);
  if (!dataUrl || (side === 'full' && rotation === 0)) return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        resolve(dataUrl);
        return;
      }

      const rect = getSourceRectForSide(w, h, side, splitRatio, laneOverlap);
      const scale = Math.min(1.0, MAX_CAPTURE_DIM / Math.max(rect.sw, rect.sh));
      const outW = Math.max(1, Math.round(rect.sw * scale));
      const outH = Math.max(1, Math.round(rect.sh * scale));

      const canvas = document.createElement('canvas');
      renderOrientedCanvas(canvas, img, rect, outW, outH, rotation);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

let motionProbeCanvas = null;

/**
 * Compute a lightweight 24x24 grayscale signature for a lane ROI so empty static frames skip AI calls.
 */
export function computeLaneFrameSignature(video, lane = 'full', cameraConfig = DEFAULT_CAMERA_CONFIG) {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  if (!motionProbeCanvas && typeof document !== 'undefined') {
    motionProbeCanvas = document.createElement('canvas');
    motionProbeCanvas.width = MOTION_SAMPLE_SIZE;
    motionProbeCanvas.height = MOTION_SAMPLE_SIZE;
  }
  if (!motionProbeCanvas) return null;

  const { side, splitRatio, laneOverlap } = resolveLaneTransform(lane, cameraConfig);
  const { sx, sy, sw, sh } = getSourceRectForSide(video.videoWidth, video.videoHeight, side, splitRatio, laneOverlap);
  const ctx = motionProbeCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, MOTION_SAMPLE_SIZE, MOTION_SAMPLE_SIZE);
  const { data } = ctx.getImageData(0, 0, MOTION_SAMPLE_SIZE, MOTION_SAMPLE_SIZE);
  const sig = new Uint8Array(MOTION_SAMPLE_SIZE * MOTION_SAMPLE_SIZE);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    sig[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  }
  return sig;
}

export function hasLaneMotionChanged(prevSig, nextSig, meanDiffThreshold = 8.5) {
  if (!prevSig || !nextSig || prevSig.length !== nextSig.length) return true;
  let totalDiff = 0;
  for (let i = 0; i < nextSig.length; i += 1) {
    totalDiff += Math.abs(nextSig[i] - prevSig[i]);
  }
  return totalDiff / nextSig.length >= meanDiffThreshold;
}
