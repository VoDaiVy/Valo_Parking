const axios = require('axios');
const FormData = require('form-data');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

const isLikelyVietnamesePlate = (plate = '') => {
  const clean = normalizeLicensePlate(plate);
  return (
    /^\d{2}[A-Z]{1,2}\d{4,5}$/.test(clean) ||
    /^\d{2}[A-Z]\d\d{4,5}$/.test(clean)
  );
};

const extractRetryDelaySeconds = (detail = '') => {
  const match = String(detail).match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  return Math.max(1, Math.ceil(Number(match[1])));
};

const isQuotaError = (error) => {
  const status = error?.status || error?.response?.status || error?.cause?.status;
  const detail = error?.message || '';
  return status === 429 || /quota exceeded|too many requests|429/i.test(detail);
};

exports.scanPlate = async (req, res, next) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    // Strip data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // -------------------------------------------------------------
    // Use Local Python AI Service (YOLO + EasyOCR)
    // -------------------------------------------------------------
    try {
      console.log('[AI Scan] Attempting Local Python AI for License Plate...');
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const pythonRes = await axios.post(`${aiServiceUrl}/scan`, {
        image: base64Data
      }, {
        timeout: 5000 // 5 seconds timeout
      });

      if (pythonRes.data && pythonRes.data.success) {
        console.log('[AI Scan] Local AI Success:', pythonRes.data.plate);
        return res.status(200).json({ 
          success: true, 
          plate: pythonRes.data.plate, 
          model: 'local_yolo' 
        });
      }
      
      return res.status(200).json({
        success: false,
        message: 'No license plate found in the image by Local AI',
        model: 'local_yolo'
      });

    } catch (localErr) {
      console.error('[AI Scan] Local Python AI failed or not running:', localErr.message);
      return res.status(500).json({
        success: false,
        message: 'Local AI service is offline or failed to process the image.'
      });
    }

  } catch (error) {
    const detail = error?.message || 'Unknown error';
    console.error('ALPR Error:', detail);
    res.status(500).json({ success: false, message: 'Error analyzing the image' });
  }
};

/**
 * @desc    Scan vehicle registration card (vehicle registration card) using Local Python AI or Gemini Vision
 *          Extracts: owner name, brand, model code, license plate
 * @route   POST /api/ai/scan-registration-card
 * @access  Private
 */
const mapColorTextToHex = (colorText) => {
  if (!colorText) return null;
  const text = colorText.toLowerCase();
  if (text.includes('trắng')) return '#f5f5f5';
  if (text.includes('đen')) return '#1a1a1a';
  if (text.includes('bạc')) return '#c0c0c0';
  if (text.includes('xám') || text.includes('ghi')) return '#808080';
  if (text.includes('đỏ')) return '#cc2200';
  if (text.includes('cam')) return '#e65c00';
  if (text.includes('vàng')) return '#f5c400';
  if (text.includes('xanh lam') || text.includes('xanh dương')) return '#1a4fa0';
  if (text.includes('xanh lục') || text.includes('xanh lá')) return '#2d7a2d';
  if (text.includes('nâu')) return '#6b3a1f';
  if (text.includes('tím')) return '#6a0dad';
  if (text.includes('hồng')) return '#e75480';
  if (text.includes('đồng')) return '#b8860b';
  return null;
};

exports.scanRegistrationCard = async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res
        .status(400)
        .json({ success: false, message: 'Image is required' });
    }

    // Strip data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // -------------------------------------------------------------
    // ATTEMPT 1: Google Gemini API (Local AI for Registration Card not ready yet)
    // -------------------------------------------------------------
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Gemini API key is not configured',
      });
    }

    // Detect mime type
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const prompt = `You are reading a Vietnamese vehicle registration card.
Extract ONLY the following fields and return ONLY a valid JSON object with no extra text:
{
  "ownerName": "<Owner name - Owner's full name>",
  "brand": "<Brand - Brand/Manufacturer, e.g. HONDA, TOYOTA, MG>",
  "model": "<Model code / Model code, e.g. WINNER X, VIOS, ZS>",
  "licensePlate": "<Registration plate - License plate number, remove all spaces and dots, e.g. 43D1-89750>",
  "colorText": "<Paint color / Color of the vehicle EXACTLY as written on the card>",
  "hexColor": "<Convert colorText to the closest CSS hex color using this reference table:
    White / pure white / ivory white → #f5f5f5
    Black / glossy black / matte black → #1a1a1a
    Silver / metallic silver / silver → #c0c0c0
    Gray / Gray tro / Gray → #808080
    Dark gray → #4a4a4a
    Red / bright red → #cc2200
    Burgundy / dark red → #8b1a1a
    Orange → #e65c00
    Yellow → #f5c400
    Sand yellow / beige → #c8a86b
    Blue / Blue → #1a4fa0
    Dark blue / Navy blue → #0a1a3a
    Green / Green → #2d7a2d
    Xanh mint → #5fb8a0
    Brown / copper brown → #6b3a1f
    Purple → #6a0dad
    Pink → #e75480
    Bronze yellow / copper → #b8860b
    Golden brown / gold → #c8a84a
    Reddish brown / red brown → #7b2d00
    If colorText does not match any above, pick the nearest color logically.
    Return null ONLY if colorText is also null or completely unreadable.>"
}
If a field is not visible or cannot be read, set it to null.
Do NOT default hexColor to #ffffff — if you cannot determine the color, return null.
Do NOT include any explanation, markdown, or code blocks. Return raw JSON only.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const text = result.response.text().trim();

    // Parse JSON - strip markdown fences if model adds them
    let extracted;
    try {
      const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      extracted = JSON.parse(clean);
      console.log('[AI Scan] Raw text from Gemini:', text);
      console.log('[AI Scan] Parsed:', extracted);
    } catch {
      return res.status(422).json({
        success: false,
        message: 'Could not parse vehicle information from the image',
        raw: text,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        nickname: extracted.ownerName || null,
        brand: extracted.brand || null,
        model: extracted.model || null,
        licensePlate: extracted.licensePlate || null,
        colorText: extracted.colorText || null,
        hexColor: extracted.hexColor || null,
      },
      model: 'gemini'
    });
  } catch (error) {
    const detail = error?.message || 'Unknown error';
    const geminiErr = error?.response?.data || error?.errorDetails || null;
    console.error('Gemini Vision Error:', detail, geminiErr);
    res.status(500).json({
      success: false,
      message: 'Error analyzing the registration card',
      detail,
    });
  }
};
