import { API_BASE } from './api';
import { normalizeLicensePlate } from '../utils/licensePlate';

/** Capture a fresh vehicle image, independently of the QR credential. */
export async function captureKioskPlate(expectedPlate) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    await new Promise(resolve => window.setTimeout(resolve, 1200));
    if (!video.videoWidth || !video.videoHeight) throw new Error('Vehicle camera is not ready. Please retry.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 1280);
    canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
    const response = await fetch(`${API_BASE}/ai/scan-plate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageBase64 }) });
    const result = await response.json();
    if (!response.ok || !result.success || !result.plate) throw new Error('Unable to read the vehicle plate. Position the vehicle in the camera area or ask staff for assistance.');
    if (normalizeLicensePlate(result.plate) !== normalizeLicensePlate(expectedPlate)) throw new Error('The vehicle plate does not match this parking ticket.');
    return { licensePlate: result.plate, imageBase64 };
  } finally {
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}
