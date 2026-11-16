import { useEffect, useRef } from 'react';
import {
  getSourceRectForSide,
  normalizeRotation,
  renderOrientedCanvas,
  resolveLaneTransform,
} from '../utils/cameraLaneCapture';

/**
 * Renders a live cropped (and optionally 0/90/180/270-deg rotated) lane feed from a hidden <video> stream.
 * Supports explicit `rotate180` / `rotation` or shared `cameraConfig` so Kiosk & Staff Gate stay synchronized.
 */
export default function LaneCameraPreview({
  videoRef,
  lane = 'full',
  rotate180,
  rotation,
  cameraConfig = null,
  active = true,
  className = '',
}) {
  const displayCanvasRef = useRef(null);

  const resolved = cameraConfig
    ? resolveLaneTransform(lane, cameraConfig)
    : {
        side: lane === 'entry' ? 'right' : lane === 'exit' ? 'left' : 'full',
        rotation: rotation != null ? normalizeRotation(rotation, 0) : (rotate180 ? 180 : 0),
        splitRatio: 0.5,
        laneOverlap: 0.08,
      };

  const targetSide = resolved.side;
  const targetRotation = cameraConfig
    ? resolved.rotation
    : (rotation != null ? normalizeRotation(rotation, 0) : (rotate180 ? 180 : 0));
  const { splitRatio, laneOverlap } = resolved;

  useEffect(() => {
    if (!active) return undefined;
    let rafId = null;

    const renderFrame = () => {
      const video = videoRef?.current;
      const canvas = displayCanvasRef.current;

      if (
        video &&
        canvas &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth &&
        video.videoHeight
      ) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const rect = getSourceRectForSide(vw, vh, targetSide, splitRatio, laneOverlap);
        renderOrientedCanvas(canvas, video, rect, rect.sw, rect.sh, targetRotation);
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [videoRef, targetSide, targetRotation, splitRatio, laneOverlap, active]);

  return <canvas ref={displayCanvasRef} className={className} />;
}
