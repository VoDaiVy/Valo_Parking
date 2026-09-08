const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Vehicle = require('../models/Vehicle');
const Subscription = require('../models/Subscription');
const Session = require('../models/Session');
const UserDetail = require('../models/UserDetail');
const { normalizeLicensePlate, formatLicensePlateDisplay } = require('../utils/licensePlateUtils');

/**
 * Optical Confusability Matrix for OCR / ALPR characters
 */
const CONFUSABLE_PAIRS = [
  ['0', 'O'], ['0', 'D'], ['0', 'Q'], ['0', 'U'],
  ['1', 'I'], ['1', 'L'], ['1', 'T'], ['1', 'J'],
  ['8', 'B'], ['8', 'S'], ['3', '8'], ['3', 'B'],
  ['5', 'S'], ['2', 'Z'], ['6', 'G'], ['6', 'b'],
  ['7', 'Z'], ['7', 'T'], ['4', 'A'], ['9', 'P'],
  ['9', 'G'], ['U', 'V'], ['V', 'Y'], ['C', 'G'],
];

const areCharactersConfusable = (char1, char2) => {
  const c1 = String(char1).toUpperCase();
  const c2 = String(char2).toUpperCase();
  if (c1 === c2) return true;
  return CONFUSABLE_PAIRS.some(
    ([a, b]) => (a === c1 && b === c2) || (a === c2 && b === c1)
  );
};

/**
 * Weighted Levenshtein Distance tailored for ALPR recognition errors
 */
const calculateAlprDistance = (str1 = '', str2 = '') => {
  const s1 = normalizeLicensePlate(str1);
  const s2 = normalizeLicensePlate(str2);

  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const char1 = s1[i - 1];
      const char2 = s2[j - 1];

      let cost = 0;
      if (char1 !== char2) {
        // If characters are visually confusable in ALPR, penalty is only 0.4 instead of 1.0
        cost = areCharactersConfusable(char1, char2) ? 0.4 : 1.0;
      }

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
};

/**
 * Calculate similarity percentage (0 - 100%) between two license plates
 */
const calculatePlateSimilarity = (detectedPlate = '', targetPlate = '') => {
  const s1 = normalizeLicensePlate(detectedPlate);
  const s2 = normalizeLicensePlate(targetPlate);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 100;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 100;

  const distance = calculateAlprDistance(s1, s2);
  const similarity = Math.max(0, 1 - distance / maxLen);
  return Math.round(similarity * 100);
};

/**
 * Reconstruct plate using Google Gemini Vision (Multimodal AI)
 */
