export function createAiBookingRecognition(browser, { onTranscript, onError, onEnd, continuous = false }) {
  const SpeechRecognition = browser?.SpeechRecognition || browser?.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.lang = 'vi-VN';
  recognition.continuous = continuous;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex || 0; index < (event.results?.length || 0); index += 1) {
      const result = event.results[index];
      if (result.isFinal === false) continue;
      const transcript = String(result?.[0]?.transcript || '').trim();
      if (transcript) { onTranscript(transcript); break; }
    }
  };
  recognition.onerror = (event) => onError(
    ['not-allowed', 'service-not-allowed'].includes(event.error)
      ? 'Vui lòng cấp quyền micro cho trang web.'
      : event.error === 'audio-capture'
        ? 'Không tìm thấy micro. Vui lòng kiểm tra thiết bị.'
        : event.error === 'language-not-supported'
          ? 'Trình duyệt không hỗ trợ nhận giọng nói tiếng Việt. Vui lòng nhập bằng bàn phím.'
          : 'Micro tạm gián đoạn. Hệ thống sẽ tự nghe lại.',
    event.error,
  );
  recognition.onend = onEnd;
  return recognition;
}

// Keeps a single user-initiated voice conversation active across recognition
// timeouts. Recognition pauses while the request and spoken reply are handled.
export function createAiBookingVoiceSession(browser, { onTranscript, onError, onListeningChange }, restartDelayMs = 180) {
  if (!browser?.SpeechRecognition && !browser?.webkitSpeechRecognition) return null;
  let active = false;
  let paused = false;
  let running = false;
  let recognition = null;
  let restartTimer = null;
  let lastTranscript = '';
  let lastTranscriptAt = 0;
  const schedule = () => {
    if (!active || paused || restartTimer !== null) return;
    restartTimer = setTimeout(() => { restartTimer = null; begin(); }, restartDelayMs);
  };
  const begin = () => {
    if (!active || paused || running) return;
    const next = createAiBookingRecognition(browser, {
      continuous: true,
      onTranscript: (text) => {
        if (!active || paused) return;
        const normalized = String(text).trim().toLowerCase();
        const now = Date.now();
        if (normalized === lastTranscript && now - lastTranscriptAt < 1500) return;
        lastTranscript = normalized;
        lastTranscriptAt = now;
        paused = true;
        try { next.stop(); } catch { /* recognition may already be ending */ }
        onTranscript(text);
      },
      onError: (message, code) => {
        if (!active) return;
        if (['no-speech', 'aborted', 'network', 'bad-grammar'].includes(code)) return;
        paused = true;
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(code)) active = false;
        onError(message);
      },
      onEnd: () => {
        if (recognition !== next) return;
        running = false;
        recognition = null;
        onListeningChange(false);
        schedule();
      },
    });
    try {
      next.start();
      recognition = next;
      running = true;
      onListeningChange(true);
    } catch {
      running = false;
      recognition = null;
      active = false;
      onListeningChange(false);
      onError('Không thể mở micro. Vui lòng thử lại hoặc nhập bằng bàn phím.');
    }
  };
  return {
    start() { active = true; paused = false; begin(); },
    pause() {
      paused = true;
      if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null; }
      if (running) { try { recognition?.stop(); } catch { /* already stopped */ } }
    },
    resume() { if (!active) return; paused = false; if (!running) schedule(); },
    stop() {
      active = false; paused = false;
      if (restartTimer !== null) { clearTimeout(restartTimer); restartTimer = null; }
      try { recognition?.abort(); } catch { /* already ended */ }
      recognition = null; running = false;
      onListeningChange(false);
    },
    isActive() { return active; },
  };
}

const spokenTime = (hour, minute) => {
  const hourText = `${Number(hour)} giờ`;
  return minute === '00' ? hourText : `${hourText} ${Number(minute)} phút`;
};

const spokenCode = (value) => String(value || '').replace(/[^A-Z0-9]/gi, '')
  .toUpperCase().split('').join(' ');

