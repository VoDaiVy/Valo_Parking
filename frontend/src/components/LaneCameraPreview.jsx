import { useEffect, useRef } from 'react';

/**
 * Renders a live cropped (and optionally 180-deg rotated) lane feed from a hidden <video> stream.
 * Keeps each lane's UI isolated to its own half of a shared dual-lane camera.
 */
export default function LaneCameraPreview({
  videoRef,
  lane = 'full',
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
        const halfW = Math.floor(vw / 2);

        let sx = 0;
        let sw = vw;
        if (lane === 'exit') {
          sx = 0;
          sw = Math.max(1, halfW);
        } else if (lane === 'entry') {
          sx = halfW;
          sw = Math.max(1, vw - halfW);
        }

        if (canvas.width !== sw || canvas.height !== vh) {
          canvas.width = sw;
          canvas.height = vh;
        }

        const ctx = canvas.getContext('2d');
        ctx.save();
        if (rotate180) {
          ctx.translate(canvas.width, canvas.height);
          ctx.rotate(Math.PI);
        }
        ctx.drawImage(video, sx, 0, sw, vh, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [videoRef, lane, rotate180, active]);

  return <canvas ref={displayCanvasRef} className={className} />;
}

