const speechLocale = (language) => (language === 'en' || language === 'en-US' ? 'en-US' : 'vi-VN');

const englishParkingTerms = /\b(?:book|booking|reserve|reservation|park|parking|spot|space|slot|vehicle|car|license|plate|availability|available|wallet|balance|fee|price|location|where|cancel|change|modify|confirm|tomorrow|today|morning|afternoon|evening|night|floor|entry|exit|arrive|leave)\b/gi;

// Browser speech recognition often turns short booking phrases into nearby
// sounding words. These corrections are deliberately context-bound so dates,
// times, plate numbers and unrelated free text are never guessed.
export function normalizeEnglishVoiceTranscript(transcript) {
  let text = String(transcript || '').trim();
  if (!text) return '';
  text = text
    .replace(/\bi\s+(?:nick|neat|knead)\s+(?=book)/gi, 'I need to ')
    .replace(/\bi\s+(?:nick|neat|knead)\b/gi, 'I need')
    .replace(/\bi\s+(?:one|won)\s+to\s+(?=book|reserve|park)/gi, 'I want to ')
    .replace(/\bi\s+want\s+a\s+(?=book\b)/gi, 'I want to ')
    .replace(/\b(?:book\s*wonder|book\s*wander|bookwonder|bookwander)\b/gi, 'book a parking space')
    .replace(/\bparking\s+(?:sport|sports|spock|stop)\b/gi, 'parking spot')
    .replace(/\bparking\s+(?:spice|pace)\b/gi, 'parking space')
    .replace(/\bbook\s+kings?\b/gi, 'bookings')
    .replace(/\blicen[cs]e\s+(?:place|played|plain)\b/gi, 'license plate')
    .replace(/\bnumber\s+plate\b/gi, 'license plate')
    .replace(/\bwallet\s+balanced\b/gi, 'wallet balance')
    .replace(/\bwhere\s+is\s+my\s+card\b/gi, 'where is my car')
    .replace(/\bhow\s+(?:match|mash)\b/gi, 'how much')
    .replace(/\bcouncil\s+my\s+booking\b/gi, 'cancel my booking')
    .replace(/\b(?:my\s+)?(?:cooking|looking)\b/gi, (value) => (/^my\s/i.test(value) ? 'my booking' : 'booking'))
    .replace(/\bto\s+morrow\b/gi, 'tomorrow')
    .replace(/\bfor\s+(?:too|to)\s+hours?\b/gi, 'for two hours')
    .replace(/\b(?:cancel|change|modify|show|view|check)\s+my\s+book\s+in\b/gi,
      (value) => value.replace(/book\s+in/i, 'booking'))
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

const englishVoiceScore = (value) => {
  const normalized = normalizeEnglishVoiceTranscript(value);
  const terms = normalized.match(englishParkingTerms)?.length || 0;
  const intentPhrase = /\b(?:want|need|like|please|can you|could you)\b.*\b(?:book|reserve|park|check|show|cancel|change|modify)\b/i.test(normalized)
    || /\b(?:where is|how much|how long|is there|are there|do i have)\b/i.test(normalized);
  const structured = /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(normalized);
  const suspicious = /\b(?:wonder|wander|nick|knead|cooking|looking)\b/i.test(normalized);
  return terms * 12 + (intentPhrase ? 30 : 0) + (structured ? 12 : 0) - (suspicious ? 20 : 0);
};

export function selectEnglishVoiceTranscript(alternatives = []) {
  const candidates = alternatives.map((alternative, index) => ({
    transcript: normalizeEnglishVoiceTranscript(alternative?.transcript ?? alternative),
    confidence: Number(alternative?.confidence || 0),
    index,
  })).filter((candidate) => candidate.transcript);
  candidates.sort((left, right) => (
    (englishVoiceScore(right.transcript) + right.confidence * 5)
    - (englishVoiceScore(left.transcript) + left.confidence * 5)
  ) || left.index - right.index);
  return candidates[0]?.transcript || '';
}

export function resolveEnglishVoicePlateTranscript(transcript, vehicles = [], existingPlates = []) {
  const original = String(transcript || '').trim();
  const heardDigits = original.replace(/\D/g, '');
  if (!/^\d{6,8}$/.test(heardDigits)) return original;
  const used = new Set((existingPlates || []).map((plate) => String(plate || '').replace(/\W/g, '').toUpperCase()));
  const candidates = vehicles
    .filter((vehicle) => !vehicle?.status || vehicle.status === 'approved')
    .map((vehicle) => String(vehicle?.licensePlate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase())
    .filter((plate) => /^[1-9]\d[A-Z]{1,2}\d{4,5}$/.test(plate) && !used.has(plate))
    .filter((plate) => {
      const match = plate.match(/^(\d{2})([A-Z]{1,2})(\d{4,5})$/);
      if (!match) return false;
      const [, province, letters, finalDigits] = match;
      const confusedLetters = [...letters].map((letter) => ({ A: '8', B: '3', C: '3' }[letter] || '')).join('');
      const signatures = new Set([
        `${province}${finalDigits}`,
        ...(confusedLetters ? [`${province}${confusedLetters}${finalDigits}`] : []),
      ]);
      return signatures.has(heardDigits);
    });
  return candidates.length === 1 ? candidates[0] : original;
}

export function createAiBookingRecognition(browser, {
  onTranscript, onError, onEnd, continuous = false, language = 'vi', expectLicensePlate = false,
}) {
  const SpeechRecognition = browser?.SpeechRecognition || browser?.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.lang = speechLocale(language);
  recognition.continuous = continuous;
  recognition.interimResults = false;
  recognition.maxAlternatives = language === 'en' ? 5 : 1;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex || 0; index < (event.results?.length || 0); index += 1) {
      const result = event.results[index];
      if (result.isFinal === false) continue;
      const rawAlternatives = Array.from(result || []).filter((alternative) => (
        String(alternative?.transcript || '').trim()
      ));
      const alternatives = rawAlternatives.map((alternative) => String(alternative.transcript).trim());
      const transcript = expectLicensePlate && language === 'en'
        ? alternatives.sort((left, right) => {
          const score = (value) => {
            const nato = /\b(?:alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliett?|kilo|lima|mike|november|oscar|papa|quebec|romeo|sierra|tango|uniform|victor|whiskey|xray|yankee|zulu)\b/i.test(value);
            const explicitLetter = /\d{2}[\s,.-]*[a-z][\s,.-]*\d{4,5}\b/i.test(value)
              || /\b\d{2}[a-z]{1,2}\d{4,5}\b/i.test(value);
            const digitsOnly = /^\s*(?:\d[\s,.-]*){6,8}\s*$/.test(value);
            return (nato ? 100 : 0) + (explicitLetter ? 80 : 0) - (digitsOnly ? 20 : 0);
          };
          return score(right) - score(left);
        })[0]
        : language === 'en' ? selectEnglishVoiceTranscript(rawAlternatives) : alternatives[0];
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
  let language = 'vi';
  let expectLicensePlate = false;
  const schedule = () => {
    if (!active || paused || restartTimer !== null) return;
    restartTimer = setTimeout(() => { restartTimer = null; begin(); }, restartDelayMs);
  };
  const begin = () => {
    if (!active || paused || running) return;
    const next = createAiBookingRecognition(browser, {
      continuous: true,
      language,
      expectLicensePlate,
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
    setLanguage(value) {
      const nextLanguage = value === 'en' ? 'en' : 'vi';
      if (language === nextLanguage) return;
      language = nextLanguage;
      if (running) {
        try { recognition?.stop(); } catch { /* already stopped */ }
      } else if (active && !paused) schedule();
    },
    setExpectLicensePlate(value) {
      const nextValue = Boolean(value);
      if (expectLicensePlate === nextValue) return;
      expectLicensePlate = nextValue;
      if (running) {
        try { recognition?.stop(); } catch { /* already stopped */ }
      } else if (active && !paused) schedule();
    },
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

function formatEnglishBookingSpeech(value) {
  return String(value || '').trim()
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, hour, minute) => {
      const date = new Date(`2000-01-01T${String(hour).padStart(2, '0')}:${minute}:00`);
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
    })
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, day, month, year) => (
      new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`))
    ))
    .replace(/\b([0-9]{2}[A-Z]{1,2}[0-9]{4,6})\b/g, (plate) => spokenCode(plate))
    .replace(/\s*[\u00b7•]\s*/g, ', ')
    .replace(/^\s*-\s*/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatAiBookingSpeech(value, language = 'vi') {
  if (language === 'en') return formatEnglishBookingSpeech(value);
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
export function splitAiBookingSpeechSegments(value, language = 'vi') {
  const text = formatAiBookingSpeech(value, language);
  return text ? [{ text, lang: speechLocale(language) }] : [];
}

export function createAiBookingSpeaker(browser, { onStart, onEnd, onError } = {}) {
  const synthesis = browser?.speechSynthesis;
  const Utterance = browser?.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance) return null;
  let active = null;
  const matchingVoice = (language) => {
    const voices = synthesis.getVoices?.() || [];
    const locale = language === 'en' ? /^en[-_]/i : /^vi[-_]/i;
    const preferred = language === 'en' ? /google|microsoft|natural|samantha|daniel/i : /hoai|nam|minh|vietnam|google/i;
    const matching = voices.filter((voice) => locale.test(voice.lang));
    return matching.find((voice) => preferred.test(voice.name || ''))
      || matching.find((voice) => voice.localService !== false)
      || matching[0];
  };
  return {
    speak(value, language = 'vi') {
      const message = String(value || '').trim();
      this.cancel();
      if (!message) return;
      const utterance = new Utterance(formatAiBookingSpeech(message, language));
      utterance.lang = speechLocale(language);
      utterance.rate = language === 'en' ? 1.05 : 1.18;
      utterance.pitch = 1;
      utterance.volume = 1;
      const selectedVoice = matchingVoice(language);
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
