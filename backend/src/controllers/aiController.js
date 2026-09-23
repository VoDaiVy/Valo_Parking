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

exports.scanParkingSlots = async (req, res) => {
  try {
    const { image, slots } = req.body;
    if (!image || !Array.isArray(slots)) {
      return res.status(400).json({
        success: false,
        message: 'Image and slots array are required',
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    let scannedSlots = [];
    let usedModel = 'gemini_vision';

    // -------------------------------------------------------------
    // ATTEMPT 1: High-Precision Gemini 2.5 Flash Vision (Primary)
    // -------------------------------------------------------------
    if (process.env.GEMINI_API_KEY) {
      try {
        console.log('[AI Slot Scan] Running Gemini 2.5 Flash Vision surveillance scan...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const slotCodeList = slots.map((s) => s.slotCode).join(', ');
        const prompt = `You are an Autonomous AI Parking Lot Surveillance & ALPR system.
Look at this webcam image showing a physical parking lot layout or diorama with parking slots.

Slots to inspect: ${slotCodeList}

Zone Layout:
- Zone A: A1, A2, A3, A4, A5 (Row 0 left), A6, A7, A8, A9, A10 (Row 1 left)
- Zone B: B1, B2, B3, B4, B5 (Row 0 right), B6, B7 (Row 1 right)
- Zone C: C1, C2, C3, C4, C5 (Row 2 left)
- Zone D: D1, D2, D3, D4, D5 (Row 2 right)

IDENTIFICATION RULES:
1. Examine each slot carefully:
   - If a license plate or vehicle card is in a slot (e.g. "99A 999.99", "43B 204.04", "93A 289.87"):
     Set occupied: true, and extract the EXACT full license plate (e.g. "99A-999.99", "43B-204.04", "93A-289.87").
   - If a slot only contains its printed slot label (like A1, A2, A4... D5), it is empty:
     Set occupied: false, plate: null.

Return ONLY a valid JSON object formatted as:
{
  "slots": [
    { "slotCode": "A1", "occupied": false, "plate": null, "confidence": 0.98 },
    ...
  ]
}
Include all ${slots.length} slots in the JSON list. Return raw JSON only with no markdown formatting.`;

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

        if (parsed && Array.isArray(parsed.slots) && parsed.slots.length > 0) {
          scannedSlots = parsed.slots;
          usedModel = 'gemini_vision';
          console.log(`[AI Slot Scan] Gemini Vision successfully scanned ${scannedSlots.length} slots!`);
        }
      } catch (geminiErr) {
        console.warn('[AI Slot Scan] Gemini Vision fallback triggered:', geminiErr.message);
      }
    }

    // -------------------------------------------------------------
    // ATTEMPT 2: Fallback to Local Python AI Service (YOLO + EasyOCR)
    // -------------------------------------------------------------
    if (scannedSlots.length === 0) {
      const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
      try {
        const aiResponse = await axios.post(`${aiServiceUrl}/scan-slots`, {
          image,
          slots,
        }, {
          timeout: 8000,
        });
        if (aiResponse.data && Array.isArray(aiResponse.data.slots) && aiResponse.data.slots.length > 0) {
          scannedSlots = aiResponse.data.slots;
          usedModel = 'local_yolo_ocr';
        }
      } catch (aiErr) {
        console.warn('[AI Slot Scan] Local AI service error or offline:', aiErr.message);
      }
    }

    // -------------------------------------------------------------
    // Cross-check with active sessions & registered vehicles for Smart Fuzzy Inference
    // -------------------------------------------------------------
    try {
      const Session = require('../models/Session');
      const Vehicle = require('../models/Vehicle');
      const Booking = require('../models/Booking');

      const [activeSessions, allVehicles, allBookings] = await Promise.all([
        Session.find({ status: 'active' }).select('licensePlate parkingSlot userId checkInTime').populate('userId', 'fullName phone').lean().catch(() => []),
        Vehicle.find().select('licensePlate brand color').lean().catch(() => []),
        Booking.find().select('licensePlate parkingSlot status').lean().catch(() => []),
      ]);

      const sessionBySlot = new Map();
      const sessionByPlate = new Map();
      const knownPlates = new Set();

      activeSessions.forEach((s) => {
        if (s.parkingSlot) sessionBySlot.set(s.parkingSlot.toUpperCase(), s);
        if (s.licensePlate) {
          const norm = s.licensePlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          sessionByPlate.set(norm, s);
          knownPlates.add(s.licensePlate.trim());
        }
      });

      allVehicles.forEach((v) => v.licensePlate && knownPlates.add(v.licensePlate.trim()));
      allBookings.forEach((b) => b.licensePlate && knownPlates.add(b.licensePlate.trim()));

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

      // High-precision OCR correction: Only fix minor OCR typos (1-2 chars), never swap distinct plates
      const inferClosestPlate = (rawPlate) => {
        if (!rawPlate) return null;
        const normRaw = rawPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (normRaw.length < 4) return null;

        let bestMatch = null;
        let highestScore = 0;

        for (const kp of knownPlates) {
          const normKp = kp.replace(/[^A-Z0-9]/gi, '').toUpperCase();
          if (normRaw === normKp) return kp;

          // 1. Province code (first 2 digits) check
          const rawProv = normRaw.slice(0, 2);
          const kpProv = normKp.slice(0, 2);
          const isSameProv = rawProv === kpProv;

          // 2. Suffix numbers similarity check
          const rawSuffix = normRaw.slice(2);
          const kpSuffix = normKp.slice(2);
          const lcsSuffix = getLCSLength(rawSuffix, kpSuffix);
          const maxSuffixLen = Math.max(rawSuffix.length, kpSuffix.length);
          const minSuffixLen = Math.min(rawSuffix.length, kpSuffix.length);

          if (maxSuffixLen === 0) continue;

          // Phải khớp ít nhất 65% phần đuôi số/seri
          const suffixRatio = lcsSuffix / maxSuffixLen;
          const minSuffixRatio = lcsSuffix / minSuffixLen;

          // Nếu đuôi số hoàn toàn khác nhau (VD: 99999 vs 28096) -> Tuyệt đối không nhận nhầm
          if (minSuffixRatio < 0.65) continue;

          let score = suffixRatio;
          if (isSameProv) score += 0.25;

          if (score > highestScore && score >= 0.75) {
            highestScore = score;
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

          if (actualSession) {
            matchedSession = actualSession;
            const assignedSlotUpper = actualSession.parkingSlot?.toUpperCase();
            if (assignedSlotUpper && assignedSlotUpper !== slotCodeUpper) {
              isViolation = true;
              violationType = 'WRONG_SLOT_VIOLATION';
              expectedSlot = actualSession.parkingSlot;
              violationMessage = `Xe ${slot.plate} đã tạo phiên gửi tại ô ${actualSession.parkingSlot} nhưng đang đỗ tại ô ${slot.slotCode}`;
            }
          } else if (actualBooking) {
            const bookedSlotUpper = actualBooking.parkingSlot?.toUpperCase();
            if (bookedSlotUpper && bookedSlotUpper !== slotCodeUpper) {
              isViolation = true;
              violationType = 'WRONG_SLOT_VIOLATION';
              expectedSlot = actualBooking.parkingSlot;
              violationMessage = `Xe ${slot.plate} đã đặt trước ô ${actualBooking.parkingSlot} nhưng đang đỗ tại ô ${slot.slotCode}`;
            } else if (bookedSlotUpper === slotCodeUpper) {
              // Xe đỗ đúng ô đã đặt trước
              isViolation = false;
              expectedSlot = actualBooking.parkingSlot;
            }
          } else {
            // Xe này không có session active và cũng không có booking nào trong hệ thống!
            isViolation = true;
            violationType = 'UNAUTHORIZED_PARKING';
            violationMessage = `Xe ${slot.plate} đỗ tại ô ${slot.slotCode} nhưng chưa tạo phiên gửi xe (Chưa Check-in / Chưa Book chỗ)!`;
          }

          if (expectedPlate && !isViolation) {
            const normExpected = expectedPlate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
            if (normDetected !== normExpected) {
              isViolation = true;
              violationType = 'WRONG_SLOT_VIOLATION';
              expectedSlot = expectedSession.parkingSlot;
              violationMessage = `Ô ${slot.slotCode} đã đăng ký cho xe ${expectedPlate}, phát hiện xe khác ${slot.plate}`;
            }
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
          session: matchedSession || null,
        };
      });

      return res.status(200).json({
        success: true,
        model: usedModel,
        totalSlots: enrichedSlots.length,
        slots: enrichedSlots,
      });
    } catch (dbErr) {
      console.warn('[AI Slot Scan] Database cross-check warning:', dbErr.message);
      return res.status(200).json({
        success: true,
        model: usedModel,
        totalSlots: scannedSlots.length,
        slots: scannedSlots,
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
        timeout: 4000,
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



