export function createAiBookingRecognition(browser, { onTranscript, onError, onEnd }) {
  const SpeechRecognition = browser?.SpeechRecognition || browser?.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.lang = 'vi-VN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
    if (transcript) onTranscript(transcript);
  };
  recognition.onerror = (event) => onError(event.error === 'not-allowed'
    ? 'Vui lòng cấp quyền micro cho trang web.'
    : 'Không nghe rõ giọng nói. Vui lòng thử lại.');
  recognition.onend = onEnd;
  return recognition;
}
