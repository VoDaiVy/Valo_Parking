/**
 * Public Address (PA) Audio Chime & Speech Synthesis Utility for Valo Parking
 * Uses native Web Audio API for airport-style chime and Web Speech API for Vietnamese TTS
 */

let activeAudioCtx = null;

/**
 * Play a high-fidelity airport / public address 2-tone chime (D5 -> A4)
 */
export const playAirportChime = () => {
  return new Promise((resolve) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        resolve();
        return;
      }

      if (!activeAudioCtx) {
        activeAudioCtx = new AudioCtx();
      }
      if (activeAudioCtx.state === 'suspended') {
        activeAudioCtx.resume();
      }

      const now = activeAudioCtx.currentTime;

      // Master Gain for smooth volume
      const masterGain = activeAudioCtx.createGain();
      masterGain.gain.setValueAtTime(0.25, now);
      masterGain.connect(activeAudioCtx.destination);

      // Tone 1: D5 (587.33 Hz)
      const osc1 = activeAudioCtx.createOscillator();
      const gain1 = activeAudioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.8, now + 0.05);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc1.connect(gain1);
      gain1.connect(masterGain);
      osc1.start(now);
      osc1.stop(now + 0.5);

      // Tone 2: A4 (440.00 Hz) - plays 0.35s later
      const osc2 = activeAudioCtx.createOscillator();
      const gain2 = activeAudioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(440.0, now + 0.35);
      gain2.gain.setValueAtTime(0, now + 0.35);
      gain2.gain.linearRampToValueAtTime(0.9, now + 0.4);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
      osc2.connect(gain2);
      gain2.connect(masterGain);
      osc2.start(now + 0.35);
      osc2.stop(now + 1.1);

      setTimeout(resolve, 1100);
    } catch (err) {
      console.warn('Audio chime playback error:', err);
      resolve();
    }
  });
};

/**
 * Format license plate for clean, intelligible Vietnamese speech reading
 * Example: '99C-643.99' -> '9 9 C, 6 4 3, 9 9'
 */
const formatPlateForSpeech = (plate) => {
  if (!plate) return 'không xác định';
  return String(plate)
    .replace(/-/g, ' ')
    .replace(/\./g, ' ')
    .trim();
};

/**
 * Speak violation announcement through the parking lot PA sound system
 */
export const speakViolationAnnouncement = async ({
  plate = '',
  slotCode = '',
  isVip = false,
  customMessage = '',
  onStart = () => {},
  onEnd = () => {},
  onError = () => {},
}) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onError(new Error('Trình duyệt không hỗ trợ Web Speech Synthesis.'));
    return;
  }

  // Cancel any ongoing speech before starting a new announcement
  window.speechSynthesis.cancel();

  // Play chime first
  await playAirportChime();

  const formattedPlate = formatPlateForSpeech(plate);
  const cleanSlot = String(slotCode || '').trim();

  let textToSpeak = '';
  if (customMessage) {
    textToSpeak = customMessage;
  } else if (isVip) {
    textToSpeak = `Xin thông báo! Phương tiện mang biển kiểm soát ${formattedPlate} hiện đang đỗ sai vị trí tại ô đỗ V I P ${cleanSlot}. Yêu cầu chủ phương tiện khẩn trương di dời xe để đảm bảo quyền lợi cho khách hàng V I P và tránh bị khóa bánh theo quy định của ban quản lý Valo Parking. Xin trân trọng cảm ơn!`;
  } else {
    textToSpeak = `Xin thông báo! Phương tiện mang biển kiểm soát ${formattedPlate} hiện đang đỗ sai vị trí tại ô ${cleanSlot}. Yêu cầu chủ phương tiện khẩn trương di chuyển xe về đúng vị trí đã đăng ký theo quy định của bãi xe Valo Parking. Xin trân trọng cảm ơn!`;
  }

  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  utterance.lang = 'vi-VN';
  utterance.rate = 0.92; // Clear, measured pace
  utterance.pitch = 1.05;

  // Attempt to select native Vietnamese voice if available
  const voices = window.speechSynthesis.getVoices();
  const vietVoice = voices.find(
    (v) => v.lang === 'vi-VN' || v.lang.startsWith('vi')
  );
  if (vietVoice) {
    utterance.voice = vietVoice;
  }

  utterance.onstart = () => {
    onStart();
  };

  utterance.onend = () => {
    onEnd();
  };

  utterance.onerror = (e) => {
    console.warn('SpeechSynthesis error:', e);
    onError(e);
  };

  window.speechSynthesis.speak(utterance);
};

/**
 * Stop any running announcement
 */
export const stopAnnouncement = () => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};

/**
 * Check if speech synthesis is supported
 */
export const isSpeechSupported = () => {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
};
