import { useEffect, useRef } from 'react';
import {
  resolveLaneTransform,
  getSourceRectForSide,
  renderOrientedCanvas,
  DEFAULT_CAMERA_CONFIG,
} from '../utils/cameraLaneCapture';

/**
 * Renders a live cropped (and optionally rotated 0/90/180/270) lane feed from a video stream.
 * Keeps each lane's UI isolated to its own half of a shared dual-lane camera with full rotation support.
 */
export default function LaneCameraPreview({
  videoRef,
  lane = 'full',
  cameraConfig = DEFAULT_CAMERA_CONFIG,
  rotation: customRotation,
  rotate180 = false,
  active = true,
  className = '',
}) {
  const displayCanvasRef = useRef(null);

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

        const transform = resolveLaneTransform(lane, cameraConfig);
        const rect = getSourceRectForSide(
          vw,
          vh,
          transform.side,
          transform.splitRatio,
          transform.laneOverlap
        );

        const deg =
          customRotation !== undefined
            ? Number(customRotation)
            : rotate180
            ? 180
            : transform.rotation || 0;

        renderOrientedCanvas(canvas, video, rect, rect.sw, rect.sh, deg);
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [videoRef, lane, cameraConfig, customRotation, rotate180, active]);

  return <canvas ref={displayCanvasRef} className={className} />;
}
