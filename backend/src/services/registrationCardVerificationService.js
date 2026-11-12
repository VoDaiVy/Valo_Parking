const { GoogleGenerativeAI } = require('@google/generative-ai');
const { normalizeLicensePlate } = require('../utils/licensePlateUtils');

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[\u0111\u0110]/g, 'd')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '');

const normalizeImage = (image) => {
  if (typeof image !== 'string') return null;
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (match) return { mimeType: match[1], data: match[2] };
  if (/^[A-Za-z0-9+/=]+$/.test(image)) return { mimeType: 'image/jpeg', data: image };
  return null;
};

async function readRegistrationCard(image) {
  const input = normalizeImage(image);
  if (!input) throw new Error('Invalid registration card image');
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = client.getGenerativeModel({
    model: 'gemini-3.5-flash-lite',
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });
  const result = await model.generateContent([
    'Read this image. Return JSON with isRegistrationCard (boolean), ownerName, licensePlate, brand, model, colorText. isRegistrationCard must be true only when this is visibly a Vietnamese vehicle registration document. Use null for missing or unreadable fields. Copy text exactly as printed. Do not guess from a vehicle photo or other context.',
    { inlineData: input },
  ]);
  const parsed = JSON.parse(result.response.text());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid registration card response');
  }
  return { isRegistrationCard: parsed.isRegistrationCard === true, ...Object.fromEntries(
    ['ownerName', 'licensePlate', 'brand', 'model', 'colorText'].map((key) => [
      key,
      typeof parsed[key] === 'string' ? parsed[key].trim().slice(0, 100) : null,
    ]),
  ) };
}

function compareRegistrationCard(card, vehicle) {
  if (card?.isRegistrationCard !== true) {
    return { matched: false, mismatches: ['document'] };
  }
  const fields = [
    ['licensePlate', normalizeLicensePlate],
    ['brand', normalizeText],
    ['model', normalizeText],
    ['colorText', normalizeText, 'color'],
  ];
  const mismatches = fields.filter(([cardKey, normalize, vehicleKey = cardKey]) => {
    const expected = normalize(vehicle[vehicleKey]);
    const actual = normalize(card[cardKey]);
    return !expected || !actual || expected !== actual;
  }).map(([cardKey]) => cardKey);

  return { matched: mismatches.length === 0, mismatches };
}

module.exports = { readRegistrationCard, compareRegistrationCard };
