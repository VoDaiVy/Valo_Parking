const MAX_CAPTURE_DIM = 720;

/**
 * Capture a single lane ROI from a dual-lane overhead camera video element.
 * - 'exit': left half of frame, rotated 180 deg so exiting plates (top->bottom) are upright.
 * - 'entry': right half of frame, upright.
 * - 'full': entire video frame.
 */
export function captureVideoLaneBase64(video, canvas, lane = 'full') {
  if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

  const vWidth = video.videoWidth;
  const vHeight = video.videoHeight;
  const halfWidth = Math.floor(vWidth / 2);

  let sx = 0;
  let sw = vWidth;
  let rotate180 = false;

  if (lane === 'exit') {
    sx = 0;
    sw = Math.max(1, halfWidth);
    rotate180 = true;
  } else if (lane === 'entry') {
    sx = halfWidth;
    sw = Math.max(1, vWidth - halfWidth);
  }

  const scale = Math.min(1.0, MAX_CAPTURE_DIM / Math.max(sw, vHeight));
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(vHeight * scale));

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (rotate180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  }

  ctx.drawImage(video, sx, 0, sw, vHeight, 0, 0, canvas.width, canvas.height);
  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Crop & orient an uploaded data URL image to the target lane when using a shared dual-lane photo.
 */
export function cropImageDataUrlForLane(dataUrl, lane = 'full') {
  if (!dataUrl || lane === 'full') return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        resolve(dataUrl);
        return;
      }

      const halfWidth = Math.floor(w / 2);
      const sx = lane === 'entry' ? halfWidth : 0;
      const sw = lane === 'entry' ? Math.max(1, w - halfWidth) : Math.max(1, halfWidth);
      const rotate180 = lane === 'exit';

      const scale = Math.min(1.0, MAX_CAPTURE_DIM / Math.max(sw, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(h * scale));

      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (rotate180) {
        ctx.translate(canvas.width, canvas.height);
        ctx.rotate(Math.PI);
      }
      ctx.drawImage(img, sx, 0, sw, h, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

