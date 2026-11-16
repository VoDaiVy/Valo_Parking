import { createAiBookingVoiceSession } from './aiBookingVoice.js';

export function createSpeechBoundary({ silenceMs = 900, maxMs = 18000 } = {}) {
  let startedAt = null;
  let lastSpeech = null;
  let voicedFrames = 0;
  return {
    sample(level, now) {
      startedAt ??= now;
      if (level >= 0.015) { lastSpeech = now; voicedFrames += 1; }
      else if (voicedFrames < 2 && lastSpeech !== null && now - lastSpeech > 300) voicedFrames = 0;
      const heardSpeech = voicedFrames >= 2;
      return { heardSpeech, finished: (heardSpeech && now - lastSpeech >= silenceMs) || now - startedAt >= maxMs };
    },
  };
}

const blobBase64 = (browser, blob) => new Promise((resolve, reject) => {
  const reader = new browser.FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Unable to read microphone recording'));
  reader.readAsDataURL(blob);
});

// The recording is transcribed without a fixed recognition language. Each
// utterance can switch between VI and EN, including the first spoken turn.
export function createAutoLanguageVoiceSession(browser, { onTranscript, onError, onListeningChange, transcribe, onTranscribingChange = () => {}, onClarification = () => {} }) {
  const AudioContext = browser?.AudioContext || browser?.webkitAudioContext;
  if (!browser?.MediaRecorder || !browser?.navigator?.mediaDevices?.getUserMedia || !AudioContext) {
    return createAiBookingVoiceSession(browser, { onTranscript, onError, onListeningChange, onClarification, automaticLanguage: true });
  }
  let active = false, paused = false, generation = 0;
  let language = 'en', stream = null, context = null, source = null, analyser = null, recorder = null, timer = null;
  let fallback = null, expectPlate = false, phrases = [];
  const clearMeter = () => { if (timer !== null) browser.clearInterval(timer); timer = null; };
  const stop = () => {
    fallback?.stop(); fallback = null;
    active = false; paused = false; generation++;
    clearMeter();
    if (recorder?.state === 'recording') recorder.stop();
    recorder = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    source?.disconnect(); source = null; analyser = null;
    context?.close().catch(() => {}); context = null;
    onListeningChange(false);
    onTranscribingChange(false);
  };
  const fail = (message) => { stop(); onError(message); };
  const activateBrowserFallback = () => {
    const native = createAiBookingVoiceSession(browser, { onTranscript, onError, onListeningChange, onClarification, automaticLanguage: true });
    if (!native) return false;
    stop();
    fallback = native;
    native.setLanguage(language); native.setExpectLicensePlate(expectPlate); native.setContextPhrases(phrases);
    native.start();
    return true;
  };
  const record = () => {
    if (!active || paused || !stream || recorder?.state === 'recording') return;
    const token = generation;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find((value) => browser.MediaRecorder.isTypeSupported?.(value));
    const current = new browser.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder = current;
    const chunks = [];
    const boundary = createSpeechBoundary();
    let heardSpeech = false, heardSound = false;
    current.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    current.onerror = () => fail(language === 'vi' ? 'Không thể ghi âm. Vui lòng thử lại hoặc nhập bằng bàn phím.' : 'Unable to record audio. Please try again or type your request.');
    current.onstop = async () => {
      if (token !== generation) { if (recorder === current) recorder = null; return; }
      clearMeter();
      if (recorder === current) recorder = null;
      if (!active || paused || token !== generation) return;
      onListeningChange(false);
      if (!heardSpeech) {
        if (!heardSound) { record(); return; }
        paused = true; stream.getTracks().forEach((track) => { track.enabled = false; });
        onClarification(); return;
      }
      paused = true;
      onTranscribingChange(true);
      stream.getTracks().forEach((track) => { track.enabled = false; });
      try {
        const blob = new browser.Blob(chunks, { type: current.mimeType });
        if (blob.size > 3 * 1024 * 1024) throw new Error(language === 'vi' ? 'Đoạn nói quá dài. Vui lòng nói lại ngắn hơn.' : 'The recording is too long. Please try a shorter request.');
        const audio = await blobBase64(browser, blob);
        if (!active || token !== generation) return;
        const response = await transcribe(audio, current.mimeType, language);
        if (!active || token !== generation) return;
        if (!response.ok) {
          if ([0, 404, 429, 502, 503].includes(response.status) && activateBrowserFallback()) return;
          throw new Error(response.data?.message || (language === 'vi' ? 'Không nhận được giọng nói. Vui lòng thử lại.' : 'Unable to recognize speech. Please try again.'));
        }
        const data = response.data?.data || {};
        onTranscribingChange(false);
        if (!data.transcript || data.needsRepeat) { onClarification(); return; }
        language = data.language === 'vi' ? 'vi' : 'en';
        onTranscript(data.transcript, language);
      } catch (error) { if (active && token === generation && !activateBrowserFallback()) fail(error.message); }
    };
    current.start();
    onListeningChange(true);
    const samples = new Float32Array(analyser.fftSize);
    timer = browser.setInterval(() => {
      if (!active || paused || token !== generation) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      heardSound ||= rms >= 0.015;
      const state = boundary.sample(rms, Date.now());
      heardSpeech = state.heardSpeech;
      if (state.finished) { clearMeter(); if (current.state === 'recording') current.stop(); }
    }, 80);
  };
  const start = async () => {
    if (fallback) { fallback.start(); return; }
    if (active) return;
    active = true; paused = false;
    const token = ++generation;
    try {
      context = new AudioContext();
      await context.resume();
      const acquired = await browser.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!active || token !== generation) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream = acquired;
      analyser = context.createAnalyser(); analyser.fftSize = 2048;
      source = context.createMediaStreamSource(stream); source.connect(analyser);
      record();
    } catch { if (active && token === generation) fail(language === 'vi' ? 'Không thể mở micro. Vui lòng cấp quyền micro hoặc nhập bằng bàn phím.' : 'Unable to open the microphone. Please allow microphone access or type your request.'); }
  };
  return {
    start, stop, isActive: () => fallback ? fallback.isActive() : active,
    pause() {
      if (fallback) { fallback.pause(); return; }
      paused = true; generation++; clearMeter();
      onTranscribingChange(false);
      stream?.getTracks().forEach((track) => { track.enabled = false; });
      if (recorder?.state === 'recording') recorder.stop();
      onListeningChange(false);
    },
    resume() {
      if (fallback) { fallback.resume(); return; }
      if (!active || !stream) return;
      paused = false;
      stream.getTracks().forEach((track) => { track.enabled = true; });
      try { record(); } catch (error) { fail(error.message); }
    },
    setLanguage(value) { language = value === 'vi' ? 'vi' : 'en'; fallback?.setLanguage(language); },
    setExpectLicensePlate(value) { expectPlate = Boolean(value); fallback?.setExpectLicensePlate(value); },
    setContextPhrases(value) { phrases = value; fallback?.setContextPhrases(value); },
  };
}
