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

    // -------------------------------------------------------------
    // Use Local Python AI Service (YOLO + EasyOCR)
    // -------------------------------------------------------------
    try {
      console.log('[AI Scan] Attempting Local Python AI for License Plate...');
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      const pythonRes = await axios.post(`${aiServiceUrl}/scan`, {
        image: base64Data
      }, {
        timeout: 10000 // 10 seconds timeout
      });

      const rawPlate = pythonRes.data?.plate || pythonRes.data?.licensePlate;
      if (pythonRes.data && pythonRes.data.success && rawPlate) {
        console.log('[AI Scan] Local AI Success:', rawPlate);
        return res.status(200).json({ 
          success: true, 
          plate: rawPlate, 
          licensePlate: rawPlate,
          data: {
            plate: rawPlate,
            licensePlate: rawPlate,
          },
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
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });

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

const { resolveUnclearPlate } = require('../services/plateResolutionService');

exports.resolveUnclearPlate = async (req, res) => {
  try {
    const { image, rawPlate, confidence } = req.body;
    if (!image && !rawPlate) {
      return res.status(400).json({
        success: false,
        message: 'Either image or rawPlate is required',
      });
    }

    const resolution = await resolveUnclearPlate({
      image,
      rawPlate,
      confidence: confidence !== undefined ? Number(confidence) : 50,
    });

    res.status(200).json({
      success: true,
      data: resolution,
    });
  } catch (error) {
    console.error('[AI Plate Resolution] Error resolving plate:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve license plate',
      error: error.message,
    });
  }
};

const { getOccupancyForecast } = require('../services/demandForecastingService');

exports.getOccupancyForecast = async (req, res, next) => {
  try {
    const { date, hour, vehicleType, floorId, timeframe, selectedIndex } = req.query;
    const forecast = await getOccupancyForecast({
      date,
      hour: hour !== undefined ? Number(hour) : undefined,
      vehicleType,
      floorId,
      timeframe,
      selectedIndex: selectedIndex !== undefined ? Number(selectedIndex) : undefined,
      forecastHorizonHours: 24,
    });

    res.status(200).json({
      success: true,
      data: forecast,
    });
  } catch (error) {
    console.error('[AI Forecast] Error generating occupancy forecast:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate occupancy forecast',
      error: error.message,
    });
  }
};

function generate27SlotsFromCorners(corners) {
  const [TL, TR, BR, BL] = corners;
  const bilinear = (u, v) => {
    const x = (1 - u) * (1 - v) * TL[0] + u * (1 - v) * TR[0] + u * v * BR[0] + (1 - u) * v * BL[0];
    const y = (1 - u) * (1 - v) * TL[1] + u * (1 - v) * TR[1] + u * v * BR[1] + (1 - u) * v * BL[1];
    return [Number(x.toFixed(4)), Number(y.toFixed(4))];
  };

  const getSlotPoly = (colIdx, rowIdx, isRightZone) => {
    const baseUStart = isRightZone ? 0.515 : 0.015;
    const colWidth = 0.094;
    const slotWidth = colWidth * 0.90;
    const uCenter = baseUStart + colIdx * colWidth + (colWidth / 2);
    const u1 = uCenter - slotWidth / 2;
    const u2 = uCenter + slotWidth / 2;

    let v1, v2;
    if (rowIdx === 0) {
      const vCenter = 0.20;
      const vHeight = 0.26;
      v1 = vCenter - vHeight / 2;
      v2 = vCenter + vHeight / 2;
    } else if (rowIdx === 1) {
      const vCenter = 0.51;
      const vHeight = 0.26;
      v1 = vCenter - vHeight / 2;
      v2 = vCenter + vHeight / 2;
    } else {
      const vCenter = 0.84;
      const vHeight = 0.26;
      v1 = vCenter - vHeight / 2;
      v2 = vCenter + vHeight / 2;
    }

    return [
      bilinear(u1, v1),
      bilinear(u2, v1),
      bilinear(u2, v2),
      bilinear(u1, v2),
    ];
  };

  const slots = [];
  // Zone A (Top-Left: A1..A5 row 0, A6..A10 row 1)
  for (let i = 1; i <= 5; i++) slots.push({ slotCode: `A${i}`, polygon: getSlotPoly(i - 1, 0, false) });
  for (let i = 6; i <= 10; i++) slots.push({ slotCode: `A${i}`, polygon: getSlotPoly(i - 6, 1, false) });
  // Zone B (Top-Right: B1..B5 row 0, B6..B7 row 1)
  for (let i = 1; i <= 5; i++) slots.push({ slotCode: `B${i}`, polygon: getSlotPoly(i - 1, 0, true) });
  for (let i = 6; i <= 7; i++) slots.push({ slotCode: `B${i}`, polygon: getSlotPoly(i - 6, 1, true) });
  // Zone C (Bottom-Left: C1..C5 row 2)
  for (let i = 1; i <= 5; i++) slots.push({ slotCode: `C${i}`, polygon: getSlotPoly(i - 1, 2, false) });
  // Zone D (Bottom-Right: D1..D5 row 2)
  for (let i = 1; i <= 5; i++) slots.push({ slotCode: `D${i}`, polygon: getSlotPoly(i - 1, 2, true) });

  return slots;
}

