import { API_BASE } from './api';

/**
 * Call AI Blurred / Damaged Plate Resolution Service
 * @param {Object} params
 * @param {string} [params.image] - Base64 image
 * @param {string} [params.rawPlate] - Detected OCR string
 * @param {number} [params.confidence] - Initial confidence
 */
export const resolveUnclearPlate = async ({ image, rawPlate, confidence }) => {
  try {
    const response = await fetch(`${API_BASE}/ai/resolve-unclear-plate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image,
        rawPlate,
        confidence,
      }),
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Failed to resolve plate');
    }
    return data.data;
  } catch (error) {
    console.error('[AI Plate Resolution Client] Error:', error);
    throw error;
  }
};