const enhancePlateWithGemini = async (imageBase64) => {
  if (!process.env.GEMINI_API_KEY || !imageBase64) return null;

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const prompt = `You are an expert AI for ALPR (Automatic License Plate Recognition) assisting with blurred, muddy, low-light, or damaged Vietnamese license plates.
Carefully examine the image to reconstruct the exact Vietnamese license plate characters.
Return ONLY a valid JSON object without markdown fences, in the exact format:
{
  "detectedPlate": "<Reconstructed standard Vietnamese plate e.g. 51F-888.12 or 29A-123.45>",
  "cleanPlate": "<Only uppercase alphanumeric letters without punctuation e.g. 51F88812>",
  "confidence": <Number between 0 and 100>,
  "notes": "<Brief explanation of reconstructed characters e.g. Number 8 was partially covered by mud, series is F>"
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

    const text = result.response.text().trim();
    const cleanJson = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleanJson);
  } catch (error) {
    console.warn('[PlateResolution] Gemini Vision enhancement failed or skipped:', error.message);
    return null;
  }
};

/**
 * Main AI Plate Resolution & Suggestion Engine
 * @param {Object} params
 * @param {string} [params.image] - Base64 image of the vehicle/plate
 * @param {string} [params.rawPlate] - Rough string from OCR (e.g. '51F-88B12')
 * @param {number} [params.confidence] - Initial OCR confidence (0 - 100)
 */
async function resolveUnclearPlate({ image, rawPlate = '', confidence = 50 }) {
  const isDbConnected = mongoose.connection.readyState === 1;
  const cleanInputPlate = normalizeLicensePlate(rawPlate);

  // 1. Try AI Multimodal Vision Reconstruction if image provided
  let geminiResult = null;
  if (image) {
    geminiResult = await enhancePlateWithGemini(image);
  }

  const primarySearchString = geminiResult?.cleanPlate || cleanInputPlate;

  // 2. Fetch known candidate plates from active DB universe
  const candidateMap = new Map();

  const addCandidate = (plate, meta) => {
    const clean = normalizeLicensePlate(plate);
    if (!clean || clean.length < 5) return;

    if (!candidateMap.has(clean)) {
      candidateMap.set(clean, {
        plate: clean,
        formattedPlate: formatLicensePlateDisplay(clean),
        sources: [meta.source],
        ownerName: meta.ownerName || null,
        phone: meta.phone ? String(meta.phone).replace(/(\d{3})\d{4}(\d{3})/, '$1****$2') : null,
        bookingInfo: meta.bookingInfo || null,
        priorityWeight: meta.priorityWeight || 1.0,
      });
    } else {
      const existing = candidateMap.get(clean);
      if (!existing.sources.includes(meta.source)) {
        existing.sources.push(meta.source);
      }
      if (meta.ownerName && !existing.ownerName) existing.ownerName = meta.ownerName;
      if (meta.phone && !existing.phone) {
        existing.phone = String(meta.phone).replace(/(\d{3})\d{4}(\d{3})/, '$1****$2');
      }
      if (meta.bookingInfo && !existing.bookingInfo) existing.bookingInfo = meta.bookingInfo;
      existing.priorityWeight = Math.max(existing.priorityWeight, meta.priorityWeight || 1.0);
    }
  };

  if (isDbConnected) {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // a) Today's bookings
      const bookings = await Booking.find({
        scheduledStart: { $gte: startOfDay, $lte: endOfDay },
        status: { $in: ['confirmed', 'paid', 'active', 'holding_slot'] },
      })
        .select('licensePlate scheduledStart scheduledEnd parkingSlot floorId userId')
        .populate('userId', 'fullName email')
        .lean();

      bookings.forEach((b) => {
        addCandidate(b.licensePlate, {
          source: 'BOOKING_TODAY',
          ownerName: b.userId?.fullName || 'Booked Customer',
          bookingInfo: {
            slot: b.parkingSlot,
            time: `${new Date(b.scheduledStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${new Date(b.scheduledEnd).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
          },
          priorityWeight: 1.25,
        });
      });

      // b) Registered vehicles in system
      const vehicles = await Vehicle.find({ status: 'approved' })
        .select('licensePlate owner nickname brand')
        .populate('owner', 'fullName email')
        .limit(200)
        .lean();

      for (const v of vehicles) {
        let phone = null;
        if (v.owner?._id) {
          const detail = await UserDetail.findOne({ userId: v.owner._id }).select('phone').lean().catch(() => null);
          phone = detail?.phone || null;
        }

        addCandidate(v.licensePlate, {
          source: 'REGISTERED_VEHICLE',
          ownerName: v.nickname || v.owner?.fullName || v.brand || 'Registered Vehicle',
          phone,
          priorityWeight: 1.15,
        });
      }

      // c) Active subscriptions (VIP)
      const subscriptions = await Subscription.find({
        status: { $in: ['active', 'paid'] },
        startDate: { $lte: today },
        endDate: { $gte: today },
      })
        .select('licensePlate user planType')
        .populate('user', 'fullName')
        .lean()
        .catch(() => []);

      subscriptions.forEach((sub) => {
        if (sub.licensePlate) {
          addCandidate(sub.licensePlate, {
            source: 'VIP_MEMBER',
            ownerName: sub.user?.fullName || 'VIP Member',
            priorityWeight: 1.3,
          });
        }
      });

      // d) Recent sessions
      const recentSessions = await Session.find({ status: { $in: ['active', 'completed'] } })
        .select('licensePlate phone')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
        .catch(() => []);

      recentSessions.forEach((s) => {
        addCandidate(s.licensePlate, {
          source: 'RECENT_SESSION',
          phone: s.phone,
          priorityWeight: 1.05,
        });
      });
    } catch (dbErr) {
      console.warn('[PlateResolution] Error gathering DB candidate universe:', dbErr.message);
    }
  }

  // If Gemini produced a candidate plate that wasn't in DB yet, add it
  if (geminiResult?.cleanPlate) {
    addCandidate(geminiResult.cleanPlate, {
      source: 'AI_VISION_ENHANCED',
      ownerName: 'AI Vision Enhanced',
      priorityWeight: 1.2,
    });
  }

  // 3. Compute Similarity Scores and Rank Top Candidates
  const scoredCandidates = [];

  for (const candidate of candidateMap.values()) {
    // Score against raw detected plate
    const simRaw = calculatePlateSimilarity(cleanInputPlate, candidate.plate);
    // Score against Gemini enhanced plate if available
    const simGemini = geminiResult?.cleanPlate
      ? calculatePlateSimilarity(geminiResult.cleanPlate, candidate.plate)
      : 0;

    const baseScore = Math.max(simRaw, simGemini);
    const weightedScore = Math.min(100, Math.round(baseScore * candidate.priorityWeight));

    // Include if similarity is meaningful (> 50%) or if it's the only one
    if (baseScore >= 50 || candidateMap.size <= 3) {
      scoredCandidates.push({
        ...candidate,
        similarityScore: weightedScore,
        rawSimilarity: baseScore,
      });
    }
  }

  // Sort descending by similarity score
  scoredCandidates.sort((a, b) => b.similarityScore - a.similarityScore);

  // Take top 3 best suggestions
  const topSuggestions = scoredCandidates.slice(0, 3);

  // If top candidate has >= 90% confidence, mark as high confidence match
  const bestMatch = topSuggestions[0] || null;
  const isHighConfidence = bestMatch && bestMatch.similarityScore >= 85;

  const resolutionNotice = isHighConfidence
    ? `AI matched with high confidence (~${bestMatch.similarityScore}%) for license plate [${bestMatch.formattedPlate}].`
    : `Raw plate read [${formatLicensePlateDisplay(cleanInputPlate) || 'unknown'}] has low confidence. Please select one of the high-probability suggestions below.`;

  return {
    originalPlate: rawPlate,
    cleanOriginalPlate: cleanInputPlate,
    formattedOriginalPlate: formatLicensePlateDisplay(cleanInputPlate),
    originalConfidence: confidence,
    geminiEnhanced: geminiResult,
    isResolved: isHighConfidence,
    bestMatch,
    topSuggestions,
    resolutionNotice,
  };
}

module.exports = {
  calculatePlateSimilarity,
  calculateAlprDistance,
  areCharactersConfusable,
  resolveUnclearPlate,
};