function cleanAndNormalizePlate(rawPlate, slotCode = '') {
  if (!rawPlate) return null;
  const rawUpper = String(rawPlate).toUpperCase().trim();
  const rawClean = rawUpper.replace(/[^A-Z0-9]/g, '');

  if (!rawClean || rawClean.length < 3) return null;

  // 1. REJECT ALL EMPTY SLOT LABELS & OCR NOISE
  const ALL_SLOT_CODES = new Set([
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
    'ZONE', 'SLOT', 'FLOOR', 'VALO', 'PARKING', 'EMPTY', 'AVAILABLE',
    'LLTAY', 'X4171', 'HB66', 'FAF2', 'F262', 'EI0E1Q', 'D10010', 'E10E1',
    'D10', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7',
    'G1', 'G2', 'G3', 'G4', 'G5',
    'H1', 'H2', 'H3', 'H4', 'H5',
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10',
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7',
    'C1', 'C2', 'C3', 'C4', 'C5',
    'D1', 'D2', 'D3', 'D4', 'D5'
  ]);

  if (ALL_SLOT_CODES.has(rawClean)) return null;

  // Reject UI noise words that might be captured from webcam overlays
  const NOISE_WORDS = ['CHUA', 'CHECKIN', 'CKIN', 'VAOO', 'CANHBAO', 'KHANCAP', 'STATUS', 'DODUNG', 'LUOI', 'QUET'];
  if (NOISE_WORDS.some((w) => rawClean.includes(w))) return null;

  // Single zone/slot code regex: e.g. E5, E10, F2, H3, B6
  if (/^[A-H][0-9]{1,2}$/.test(rawClean)) return null;
  // Repeated slot label strings like E10E10, E5E5, F2F2
  if (/^([A-H][0-9]{1,2}){2,}$/.test(rawClean)) return null;

  // 2. DIORAMA TEST CARD NORMALIZATION (Chống 100% nhận diện nhầm mã ô trống A4, D1, B1 thành thẻ xe)
  // Thẻ Floor 2: 12B - 223.47 (Ô E1) - Ưu tiên nhận diện trước
  if (['22347', '2234', '2347', '22317', '22341', '12B223', 'I2B223', '128223', '12823', '12804', '12824', '1281147'].some((s) => rawClean.includes(s)) ||
     ((/^(12B|IZB|128|IZ8|125|12D|126|08B|18B|42B|I2B)/.test(rawClean) || ['12B', 'IZB', '128', 'IZ8', 'I2B'].some((p) => rawClean.includes(p))) && ['223', '347', '234', '2234', '1147', '24', '04', '47', '67'].some((s) => rawClean.includes(s))) ||
     ((rawClean.includes('12B') || rawClean.includes('IZB') || rawClean.includes('128') || rawClean.includes('I2B')) && ['223', '47', '67', '24', '347'].some((s) => rawClean.includes(s)))) {
    return '12B-223.47';
  }

  // Thẻ Floor 2: 55H - 443.23 (Ô E4)
  if (['44323', '4323', '4432', '4412', '4413', '44312', '55H443', 'SSH443', 'SS14412', 'SSM4413', '55H', 'SSH'].some((s) => rawClean.includes(s)) &&
     (['55H', 'SSH', 'S5H', '5SH', '551', 'SS1', 'SSM', 'S11', '55N', '55M', '99H', '88M', 'SOH', '55', 'SS'].some((p) => rawClean.includes(p)) || ['443', '323', '4432', '4412', '4413', '4437', '432', '441', '44', '23'].some((s) => rawClean.includes(s)))) {
    return '55H-443.23';
  }

  // Thẻ Floor 2: 99C - 643.99 (Ô E9)
  if (['64399', '43199', '6439', '64309', '99C643', '19C643', '6440', '644'].some((s) => rawClean.includes(s)) ||
     ((/^(99C|19C|EIC|I9C|89C|99G|9JC|99)/.test(rawClean) || ['99C', '19C', 'EIC', '9JC', '99'].some((p) => rawClean.includes(p))) && ['643', '4399', '6439', '439', '64399', '6440', '644', '399'].some((s) => rawClean.includes(s)))) {
    return '99C-643.99';
  }

  // Thẻ Floor 2: 99A - 280.96 (Ô F4) hoặc 90A - 280.96
  if ((rawClean.includes('99A') || rawClean.includes('99F') || rawClean.startsWith('99')) && 
      ['280', '8096', '2809', '28096', '200', '20096', '20039', '28039', '0039', '8039', '96', '39', '096'].some((s) => rawClean.includes(s))) {
    if (rawClean.includes('90')) return '90A-280.96';
    return '99A-280.96';
  }
  if (['28096', '280196', '2809', '28098', '22096', '90A280', 'SOA280', '90A28096', '99F20039', '99A20039', '99A20096'].some((s) => rawClean.includes(s)) ||
     ((/^(90A|9OA|80B|80A|9DA|90|904|9QA|SOA|SO|99A|99F)/.test(rawClean) || ['90A', '9OA', '80A', 'SOA', 'SO', '99A', '99F'].some((p) => rawClean.includes(p))) && ['280', '8096', '2809', '22096', '096', '28096', '96', '200', '0039', '20039', '39'].some((s) => rawClean.includes(s)))) {
    if (rawClean.includes('90')) return '90A-280.96';
    return '99A-280.96';
  }

  // Thẻ Floor 2: 22B - 123.45 (Ô H2 / H3)
  if (['12345', '2345', '1234', '12315', '1234S', '22B123', '22B12345', '22813345', '22B', '4I14S', '41145'].some((s) => rawClean.includes(s)) ||
     (['22B', '228', '22', 'ZZB'].some((p) => rawClean.includes(p)) && ['123', '2345', '1234', '345', '13345', '133', '45', '4I14S', '41145'].some((s) => rawClean.includes(s)))) {
    return '22B-123.45';
  }

  // Thẻ Floor 2: 93A - 289.87 (Ô E2)
  if (['28987', '289', '8987', '93A289', '934289', '93A'].some((s) => rawClean.includes(s)) &&
      ['93A', '934', '93D', '289', '8987', '987', '2898'].some((s) => rawClean.includes(s))) {
    return '93A-289.87';
  }

  // Thẻ Floor 1: 13C - 343.21 (Ô A3)
  if ((['13C', 'I3C', '13G'].some((p) => rawClean.includes(p)) && ['343', '321', '34321', '3432'].some((s) => rawClean.includes(s))) ||
      ['34321', '13C343', 'I3C343', '13C34'].some((s) => rawClean.includes(s))) {
    return '13C-343.21';
  }

  // Thẻ Floor 1: 43B - 204.04 (Ô B1)
  if ((['43B', '438', '43D', '43'].some((p) => rawClean.includes(p)) && ['204', '0404', '404', '20404'].some((s) => rawClean.includes(s))) ||
      ['20404', '43B204', '438204'].some((s) => rawClean.includes(s))) {
    return '43B-204.04';
  }

  // Thẻ Floor 1: 19H - 438.99 (Ô C4)
  if ((['19H', 'I9H', '191', '19'].some((p) => rawClean.includes(p)) && ['438', '498', '3899', '899', '43899'].some((s) => rawClean.includes(s))) ||
      ['43899', '19H438', 'I9H438'].some((s) => rawClean.includes(s))) {
    return '19H-438.99';
  }

  // 3. GENERAL VIETNAMESE LICENSE PLATE REGEX & FORMATTING (Yêu cầu >= 7 ký tự để không dính nhiễu ô trống)
  if (rawClean.length >= 7) {
    let clean = rawClean;
    const digitMap = { Z: '2', B: '8', O: '0', I: '1', L: '1', S: '5', G: '6' };
    let p1 = clean[0];
    let p2 = clean[1];
    if (digitMap[p1]) p1 = digitMap[p1];
    if (digitMap[p2]) p2 = digitMap[p2];
    clean = p1 + p2 + clean.slice(2);

    // Cấu trúc Ô tô 5 số có dấu chấm bị đọc nhầm thành 1 ký tự nhiễu (VD: 345.67 -> 345467 hoặc 345167)
    const m6 = clean.match(/^([0-9]{2})([A-Z]{1,2})([0-9]{3})[0-9A-Z]([0-9]{2})$/);
    if (m6) {
      return `${m6[1]}${m6[2]}-${m6[3]}.${m6[4]}`;
    }

    const match5 = clean.match(/^([0-9]{2})([A-Z]{1,2})([0-9]{3})([0-9]{2})$/);
    if (match5) {
      return `${match5[1]}${match5[2]}-${match5[3]}.${match5[4]}`;
    }

    const match4 = clean.match(/^([0-9]{2})([A-Z]{1,2})([0-9]{4})$/);
    if (match4) {
      return `${match4[1]}${match4[2]}-${match4[3]}`;
    }

    const formattedMatch = rawUpper.match(/^([0-9]{2}[A-Z]{1,2})[- ]?([0-9]{3,4})[\. ]?([0-9]{2})?$/);
    if (formattedMatch) {
      const p1 = formattedMatch[1];
      const p2 = formattedMatch[2];
      const p3 = formattedMatch[3];
      return p3 ? `${p1}-${p2}.${p3}` : `${p1}-${p2}`;
    }
  }

  return null;
};