export function formatAiBookingSpeech(value) {
  let message = String(value || '').trim();
  message = message
    .replace(
      /Vehicle\s+([A-Z0-9.-]+)\s+is already in a VIP subscription\.\s*Please use your VIP parking slot instead of making a new booking\.?/gi,
      'Xe $1 đang có gói ưu tiên. Hãy dùng ô đỗ ưu tiên hoặc chọn biển số khác.',
    )
    .replace(/Slot already booked\.?/gi, 'Ô đỗ đã có người đặt.')
    .replace(/Too late to cancel\.?/gi, 'Đã quá thời hạn hủy.')
    .replace(/Payment failed\.?/gi, 'Thanh toán không thành công.')
    .replace(/\bMy\s+Bookings\b/gi, 'trang đặt chỗ của bạn')
    .replace(/\bFloor\s+([A-Za-z]?\d+)\b/gi, (_, floor) => `tầng ${spokenCode(floor)}`)
    .replace(/\bPAID\b/gi, 'đã thanh toán')
    .replace(/\bVIP\b/gi, 'gói ưu tiên')
    .replace(/\b(Mã|mã)\s+QR\b/g, '$1 quy a')
    .replace(/\bQR\b/gi, 'mã quy a')
    .replace(/\bbookings\b/gi, 'các lượt đặt chỗ')
    .replace(/\bbooking\b/gi, 'lượt đặt chỗ')
    .replace(/\bslot\b/gi, 'ô đỗ')
    .replace(/\bOK\b/gi, 'ô kê')
    .replace(/\bVALO\b/g, 'Va lô')
    .replace(
      /\b([01]?\d|2[0-3]):([0-5]\d)\s*[\u2013\u2014-]\s*([01]?\d|2[0-3]):([0-5]\d)\b/g,
      (_, startHour, startMinute, endHour, endMinute) => (
        `${spokenTime(startHour, startMinute)} đến ${spokenTime(endHour, endMinute)}`
      ),
    )
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, hour, minute) => spokenTime(hour, minute))
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
      (_, day, month, year) => `ngày ${Number(day)} tháng ${Number(month)} năm ${year}`)
    .replace(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:đ|VND)(?=\s|[.,;!?]|$)/gi,
      (_, amount) => `${amount.replace(/\./g, '')} đồng`)
    .replace(/\b([Xx]e)\s+([0-9]{2}[A-Z]{1,2}[0-9]{4,6})\b/g,
      (_, prefix, plate) => `${prefix} ${spokenCode(plate)}`)
    .replace(/([Ôô])\s+([A-Z]{1,2}\d{1,4})\b/g,
      (_, prefix, code) => `${prefix} ${spokenCode(code)}`)
    .replace(/\s*[\u00b7•]\s*/g, ', ')
    .replace(/^\s*-\s*/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .trim();
  return message;
}

// Kept as a public helper for tests and callers; every response is now one
// Vietnamese utterance to avoid pauses caused by switching voices mid-sentence.
export function splitAiBookingSpeechSegments(value) {
  const text = formatAiBookingSpeech(value);
  return text ? [{ text, lang: 'vi-VN' }] : [];
}

export function createAiBookingSpeaker(browser, { onStart, onEnd, onError } = {}) {
  const synthesis = browser?.speechSynthesis;
  const Utterance = browser?.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance) return null;
  let active = null;
  const vietnameseVoice = () => {
    const voices = synthesis.getVoices?.() || [];
    const matching = voices.filter((voice) => /^vi[-_]/i.test(voice.lang));
    return matching.find((voice) => /hoai|nam|minh|vietnam|google/i.test(voice.name || ''))
      || matching.find((voice) => voice.localService !== false)
      || matching[0];
  };
  return {
    speak(value) {
      const message = String(value || '').trim();
      this.cancel();
      if (!message) return;
      const utterance = new Utterance(formatAiBookingSpeech(message));
      utterance.lang = 'vi-VN';
      utterance.rate = 1.18;
      utterance.pitch = 1;
      utterance.volume = 1;
      const selectedVoice = vietnameseVoice();
      if (selectedVoice) utterance.voice = selectedVoice;
      active = utterance;
      utterance.onstart = () => { if (active === utterance) onStart?.(); };
      utterance.onend = () => { if (active === utterance) { active = null; onEnd?.(); } };
      utterance.onerror = () => { if (active === utterance) { active = null; onError?.(); } };
      try { synthesis.speak(utterance); }
      catch { active = null; onError?.(); }
    },
    cancel() {
      if (!active) return;
      active = null;
      synthesis.cancel();
      onEnd?.();
    },
  };
}