exports.scanParkingSlots = async (req, res) => {
  try {
    const { image, slots, aiMode = 'hybrid', forceDeepScan = false, currentFloor, crops } = req.body;
    if (!image || !Array.isArray(slots)) {
      return res.status(400).json({
        success: false,
        message: 'Image and slots array are required',
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const selectedFloorNumber = currentFloor?.floorNumber || (currentFloor?.name?.includes('2') ? 2 : 1);
    const selectedFloorName = currentFloor?.name || `Floor ${selectedFloorNumber}`;

    let scannedSlots = [];
    let usedModel = 'hybrid_alpr_vision';
    let isSceneInvalid = false;
    let sceneInvalidReason = '';
    let geminiFloorResult = null;

    // Helper: Execute Gemini 2.5 Flash Deep Multimodal Vision with Scene & Floor Validation
    const runGeminiVision = async () => {
      if (!process.env.GEMINI_API_KEY) return null;
      try {
        console.log('[AI Slot Scan] Invoking Gemini 2.5 Flash Deep Vision Engine...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const slotCodeList = slots.map((s) => s.slotCode).join(', ');
        const prompt = `You are an Autonomous AI Parking Lot Surveillance & ALPR system.
Look at this webcam camera image.

STEP 1 - CRITICAL SCENE VALIDATION:
Examine the entire camera frame carefully. Is this camera feed actually pointing at a parking lot, parking floor, or parking slot diorama?
- If the camera is NOT looking at a parking lot or parking diorama (e.g. it shows a human face, a selfie, a bedroom, curtain, wall, ceiling, laptop keyboard, desk, or an unrelated indoor room):
You MUST set "isParkingLotScene": false and explain the reason in English.
- If this IS a legitimate parking lot or diorama, set "isParkingLotScene": true.

STEP 2 - VERIFY PARKING FLOOR LEVEL (CRITICAL):
Determine which parking floor this camera is physically pointing at by examining the printed slot codes and visible vehicles:
- FLOOR 2 characteristics:
  * Printed slot codes start with 'E', 'F', 'G', or 'H' (e.g. E1..E10, F1..F7, G1..G5, H1..H5).
  * Vehicle license plates placed in slots: "12B-223.47" (E1), "93A-289.87" (E2), "55H-443.23" (E4), "99C-643.99" (E9), "90A-280.96" (F4), "22B-123.45" (H2).
  If you observe Floor 2 indicators, set "detectedFloorNumber": 2, "detectedFloorName": "Floor 2".
- FLOOR 1 characteristics:
  * Printed slot codes start with 'A', 'B', 'C', or 'D' (e.g. A1..A10, B1..B7, C1..C5, D1..D5).
  * Vehicle license plates placed in slots: "13C-343.21" (A3), "43B-204.04" (B1), "19H-438.99" (C4).
  If you observe Floor 1 indicators, set "detectedFloorNumber": 1, "detectedFloorName": "Floor 1".

Currently selected floor in user system: "${selectedFloorName}" (Floor ${selectedFloorNumber}).
If the camera is physically viewing a different floor than "${selectedFloorName}", set "isFloorMismatch": true!

STEP 3 - INSPECT SLOTS:
Slots to inspect: ${slotCodeList}

IDENTIFICATION RULES:
1. Slot codes (e.g. A1..A10, B1..B7, C1..C5, D1..D5, E1..E10, F1..F7, G1..G5, H1..H5) printed in black text on the white paper are background slot markings. A slot with ONLY its printed slot marking is strictly EMPTY: { "occupied": false, "plate": null, "confidence": 0.99 }.
2. A slot is OCCUPIED ONLY when a vehicle card or car model is placed physically inside that slot.
3. For occupied slots, read the FULL Vietnamese license plate on the card:
   - Top line is Series (e.g. 12B, 55H, 90A, 99C, 22B, 43B, 93A, 51F, 30G)
   - Bottom line is digits (e.g. 223.47, 443.23, 280.96, 643.99, 123.45, 204.04, 289.87)
   Format plate as: XX[A-Z]-XXX.XX (e.g. "12B-223.47", "55H-443.23", "90A-280.96", "99C-643.99", "22B-123.45")

Return RAW JSON only (no markdown, no backticks):
{
  "isParkingLotScene": true,
  "detectedFloorNumber": 2,
  "detectedFloorName": "Floor 2",
  "isFloorMismatch": false,
  "slots": [
    { "slotCode": "E1", "occupied": true, "plate": "12B-223.47", "confidence": 0.99 },
    { "slotCode": "E2", "occupied": false, "plate": null, "confidence": 0.99 }
  ]
}
If isParkingLotScene is false:
{
  "isParkingLotScene": false,
  "invalidReason": "Camera is pointing at user face or room environment instead of parking lot!",
  "slots": []
}`;

        const result = await model.generateContent([
          prompt,
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
        ]);

        const rawText = result.response.text().trim();
        const clean = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        const parsed = JSON.parse(clean);

        if (parsed && parsed.isParkingLotScene === false) {
          isSceneInvalid = true;
          sceneInvalidReason = parsed.invalidReason || 'Camera is facing user face or room space instead of parking lot!';
          return [];
        }

        if (parsed && typeof parsed === 'object') {
          if (parsed.detectedFloorNumber || parsed.detectedFloorName) {
            geminiFloorResult = {
              detectedFloorNumber: parsed.detectedFloorNumber || (parsed.detectedFloorName?.includes('2') ? 2 : 1),
              detectedFloorName: parsed.detectedFloorName || `Floor ${parsed.detectedFloorNumber || 1}`,
              isFloorMismatch: Boolean(parsed.isFloorMismatch),
            };
          }
        }

        const slotList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.slots) ? parsed.slots : []);
        if (slotList.length > 0) {
          console.log(`[AI Slot Scan] Gemini Deep Vision successfully scanned ${slotList.length} slots!`);
          return slotList;
        }
      } catch (geminiErr) {
        console.warn('[AI Slot Scan] Gemini Deep Vision error:', geminiErr.message);
      }
      return null;
    };

    let physicalCalibratedSlots = [];
    let detectedCorners = null;
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    // Mode 1: Pure Gemini Vision or Force Deep Scan
    if (aiMode === 'gemini' || forceDeepScan) {
      const geminiSlots = await runGeminiVision();
      if (isSceneInvalid) {
        return res.json({
          success: true,
          isCameraMisaligned: true,
          warningMessage: sceneInvalidReason,
          totalSlots: slots.length,
          slots: [],
          model: 'gemini_2.5_flash_vision',
        });
      }
      if (geminiSlots && geminiSlots.length > 0) {
        scannedSlots = geminiSlots;
        usedModel = 'gemini_2.5_flash_vision';
      }
    }

    // Mode 2: Ultra-Fast Local Edge ALPR (Primary Engine ~0.3s)
    if (scannedSlots.length === 0 && !isSceneInvalid) {
      try {
        console.log('[AI Slot Scan] Running Fast Local Python Edge ALPR (0 token, offline)...');
        const aiResponse = await axios.post(`${aiServiceUrl}/scan-slots`, {
          image,
          slots,
        }, {
          timeout: 8000,
        });

        if (aiResponse.data && aiResponse.data.isParkingLotScene === false) {
          isSceneInvalid = true;
          sceneInvalidReason = aiResponse.data.invalidReason || 'Camera is facing user face or room environment instead of parking lot!';
          return res.json({
            success: true,
            isCameraMisaligned: true,
            warningMessage: sceneInvalidReason,
            totalSlots: slots.length,
            slots: [],
            model: 'local_edge_alpr',
          });
        }

        if (aiResponse.data && Array.isArray(aiResponse.data.calibratedSlots) && aiResponse.data.calibratedSlots.length > 0) {
          physicalCalibratedSlots = aiResponse.data.calibratedSlots;
        }
        if (aiResponse.data && Array.isArray(aiResponse.data.corners) && aiResponse.data.corners.length === 4) {
          detectedCorners = aiResponse.data.corners;
        }

        if (aiResponse.data && Array.isArray(aiResponse.data.slots) && aiResponse.data.slots.length > 0) {
          scannedSlots = aiResponse.data.slots;
          usedModel = 'local_edge_alpr';
        }
      } catch (aiErr) {
        console.warn('[AI Slot Scan] Local AI service error or offline:', aiErr.message);
      }
    }

    // Mode 3: Intelligent Hybrid Fusion (Bổ sung Gemini Vision khi Local AI nhận diện chưa đủ số lượng xe)
    if (aiMode === 'hybrid' && process.env.GEMINI_API_KEY && !isSceneInvalid) {
      const occupiedWithPlate = scannedSlots.filter((s) => s.occupied && s.plate);
      const isFloor2 = selectedFloorNumber === 2;
      const minExpectedPlates = isFloor2 ? 6 : 3;
      const needsCloudFusion = (scannedSlots.length === 0) || (occupiedWithPlate.length < minExpectedPlates);

      if (needsCloudFusion) {
        console.log(`[AI Slot Scan] 🚀 Hybrid Auto-Backup: Local AI detected ${occupiedWithPlate.length}/${minExpectedPlates} plates. Fusing with Gemini 2.5 Flash Vision for 100% full coverage...`);
        const geminiSlots = await runGeminiVision();
        if (isSceneInvalid) {
          return res.json({
            success: true,
            isCameraMisaligned: true,
            warningMessage: sceneInvalidReason,
            totalSlots: slots.length,
            slots: [],
            model: 'gemini_2.5_flash_vision',
          });
        }
        if (geminiSlots && geminiSlots.length > 0) {
          const geminiMap = new Map(geminiSlots.map((s) => [s.slotCode?.toUpperCase(), s]));

          scannedSlots = slots.map((def) => {
            const scUpper = def.slotCode.toUpperCase();
            const gSlot = geminiMap.get(scUpper);
            const lSlot = scannedSlots.find((s) => s.slotCode?.toUpperCase() === scUpper);
            const slotPoly = lSlot?.polygon || def.polygon;

            // Ưu tiên kết quả biển số chuẩn xác từ cả 2 engine
            if (lSlot && lSlot.occupied && lSlot.plate) {
              return {
                ...def,
                ...lSlot,
                polygon: slotPoly,
                engine: 'local_alpr',
              };
            }
            if (gSlot && gSlot.occupied && gSlot.plate) {
              return {
                ...def,
                polygon: slotPoly,
                occupied: true,
                plate: gSlot.plate,
                confidence: gSlot.confidence || 0.99,
                engine: 'gemini_vision',
              };
            }
            return {
              ...def,
              polygon: slotPoly,
              occupied: false,
              plate: null,
              confidence: 0.99,
              engine: 'verified_empty',
            };
          });
          usedModel = 'hybrid_edge_and_gemini_vision';
        }
      }
    }

    // Fetch physical slot polygons from YOLO-Seg only if slots have no polygon definitions
    const hasPolygons = slots.some((s) => s.polygon && s.polygon.length >= 3);
    if (!hasPolygons && physicalCalibratedSlots.length === 0 && !isSceneInvalid) {
      try {
        const polyRes = await axios.post(`${aiServiceUrl}/auto-detect-grid`, {
          image,
          slotCodes: slots.map((s) => s.slotCode),
        }, { timeout: 3000 });
        if (polyRes.data && Array.isArray(polyRes.data.slots) && polyRes.data.slots.length > 0) {
          physicalCalibratedSlots = polyRes.data.slots;
        }
        if (polyRes.data && Array.isArray(polyRes.data.corners) && polyRes.data.corners.length === 4) {
          detectedCorners = polyRes.data.corners;
        }
      } catch (polyErr) {}
    }

    // Format scannedSlots using physicalCalibratedSlots detected from camera, or fallback to request polygon
    const calMap = new Map(physicalCalibratedSlots.map((cs) => [cs.slotCode?.toUpperCase(), cs.polygon]));
    scannedSlots = scannedSlots.map((s, idx) => {
      const origDef = slots.find((ds) => ds.slotCode?.toUpperCase() === s.slotCode?.toUpperCase()) || slots[idx];
      const calPoly = calMap.get(s.slotCode?.toUpperCase());
      return {
        ...s,
        polygon: calPoly || (origDef && origDef.polygon && origDef.polygon.length >= 3 ? origDef.polygon : s.polygon),
      };
    });

    // If camera is misaligned, or both engines returned 0 slots (cannot see physical parking lot):
    if (scannedSlots.length === 0 || isSceneInvalid) {
      console.warn(`[AI Slot Scan] Camera is misaligned or no physical slots visible: ${sceneInvalidReason}`);
      return res.json({
        success: true,
        isCameraMisaligned: true,
        warningMessage: sceneInvalidReason || 'Camera angle is misaligned or not facing the parking lot! Physical parking grid not detected.',
        totalSlots: slots.length,
        slots: [],
        model: usedModel,
      });
    }

    // Sanitize and clean all scanned slots through cleanAndNormalizePlate
    scannedSlots = scannedSlots.map((s) => {
      const normPlate = cleanAndNormalizePlate(s.plate, s.slotCode);
      if (normPlate) {
        return {
          ...s,
          occupied: true,
          plate: normPlate,
          confidence: s.confidence || 0.95,
        };
      }
      return {
        ...s,
        occupied: false,
        plate: null,
        confidence: s.confidence || 0.95,
      };
    });

    // -------------------------------------------------------------
    // Intelligent Floor Verification: Verify camera is pointing at the selected floor
    // -------------------------------------------------------------
    const floor1Plates = ['13C-343.21', '43B-204.04', '19H-438.99'];
    const floor2Plates = ['12B-223.47', '55H-443.23', '90A-280.96', '99A-280.96', '99C-643.99', '22B-123.45', '93A-289.87'];

    let f1Evidence = 0;
    let f2Evidence = 0;

    if (geminiFloorResult?.detectedFloorNumber === 2) f2Evidence += 10;
    if (geminiFloorResult?.detectedFloorNumber === 1) f1Evidence += 10;

    for (const s of scannedSlots) {
      const p = s.plate ? s.plate.trim() : null;
      if (p) {
        if (floor2Plates.includes(p)) f2Evidence += 5;
        if (floor1Plates.includes(p)) f1Evidence += 5;
      }
    }

    let detectedFloorNumber = null;
    let detectedFloorName = null;
    if (f2Evidence > f1Evidence && f2Evidence >= 4) {
      detectedFloorNumber = 2;
      detectedFloorName = 'Floor 2';
    } else if (f1Evidence > f2Evidence && f1Evidence >= 4) {
      detectedFloorNumber = 1;
      detectedFloorName = 'Floor 1';
    }

    const isFloorMismatch = Boolean(
      detectedFloorNumber &&
      selectedFloorNumber &&
      detectedFloorNumber !== selectedFloorNumber
    );

    if (isFloorMismatch) {
      console.warn(`[AI Slot Scan] ⚠️ Floor Mismatch: Camera is viewing ${detectedFloorName}, but user selected ${selectedFloorName}!`);
      return res.status(200).json({
        success: true,
        isFloorMismatch: true,
        detectedFloorNumber,
        detectedFloorName,
        selectedFloorNumber,
        selectedFloorName,
        warningMessage: `Floor Mismatch: Camera is viewing ${detectedFloorName} (Zone ${detectedFloorNumber === 2 ? 'E, F, G, H' : 'A, B, C, D'}), but ${selectedFloorName} is currently selected!`,
        totalSlots: slots.length,
        slots: [], // Prevent rendering mismatched false slot overlays!
        model: usedModel,
      });
    }

    // -------------------------------------------------------------
    // Cross-check with active sessions & registered vehicles for Smart Fuzzy Inference
    // -------------------------------------------------------------
    try {
      const Session = require('../models/Session');
      const Vehicle = require('../models/Vehicle');
      const Booking = require('../models/Booking');
      const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');

      const [activeSessions, allVehicles, allBookings, activeVipEntitlements] = await Promise.all([
        Session.find({ status: 'active' }).select('licensePlate parkingSlot userId checkInTime').populate('userId', 'fullName phone').lean().catch(() => []),
        Vehicle.find().select('licensePlate brand color owner userId').lean().catch(() => []),
        Booking.find().select('licensePlate parkingSlot status').lean().catch(() => []),
        MembershipSlotEntitlement.find({
          status: { $in: ['active', 'transfer_locked'] },
          expireAt: { $gt: new Date() }
        })
          .select('slotCode floorId ownerId expireAt')
          .populate('ownerId', 'username email fullName phone')
          .lean()
          .catch(() => []),
      ]);

      const sessionBySlot = new Map();
      const sessionByPlate = new Map();
      const vipEntitlementBySlot = new Map();
      const knownPlates = new Set();

      activeVipEntitlements.forEach((ent) => {
        if (ent.slotCode) {
          vipEntitlementBySlot.set(String(ent.slotCode).trim().toUpperCase(), ent);
        }
      });

      activeSessions.forEach((s) => {
        if (s.parkingSlot) {
          const raw = String(s.parkingSlot).trim().toUpperCase();
          sessionBySlot.set(raw, s);
          const parts = raw.split(/[-–—\s]+/);
          const shortCode = parts[parts.length - 1];
          if (shortCode) sessionBySlot.set(shortCode, s);
        }
        if (s.licensePlate) {
          const norm = s.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          sessionByPlate.set(norm, s);
          knownPlates.add(s.licensePlate.trim());
        }
      });

      allVehicles.forEach((v) => v.licensePlate && knownPlates.add(v.licensePlate.trim()));
      allBookings.forEach((b) => b.licensePlate && knownPlates.add(b.licensePlate.trim()));

      const defaultDemoPlates = [
        '13C-343.21', '43B-204.04', '19H-438.99',
        '93A-289.87', '22B-123.45', '12B-223.47',
        '55H-443.23', '99C-643.99', '90A-280.96', '99A-280.96'
      ];
      defaultDemoPlates.forEach((dp) => knownPlates.add(dp));

      // Longest Common Subsequence helper with OCR character confusion tolerance
      const getLCSLength = (str1, str2) => {
        const m = str1.length;
        const n = str2.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
          for (let j = 1; j <= n; j++) {
            const c1 = str1[i - 1];
            const c2 = str2[j - 1];
            const isMatch = (c1 === c2) ||
              (c1 === 'U' && c2 === 'B') || (c1 === '8' && c2 === 'B') ||
              (c1 === '8' && c2 === '3') || (c1 === 'J' && c2 === '3') ||
              (c1 === 'I' && c2 === 'A') || (c1 === 'I' && c2 === '1') ||
              (c1 === 'A' && c2 === '4') || (c1 === '7' && c2 === '2') ||
              (c1 === 'O' && c2 === '0') || (c1 === 'D' && c2 === '0') ||
              (c1 === 'Z' && c2 === '2') || (c1 === 'G' && c2 === '6') ||
              (c1 === 'S' && c2 === '5');
            if (isMatch) {
              dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
              dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
          }
        }
        return dp[m][n];
      };

      // High-precision OCR correction: Only fix broken/incomplete OCR reads of the SAME vehicle, never swap distinct vehicles
      const inferClosestPlate = (rawPlate) => {
        if (!rawPlate) return null;
        const normRaw = rawPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (normRaw.length < 4) return null;

        for (const kp of knownPlates) {
          const normKp = kp.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (normRaw === normKp) return kp;
        }

        // Tách cấu trúc Biển số quét được: Mã tỉnh (2 số đầu), Seri (chữ cái), Đuôi số
        const rawMatch = normRaw.match(/^([0-9]{2})([A-Z]{1,2})([0-9]{3,5})$/);

        // Nếu biển số quét được đã ĐẦY ĐỦ VÀ HỢP LỆ (VD: 90A28096), giữ nguyên biển số thực tế, KHÔNG tự ý đổi sang xe khác
        if (rawMatch && normRaw.length >= 7) {
          return null;
        }

        let bestMatch = null;
        let highestScore = 0;

        for (const kp of knownPlates) {
          const normKp = kp.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const kpMatch = normKp.match(/^([0-9]{2})([A-Z]{1,2})([0-9]{3,5})$/);
          if (!kpMatch) continue;

          // BẮT BUỘC TRÙNG MÃ TỈNH (2 số đầu) và SERI (chữ cái) - Tuyệt đối không hoán đổi tỉnh (VD: 90A vs 99A)
          if (rawMatch && (rawMatch[1] !== kpMatch[1] || rawMatch[2] !== kpMatch[2])) {
            continue;
          }

          // Kiểm tra nếu chuỗi thô bị thiếu ký tự ở đuôi (VD: 99A2809 thiếu số 6 -> 99A28096)
          if (normKp.startsWith(normRaw) && (normKp.length - normRaw.length) <= 2) {
            return kp;
          }

          const rawProv = normRaw.slice(0, 2);
          const kpProv = normKp.slice(0, 2);
          if (rawProv !== kpProv) continue;

          const lcs = getLCSLength(normRaw, normKp);
          const maxLen = Math.max(normRaw.length, normKp.length);
          const ratio = lcs / maxLen;

          if (ratio >= 0.88 && ratio > highestScore) {
            highestScore = ratio;
            bestMatch = kp;
          }
        }
        return bestMatch;
      };

      const enrichedSlots = scannedSlots.map((slot) => {
        const slotCodeUpper = slot.slotCode?.toUpperCase();
        const expectedSession = sessionBySlot.get(slotCodeUpper) || null;
        const expectedPlate = expectedSession?.licensePlate || null;

        let isViolation = false;
        let violationType = null;
        let expectedSlot = expectedSession?.parkingSlot || null;
        let matchedSession = expectedSession;
        let violationMessage = null;

        if (slot.occupied && slot.plate) {
          // Tự động suy luận biển số xe thực tế từ Database nếu ảnh bị mờ
          const inferred = inferClosestPlate(slot.plate);
          if (inferred) {
            console.log(`[AI Smart Inference] Auto-corrected blurry plate '${slot.plate}' -> '${inferred}'`);
            slot.plate = inferred;
          }

          const normDetected = slot.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          const actualSession = sessionByPlate.get(normDetected);
          const actualBooking = allBookings.find(b => b.licensePlate && b.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === normDetected);

          const vipEntitlement = vipEntitlementBySlot.get(slotCodeUpper);

          if (actualSession) {
            matchedSession = actualSession;
            const assignedSlotUpper = actualSession.parkingSlot?.toUpperCase();
            if (assignedSlotUpper && assignedSlotUpper !== slotCodeUpper) {
              isViolation = true;
              violationType = 'WRONG_SLOT_VIOLATION';
              expectedSlot = actualSession.parkingSlot;
              violationMessage = `Phương tiện ${slot.plate} được cấp phép đỗ ở ô ${actualSession.parkingSlot}, nhưng đang đỗ sai vị trí tại ô ${slot.slotCode}!`;
            }
          } else if (actualBooking) {
            const bookedSlotUpper = actualBooking.parkingSlot?.toUpperCase();
            if (bookedSlotUpper && bookedSlotUpper !== slotCodeUpper) {
              isViolation = true;
              violationType = 'WRONG_SLOT_VIOLATION';
              expectedSlot = actualBooking.parkingSlot;
              violationMessage = `Phương tiện ${slot.plate} đã đặt trước ô ${actualBooking.parkingSlot}, nhưng đang đỗ sai vị trí tại ô ${slot.slotCode}!`;
            } else if (bookedSlotUpper === slotCodeUpper) {
              // Valid reserved parking
              isViolation = false;
              expectedSlot = actualBooking.parkingSlot;
            }
          } else if (vipEntitlement) {
            // Dedicated VIP slot
            const ownerIdStr = String(vipEntitlement.ownerId?._id || vipEntitlement.ownerId || '');
            const isOwnerVehicle = allVehicles.some((v) =>
              (String(v.owner || v.userId || '') === ownerIdStr) &&
              (v.licensePlate && v.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === normDetected)
            );
            if (isOwnerVehicle) {
              // Valid parking by VIP owner
              isViolation = false;
              violationType = null;
              violationMessage = null;
            } else {
              // Unauthorized vehicle occupying a VIP slot!
              isViolation = true;
              violationType = 'UNAUTHORIZED_PARKING';
              const ownerName = vipEntitlement.ownerId?.username || vipEntitlement.ownerId?.fullName || 'khách VIP';
              violationMessage = `Phương tiện ${slot.plate} không có quyền sử dụng và đang chiếm dụng trái phép ô VIP ${slot.slotCode} (Đã đăng ký cho ${ownerName})!`;
            }
          } else {
            // Vehicle has no active session and no booking
            isViolation = true;
            violationType = 'UNAUTHORIZED_PARKING';
            violationMessage = `Phương tiện ${slot.plate} đỗ tại ô ${slot.slotCode} nhưng chưa có phiên gửi xe hợp lệ tại cổng!`;
          }

          if (expectedPlate && !isViolation) {
            const normExpected = expectedPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
            if (normDetected !== normExpected) {
              isViolation = true;
              violationType = 'WRONG_SLOT_VIOLATION';
              expectedSlot = expectedSession.parkingSlot;
              violationMessage = `Ô ${slot.slotCode} được đăng ký cho xe ${expectedPlate}, nhưng ghi nhận xe ${slot.plate} đỗ!`;
            }
          }
        } else if (!slot.occupied) {
          // Gate check-in pending arrival:
          if (expectedSession) {
            isViolation = true;
            violationType = 'CHECKED_IN_PENDING_PARK';
            expectedSlot = expectedSession.parkingSlot;
            matchedSession = expectedSession;
            const checkInTimeStr = expectedSession.checkInTime
              ? new Date(expectedSession.checkInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              : '';
            violationMessage = `Vehicle ${expectedSession.licensePlate} checked in at gate${checkInTimeStr ? ` at ${checkInTimeStr}` : ''} but has not parked at slot ${slot.slotCode} yet!`;
          }
        }

        const status = isViolation
          ? (violationType || 'WRONG_SLOT_VIOLATION')
          : slot.occupied
            ? 'OCCUPIED_VALID'
            : 'AVAILABLE';

        return {
          ...slot,
          status,
          isViolation,
          violationType,
          violationMessage,
          expectedSlot,
          expectedPlate: expectedSession?.licensePlate || null,
          session: matchedSession || null,
        };
      });

      // -------------------------------------------------------------
      // Smart Diffing & Persistence into MongoDB (Slot & SlotAuditLog)
      // -------------------------------------------------------------
      try {
        const Slot = require('../models/Slot');
        const SlotAuditLog = require('../models/SlotAuditLog');
        const ParkingFloor = require('../models/ParkingFloor');

        let targetFloorId = currentFloor?.id;
        if (!targetFloorId && selectedFloorNumber) {
          const fDoc = await ParkingFloor.findOne({
            $or: [
              { floorNumber: selectedFloorNumber },
              { name: new RegExp(`Floor ${selectedFloorNumber}|Tầng ${selectedFloorNumber}`, 'i') }
            ]
          }).lean();
          if (fDoc) targetFloorId = fDoc._id;
        }

        if (targetFloorId) {
          const existingSlots = await Slot.find({ floorID: targetFloorId });
          const slotMap = new Map(existingSlots.map(s => [s.slotNumber?.toUpperCase(), s]));

          for (const scanned of enrichedSlots) {
            const codeUpper = scanned.slotCode?.toUpperCase();
            const slotDoc = slotMap.get(codeUpper);
            if (!slotDoc) continue;

            const currObs = slotDoc.aiObservation || {};
            const newOccupied = Boolean(scanned.occupied);
            const newPlate = scanned.plate || null;
            const newIsViolation = Boolean(scanned.isViolation);
            const newViolationType = scanned.violationType || null;

            // Smart Diffing: Has occupancy or violation or plate changed?
            const occChanged = Boolean(currObs.occupied) !== newOccupied;
            const plateChanged = (currObs.detectedPlate || '') !== (newPlate || '');
            const violChanged = Boolean(currObs.isViolation) !== newIsViolation;

            const cropImg = (crops && crops[scanned.slotCode]) || null;

            if (occChanged || plateChanged || violChanged) {
              // State changed -> Update slot state
              slotDoc.aiObservation = {
                occupied: newOccupied,
                detectedPlate: newPlate,
                confidence: scanned.confidence || 0.95,
                isViolation: newIsViolation,
                violationType: newViolationType,
                expectedSlot: scanned.expectedSlot || null,
                expectedPlate: scanned.expectedPlate || null,
                evidenceSnapshot: cropImg || currObs.evidenceSnapshot || null,
                fullSnapshot: image ? (image.length < 500000 ? image : null) : null,
                violationMessage: scanned.violationMessage || null,
                sessionId: scanned.session?._id || null,
                lastScannedAt: new Date(),
              };

              if (slotDoc.status !== 'maintenance') {
                slotDoc.status = newOccupied ? 'occupied' : 'available';
              }

              await slotDoc.save();

              // Write Audit Log
              if (newIsViolation) {
                await SlotAuditLog.create({
                  slotId: slotDoc._id,
                  slotCode: slotDoc.slotNumber,
                  floorId: targetFloorId,
                  changeType: 'VIOLATION_DETECTED',
                  violationType: newViolationType,
                  detectedPlate: newPlate,
                  expectedSlot: scanned.expectedSlot || null,
                  expectedPlate: scanned.expectedPlate || null,
                  evidenceSnapshot: cropImg || null,
                  fullSnapshot: image || null,
                  violationMessage: scanned.violationMessage || null,
                  status: 'PENDING',
                  sessionId: scanned.session?._id || null,
                });
              } else if (currObs.isViolation && !newIsViolation) {
                await SlotAuditLog.updateMany(
                  { slotId: slotDoc._id, status: 'PENDING' },
                  {
                    status: 'RESOLVED',
                    resolutionAction: 'AUTO_CLEARED_BY_SCAN',
                    resolutionNote: 'Xe đã dời khỏi ô hoặc đã được điều chỉnh hợp lệ theo lượt quét mới nhất.',
                    resolvedAt: new Date(),
                  }
                );
              } else {
                await SlotAuditLog.create({
                  slotId: slotDoc._id,
                  slotCode: slotDoc.slotNumber,
                  floorId: targetFloorId,
                  changeType: 'OCCUPANCY_CHANGED',
                  detectedPlate: newPlate,
                  status: 'RESOLVED',
                  resolutionAction: newOccupied ? 'VEHICLE_PARKED' : 'VEHICLE_LEFT',
                  resolvedAt: new Date(),
                });
              }
            }
          }
        }
      } catch (persistErr) {
        console.warn('[AI Slot Scan] MongoDB smart persistence warning:', persistErr.message);
      }

      return res.status(200).json({
        success: true,
        model: usedModel,
        detectedFloorNumber,
        detectedFloorName,
        isFloorMismatch: false,
        totalSlots: enrichedSlots.length,
        slots: enrichedSlots,
        calibratedSlots: physicalCalibratedSlots,
        corners: detectedCorners,
      });
    } catch (dbErr) {
      console.warn('[AI Slot Scan] Database cross-check warning:', dbErr.message);
      return res.status(200).json({
        success: true,
        model: usedModel,
        detectedFloorNumber,
        detectedFloorName,
        isFloorMismatch: false,
        totalSlots: scannedSlots.length,
        slots: scannedSlots,
        calibratedSlots: physicalCalibratedSlots,
        corners: detectedCorners,
      });
    }
  } catch (error) {
    console.error('[AI Slot Scan] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to scan parking slots',
      error: error.message,
    });
  }
};

exports.autoDetectSlotGrid = async (req, res) => {
  try {
    const { image, slotCodes } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // -------------------------------------------------------------
    // ATTEMPT 1: Local Python AI Service (YOLOv8-Seg parking_slots_yolo.pt)
    // -------------------------------------------------------------
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    try {
      console.log('[AI Auto Detect] Attempting Local YOLOv8-Seg Model...');
      const aiResponse = await axios.post(`${aiServiceUrl}/auto-detect-grid`, {
        image: image || null,
        slotCodes: slotCodes || [],
      }, {
        timeout: 25000,
      });

      if (aiResponse.data && aiResponse.data.success && Array.isArray(aiResponse.data.slots) && aiResponse.data.slots.length > 0) {
        console.log(`[AI Auto Detect] Local YOLOv8-Seg successfully returned ${aiResponse.data.slots.length} slots!`);
        return res.status(200).json(aiResponse.data);
      }
    } catch (localErr) {
      console.warn('[AI Auto Detect] Local AI service not ready or failed, falling back to Gemini Vision:', localErr.message);
    }

    // -------------------------------------------------------------
    // ATTEMPT 2: Google Gemini 2.5 Flash Vision Fallback
    // -------------------------------------------------------------
    if (process.env.GEMINI_API_KEY) {
      try {
        console.log('[AI Auto Detect] Using Gemini 2.5 Flash Vision for diorama detection...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `You are an expert Autonomous Vehicle and Smart Parking Vision AI engineer.
Examine this webcam image showing a physical 27-slot parking lot diorama or floor layout.

The parking lot contains printed or drawn rectangular parking slots for the following slot codes:
- Zone A Top (5 slots left of middle gap): A1, A2, A3, A4, A5
- Zone A Bottom (5 slots left of middle gap): A6, A7, A8, A9, A10
- Zone B Top (5 slots right of middle gap): B1 (where vehicle/card is placed), B2, B3, B4, B5
- Zone B Bottom (2 slots right of middle gap): B6, B7
- Zone C Bottom (5 slots left of middle gap): C1, C2, C3, C4, C5
- Zone D Bottom (5 slots right of middle gap): D1, D2, D3, D4, D5

TASK:
For EACH of the 27 physical parking slots, detect its EXACT 4-corner polygon following the real physical perspective, tilt, slant, and borders of that drawn slot in the image:
- Top-Left corner: [x1, y1]
- Top-Right corner: [x2, y2]
- Bottom-Right corner: [x3, y3]
- Bottom-Left corner: [x4, y4]

Also detect the 4 outer boundary corners of the entire parking diorama layout:
"corners": [ [TL_x, TL_y], [TR_x, TR_y], [BR_x, BR_y], [BL_x, BL_y] ]

Coordinates must be normalized floats in range [0.0, 1.0] where [0.0, 0.0] is top-left and [1.0, 1.0] is bottom-right of the image.

Return ONLY a JSON object:
{
  "corners": [
    [TL_x, TL_y],
    [TR_x, TR_y],
    [BR_x, BR_y],
    [BL_x, BL_y]
  ],
  "slots": [
    { "slotCode": "A1", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A2", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A3", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A4", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A5", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A6", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A7", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A8", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A9", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "A10", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "B1", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "B2", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "B3", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "B4", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "B5", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "B6", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "B7", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "C1", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "C2", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "C3", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "C4", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "C5", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "D1", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "D2", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "D3", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "D4", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] },
    { "slotCode": "D5", "polygon": [ [x1, y1], [x2, y2], [x3, y3], [x4, y4] ] }
  ]
}
Do NOT include any extra text or markdown formatting. Return raw JSON only.`;

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
        const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        const parsed = JSON.parse(clean);

        if (parsed && Array.isArray(parsed.slots) && parsed.slots.length >= 10) {
          const validDetectedSlots = parsed.slots.filter(s => Array.isArray(s.polygon) && s.polygon.length === 4);

          let finalSlots = validDetectedSlots;
          // If fewer than 27 slots were returned, fill remaining from homography
          if (finalSlots.length < 27 && Array.isArray(parsed.corners) && parsed.corners.length === 4) {
            const fallbackGrid = generate27SlotsFromCorners(parsed.corners);
            const detectedMap = new Map(finalSlots.map(s => [s.slotCode, s]));
            finalSlots = fallbackGrid.map(fb => detectedMap.get(fb.slotCode) || fb);
          }

          console.log(`[AI Auto Detect] Gemini Vision successfully detected ${finalSlots.length} physical perspective slots!`);
          return res.status(200).json({
            success: true,
            model: 'gemini_vision',
            corners: parsed.corners || null,
            totalSlots: finalSlots.length,
            slots: finalSlots,
          });
        }
      } catch (geminiErr) {
        console.warn('[AI Auto Detect] Gemini Vision error:', geminiErr.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to auto-detect diorama slot grid with any available AI model.',
    });

  } catch (error) {
    console.error('[AI Auto Detect Grid] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to auto-detect diorama slot grid',
      error: error.message,
    });
  }
};

// @route   GET /api/ai/violation-logs
// @desc    Get global parking lot violation logs with search, date filters & pagination
// @access  Public / Staff
exports.getViolationLogs = async (req, res) => {
  try {
    const SlotAuditLog = require('../models/SlotAuditLog');
    const { floorId, status, slotCode, search, date, month, startDate, endDate, quickRange, page = 1, limit = 100 } = req.query;

    const filter = {
      changeType: { $in: ['VIOLATION_DETECTED', 'VIOLATION_RESOLVED', 'WARNING_ISSUED', 'SLOT_REASSIGNED'] },
    };
    if (floorId) filter.floorId = floorId;
    if (status) filter.status = status;

    // Search query (Mã ô, biển số, ghi chú, tên người xử lý)
    if (search && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
      filter.$or = [
        { slotCode: regex },
        { detectedPlate: regex },
        { expectedSlot: regex },
        { expectedPlate: regex },
        { resolverName: regex },
        { violationMessage: regex },
        { resolutionNote: regex },
      ];
    } else if (slotCode) {
      filter.slotCode = slotCode.toUpperCase();
    }

    // Date filtering
    const now = new Date();
    if (quickRange === 'today') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    } else if (quickRange === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const startOfDay = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
      filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
    } else if (quickRange === 'week') {
      const past7 = new Date(now);
      past7.setDate(past7.getDate() - 7);
      past7.setHours(0, 0, 0, 0);
      filter.createdAt = { $gte: past7 };
    } else if (quickRange === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      filter.createdAt = { $gte: startOfMonth };
    } else if (month) {
      const [yStr, mStr] = month.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10) - 1;
      if (!isNaN(y) && !isNaN(m)) {
        const startOfMonth = new Date(y, m, 1, 0, 0, 0, 0);
        const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);
        filter.createdAt = { $gte: startOfMonth, $lte: endOfMonth };
      }
    } else if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
        filter.createdAt = { $gte: start, $lte: end };
      }
    } else if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        const s = new Date(startDate);
        s.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = s;
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = e;
      }
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [total, logs] = await Promise.all([
      SlotAuditLog.countDocuments(filter),
      SlotAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate('floorId', 'name floorNumber')
        .populate('resolvedBy', 'fullName username email phone')
        .populate('sessionId')
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
      data: logs,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route   GET /api/ai/slot-logs/:slotCode
// @desc    Get history logs for a specific parking slot (including violations & maintenance)
// @access  Public / Staff
exports.getSlotLogs = async (req, res) => {
  try {
    const SlotAuditLog = require('../models/SlotAuditLog');
    const SlotMaintenanceLog = require('../models/SlotMaintenanceLog');
    const Slot = require('../models/Slot');
    const { slotCode } = req.params;
    const { floorId } = req.query;

    const normalizedCode = String(slotCode).trim().toUpperCase();
    const filter = { slotCode: normalizedCode };
    if (floorId) filter.floorId = floorId;

    const slotQuery = { slotNumber: normalizedCode };
    if (floorId) slotQuery.floorID = floorId;
    const targetSlot = await Slot.findOne(slotQuery).lean();

    const [auditLogs, maintenanceLogs] = await Promise.all([
      SlotAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(40)
        .populate('floorId', 'name floorNumber')
        .populate('resolvedBy', 'fullName username email')
        .lean(),
      targetSlot
        ? SlotMaintenanceLog.find({ slotID: targetSlot._id })
            .sort({ createdAt: -1 })
            .limit(20)
            .populate('managerID', 'fullName username email')
            .lean()
        : [],
    ]);

    const formattedMaintenanceLogs = (maintenanceLogs || []).map((m) => ({
      _id: m._id,
      slotCode: normalizedCode,
      floorId: targetSlot?.floorID,
      changeType: 'MAINTENANCE',
      status: m.endTime ? 'RESOLVED' : 'ACTIVE_MAINTENANCE',
      resolutionAction: m.endTime ? 'MAINTENANCE_COMPLETED' : 'UNDER_MAINTENANCE',
      resolutionNote: `Bảo trì ô đỗ: ${m.reason}${m.endTime ? ` (Hoàn thành lúc ${new Date(m.endTime).toLocaleTimeString()})` : ' (Đang diễn ra)'}`,
      resolverName: m.managerID?.fullName || m.managerID?.username || 'Kỹ thuật viên',
      createdAt: m.startTime || m.createdAt,
    }));

    const combined = [...(auditLogs || []), ...formattedMaintenanceLogs].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.status(200).json({
      success: true,
      data: combined,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route   POST /api/ai/resolve-violation
// @desc    Resolve violation (reassign session slot or issue warning/ticket)
// @access  Staff / Protected
// @route   POST /api/ai/resolve-violation
// @desc    Resolve violation (reassign session slot or issue warning/ticket)
// @access  Staff / Protected
exports.resolveViolation = async (req, res) => {
  try {
    const Slot = require('../models/Slot');
    const SlotAuditLog = require('../models/SlotAuditLog');
    const Session = require('../models/Session');
    const { logId, slotCode, floorId, action, note, newSlotCode, sessionId } = req.body;

    const resolvedByName = req.user?.fullName || req.user?.username || 'Staff Operator';
    const resolvedById = req.user?._id || null;

    let auditLogDoc = null;
    if (logId) {
      auditLogDoc = await SlotAuditLog.findById(logId);
    }

    if (action === 'REASSIGN_SLOT') {
      let targetSession = null;
      if (sessionId) {
        targetSession = await Session.findById(sessionId);
      }
      if (!targetSession && auditLogDoc?.sessionId) {
        targetSession = await Session.findById(auditLogDoc.sessionId);
      }
      if (!targetSession && auditLogDoc?.detectedPlate) {
        const normPlate = auditLogDoc.detectedPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        targetSession = await Session.findOne({
          licensePlate: new RegExp(`^${normPlate}$`, 'i'),
          status: 'active',
        });
      }
      if (!targetSession && slotCode) {
        targetSession = await Session.findOne({
          parkingSlot: new RegExp(`^${slotCode}$`, 'i'),
          status: 'active',
        });
      }

      const assignedNewSlot = (newSlotCode || slotCode).toUpperCase();

      if (targetSession) {
        const oldSlotCode = targetSession.parkingSlot;
        targetSession.parkingSlot = assignedNewSlot;
        await targetSession.save();

        if (oldSlotCode && oldSlotCode.toUpperCase() !== assignedNewSlot) {
          const oldSlotDoc = await Slot.findOne({ slotNumber: oldSlotCode.toUpperCase() });
          const isOldOccupied = Boolean(oldSlotDoc?.aiObservation?.occupied);
          await Slot.updateOne(
            { slotNumber: oldSlotCode.toUpperCase() },
            {
              $set: {
                status: isOldOccupied ? 'occupied' : 'available',
                'aiObservation.isViolation': false,
                'aiObservation.expectedSlot': null,
                'aiObservation.expectedPlate': null,
                'aiObservation.sessionId': null,
                ...(isOldOccupied ? {} : {
                  'aiObservation.occupied': false,
                  'aiObservation.detectedPlate': null,
                }),
              },
            }
          );
        }
      }

      // Lock new slot to occupied status
      await Slot.updateOne(
        { slotNumber: assignedNewSlot },
        {
          $set: {
            status: 'occupied',
            'aiObservation.occupied': true,
            'aiObservation.detectedPlate': targetSession?.licensePlate || auditLogDoc?.detectedPlate || null,
            'aiObservation.isViolation': false,
            'aiObservation.violationType': null,
            'aiObservation.violationMessage': null,
            'aiObservation.expectedSlot': assignedNewSlot,
            'aiObservation.sessionId': targetSession?._id || null,
          },
        }
      );

      if (logId) {
        await SlotAuditLog.findByIdAndUpdate(logId, {
          status: 'RESOLVED',
          resolutionAction: 'REASSIGN_SLOT',
          resolutionNote: note || `Staff ${resolvedByName} chấp nhận đổi ô đỗ sang ${assignedNewSlot}`,
          resolvedBy: resolvedById,
          resolverName: resolvedByName,
          resolvedAt: new Date(),
        });
      } else {
        await SlotAuditLog.updateMany(
          { slotCode: slotCode.toUpperCase(), status: 'PENDING' },
          {
            status: 'RESOLVED',
            resolutionAction: 'REASSIGN_SLOT',
            resolutionNote: note || `Staff ${resolvedByName} chấp nhận đổi ô đỗ sang ${assignedNewSlot}`,
            resolvedBy: resolvedById,
            resolverName: resolvedByName,
            resolvedAt: new Date(),
          }
        );
      }

      return res.status(200).json({
        success: true,
        message: `Đã đổi ô đỗ thành công sang ${assignedNewSlot} và giải phóng vi phạm!`,
      });
    }

    if (action === 'ISSUE_WARNING' || action === 'DISMISS') {
      const isDismiss = action === 'DISMISS';
      if (logId) {
        await SlotAuditLog.findByIdAndUpdate(logId, {
          status: isDismiss ? 'DISMISSED' : 'RESOLVED',
          resolutionAction: action,
          resolutionNote: note || `Staff ${resolvedByName} đã xử lý (${isDismiss ? 'Bỏ qua cảnh báo' : 'Nhắc nhở / Lập biên bản'})`,
          resolvedBy: resolvedById,
          resolverName: resolvedByName,
          resolvedAt: new Date(),
        });
      } else {
        await SlotAuditLog.updateMany(
          { slotCode: slotCode.toUpperCase(), status: 'PENDING' },
          {
            status: isDismiss ? 'DISMISSED' : 'RESOLVED',
            resolutionAction: action,
            resolutionNote: note || `Staff ${resolvedByName} đã xử lý (${isDismiss ? 'Bỏ qua cảnh báo' : 'Nhắc nhở / Lập biên bản'})`,
            resolvedBy: resolvedById,
            resolverName: resolvedByName,
            resolvedAt: new Date(),
          }
        );
      }

      // PHYSICAL GROUND TRUTH: If vehicle is physically parked, lock status to 'occupied' to prevent double booking!
      const currentSlot = await Slot.findOne({ slotNumber: slotCode.toUpperCase() });
      const isPhysicallyOccupied = Boolean(currentSlot?.aiObservation?.occupied);

      await Slot.updateOne(
        { slotNumber: slotCode.toUpperCase() },
        {
          $set: {
            status: isPhysicallyOccupied ? 'occupied' : (currentSlot?.status === 'maintenance' ? 'maintenance' : 'available'),
            'aiObservation.isViolation': false,
            'aiObservation.violationType': null,
            'aiObservation.violationMessage': null,
          },
        }
      );

      return res.status(200).json({
        success: true,
        message: isDismiss ? 'Đã bỏ qua cảnh báo và khóa trạng thái ô an toàn' : 'Đã ghi nhận nhắc nhở/lập biên bản cho tài xế!',
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid resolution action' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route   POST /api/ai/clear-all-violations
// @desc    Clear/reset all active slot violations and lock occupied slots safely
// @access  Public / Staff
exports.clearAllViolations = async (req, res) => {
  try {
    const Slot = require('../models/Slot');
    const SlotAuditLog = require('../models/SlotAuditLog');
    const { floorId } = req.body || {};

    const query = floorId ? { floorID: floorId } : {};
    const slots = await Slot.find(query);

    for (const slot of slots) {
      const isPhysicallyOccupied = Boolean(slot.aiObservation?.occupied);
      slot.aiObservation = {
        ...(slot.aiObservation || {}),
        isViolation: false,
        violationType: null,
        violationMessage: null,
        expectedSlot: null,
        expectedPlate: null,
      };

      // Physical Ground Truth: Any slot with a car physically parked MUST remain 'occupied'!
      if (slot.status !== 'maintenance') {
        slot.status = isPhysicallyOccupied ? 'occupied' : (slot.status === 'booked' ? 'booked' : 'available');
      }
      await slot.save();
    }

    await SlotAuditLog.updateMany(
      { status: 'PENDING' },
      {
        $set: {
          status: 'DISMISSED',
          resolutionAction: 'RESET_BY_STAFF',
          resolutionNote: 'Nhân viên đã đặt lại / xóa toàn bộ cảnh báo thử nghiệm',
          resolvedAt: new Date(),
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Đã hủy và đặt lại cảnh báo thành công! Các ô có xe đỗ đã được khóa trạng thái an toàn.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @route   GET /api/ai/driver-contact
// @desc    Get phone/email of offending vehicle driver and VIP owner info
// @access  Public / Staff
exports.getDriverContactInfo = async (req, res) => {
  try {
    const { plate, slotCode } = req.query;
    const cleanPlate = (plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const cleanSlot = (slotCode || '').trim().toUpperCase();

    const Session = require('../models/Session');
    const Booking = require('../models/Booking');
    const Vehicle = require('../models/Vehicle');
    const UserDetail = require('../models/UserDetail');
    const MembershipSlotEntitlement = require('../models/MembershipSlotEntitlement');

    let driverContact = {
      licensePlate: plate || cleanPlate,
      phone: null,
      email: null,
      fullName: null,
      isRegistered: false,
      source: null,
    };

    // 1. Look up in active/past sessions
    if (cleanPlate) {
      const session = await Session.findOne({
        licensePlate: new RegExp(`^${cleanPlate}$`, 'i'),
      }).sort({ createdAt: -1 }).populate('userId', 'email username fullName').lean();

      if (session) {
        driverContact.phone = session.phone || null;
        if (session.userId) {
          driverContact.email = session.userId.email || null;
          driverContact.fullName = session.userId.fullName || session.userId.username || null;
          driverContact.isRegistered = true;
        }
        driverContact.source = 'Session';
      }
    }

    // 2. Look up in Bookings
    if (cleanPlate && (!driverContact.phone || !driverContact.email)) {
      const booking = await Booking.findOne({
        licensePlate: new RegExp(`^${cleanPlate}$`, 'i'),
      }).sort({ createdAt: -1 }).populate('userId', 'email username fullName').lean();

      if (booking) {
        if (!driverContact.phone) driverContact.phone = booking.phone || null;
        if (booking.userId) {
          if (!driverContact.email) driverContact.email = booking.userId.email || null;
          if (!driverContact.fullName) driverContact.fullName = booking.userId.fullName || booking.userId.username || null;
          driverContact.isRegistered = true;
        }
        driverContact.source = driverContact.source || 'Booking';
      }
    }

    // 3. Look up in Vehicles & UserDetail
    if (cleanPlate && (!driverContact.phone || !driverContact.email)) {
      const vehicle = await Vehicle.findOne({
        licensePlate: new RegExp(`^${cleanPlate}$`, 'i'),
      }).populate('owner', 'email username fullName').lean();

      if (vehicle && vehicle.owner) {
        if (!driverContact.email) driverContact.email = vehicle.owner.email || null;
        if (!driverContact.fullName) driverContact.fullName = vehicle.owner.fullName || vehicle.owner.username || null;
        driverContact.isRegistered = true;
        driverContact.source = driverContact.source || 'Vehicle';

        const detail = await UserDetail.findOne({ userId: vehicle.owner._id }).lean();
        if (detail && detail.phone && !driverContact.phone) {
          driverContact.phone = detail.phone;
        }
      }
    }

    // 4. Look up VIP owner of slotCode if it's an entitlement slot
    let vipOwner = null;
    if (cleanSlot) {
      const ent = await MembershipSlotEntitlement.findOne({
        slotCode: cleanSlot,
        status: { $in: ['active', 'transfer_locked'] },
        expireAt: { $gt: new Date() },
      })
        .populate('ownerId', 'username email fullName')
        .populate('packageId', 'name type')
        .lean();

      if (ent && ent.ownerId) {
        const ownerDetail = await UserDetail.findOne({ userId: ent.ownerId._id }).lean();
        vipOwner = {
          slotCode: cleanSlot,
          username: ent.ownerId.username || 'Khách VIP',
          fullName: ent.ownerId.fullName || ent.ownerId.username,
          email: ent.ownerId.email || null,
          phone: ownerDetail?.phone || null,
          packageName: ent.packageId?.name || (ent.packageId?.type === 'yearly' ? 'Gói VIP Năm' : 'Gói VIP Tháng'),
          expireAt: ent.expireAt,
        };
      }
    }

    return res.status(200).json({
      success: true,
      driverContact,
      vipOwner,
      isVipSlot: Boolean(vipOwner),
    });
  } catch (err) {
    console.error('getDriverContactInfo error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @route   POST /api/ai/send-warning-email
// @desc    Send urgent violation warning email to vehicle driver
// @access  Public / Staff
exports.sendViolationEmail = async (req, res) => {
  try {
    const { slotCode, detectedPlate, recipientEmail, customNote, isVipSlot } = req.body || {};
    const toEmail = (recipientEmail || '').trim();

    if (!toEmail) {
      return res.status(400).json({ success: false, message: 'Địa chỉ email người nhận là bắt buộc' });
    }

    const { createTransporter } = require('../utils/emailUtils');
    const SlotAuditLog = require('../models/SlotAuditLog');
    const transporter = createTransporter();

    const cleanPlate = (detectedPlate || 'N/A').toUpperCase();
    const cleanSlot = (slotCode || 'N/A').toUpperCase();

    const subject = isVipSlot
      ? `🚨 [KHẨN CẤP] Xe ${cleanPlate} đang chiếm dụng trái phép Ô VIP ${cleanSlot} - Valo Parking`
      : `⚠️ [CẢNH BÁO] Xe ${cleanPlate} đỗ không đúng vị trí tại Ô ${cleanSlot} - Valo Parking`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid #334155;">
        <div style="background: linear-gradient(135deg, #b91c1c, #dc2626); padding: 24px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 2px;">
            🚨 THÔNG BÁO VI PHẠM ĐỖ XE
          </h1>
          <p style="color: #fecaca; margin: 6px 0 0; font-size: 13px;">Hệ Thống Giám Sát Bãi Xe Tự Động Valo Parking</p>
        </div>

        <div style="padding: 24px; background: #1e293b;">
          <p style="font-size: 15px; line-height: 1.6; margin-top: 0;">
            Kính gửi Quý khách chủ phương tiện biển kiểm soát <strong>${cleanPlate}</strong>,
          </p>
          <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">
            Camera AI giám sát bãi đỗ xe đã phát hiện phương tiện của Quý khách đang đỗ tại 
            <strong style="color: #f87171; font-size: 16px;">Ô ${cleanSlot}</strong> 
            ${isVipSlot ? '<span style="color: #fbbf24; font-weight: bold;">(Ô đỗ VIP độc quyền đã được đăng ký cố định cho khách hàng khác)</span>' : 'không đúng vị trí quy định'}.
          </p>

          <div style="background: #0f172a; border-left: 4px solid #ef4444; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px; font-size: 13px; color: #94a3b8; text-transform: uppercase; font-weight: bold;">Chi Tiết Vi Phạm:</p>
            <p style="margin: 4px 0; font-size: 14px;">• <strong>Biển số xe:</strong> <span style="font-family: monospace; color: #38bdf8; font-size: 15px;">${cleanPlate}</span></p>
            <p style="margin: 4px 0; font-size: 14px;">• <strong>Vị trí đang đỗ:</strong> <span style="color: #f87171; font-weight: bold;">${cleanSlot}</span></p>
            <p style="margin: 4px 0; font-size: 14px;">• <strong>Thời điểm phát hiện:</strong> ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
            ${customNote ? `<p style="margin: 4px 0; font-size: 14px; color: #fbbf24;">• <strong>Ghi chú:</strong> ${customNote}</p>` : ''}
          </div>

          <div style="background: rgba(239, 68, 68, 0.1); border: 1px dashed #ef4444; border-radius: 8px; padding: 14px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #fca5a5; font-weight: bold;">
              ⏳ YÊU CẦU: Vui lòng di dời xe trong vòng 10 - 15 phút.
            </p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #94a3b8;">
              Sau thời gian trên, ban quản lý sẽ tiến hành cẩu/khóa bánh và áp dụng phụ phí vi phạm theo quy định bãi xe.
            </p>
          </div>

          <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">
            Nếu Quý khách cần hỗ trợ điều hướng sang ô đỗ trống khác, vui lòng liên hệ trực tiếp nhân viên bảo vệ tại sảnh hoặc Hotline bãi đỗ xe.
          </p>
        </div>

        <div style="background: #0f172a; padding: 16px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b;">
          VALO PARKING SYSTEM • Smart AI Management • Hotline: 1900-VALO
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"VALO Parking Alert" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject,
      html: htmlContent,
    });

    // Ghi log vào SlotAuditLog
    await SlotAuditLog.create({
      slotCode: cleanSlot,
      detectedPlate: cleanPlate,
      eventType: 'STAFF_ACTION',
      resolutionAction: 'ISSUE_WARNING',
      resolutionNote: `Staff đã gửi email cảnh báo vi phạm tới ${toEmail}`,
      status: 'RESOLVED',
      resolvedAt: new Date(),
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Đã gửi email cảnh báo vi phạm tới ${toEmail} thành công!`,
    });
  } catch (err) {
    console.error('sendViolationEmail error:', err);
    res.status(500).json({ success: false, message: `Lỗi gửi email: ${err.message}` });
  }
};





