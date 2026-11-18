import { createAiBookingRecognition, createAiBookingVoiceSession } from './aiBookingVoice.js';
import { detectBookingInputLanguage } from './aiBookingLanguage.js';
import { canUseFastBookingSpeech } from './aiBookingSpeechLanguage.js';

export function createSpeechBoundary({ silenceMs = 900, maxMs = 18000 } = {}) {
  let startedAt = null, lastSpeech = null, voicedFrames = 0;
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
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const blobBase64 = (browser, blob) => new Promise((resolve, reject) => {
  const reader = new browser.FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Unable to read microphone recording'));
  reader.readAsDataURL(blob);
});

// Warm recognition before listening, then keep the original recording until a
// final browser result or the bounded Gemini fallback has finished.
export function createAutoLanguageVoiceSession(browser, {
  onTranscript, onError, onListeningChange, transcribe,
  onPreparingChange = () => {}, onTranscribingChange = () => {}, onClarification = () => {},
  transcriptionTimeoutMs = 20000, nativeStartupTimeoutMs = 2500, nativeFinalWaitMs = 700,
}) {
  const AudioContext = browser?.AudioContext || browser?.webkitAudioContext;
  if (!browser?.MediaRecorder || !browser?.navigator?.mediaDevices?.getUserMedia || !AudioContext) {
    return createAiBookingVoiceSession(browser, {
      onTranscript, onError, onListeningChange, onClarification, automaticLanguage: true,
    });
  }
  const later = browser.setTimeout?.bind(browser) || setTimeout;
  const cancelLater = browser.clearTimeout?.bind(browser) || clearTimeout;
  let active = false, paused = false, generation = 0;
  let verifiedSpeechLanguage = null;
  let language = 'en', stream = null, context = null, source = null, analyser = null, recorder = null, meter = null;
  let preparation = null, transcriptionController = null;
  let recognition = null, settleRecognition = null, nativeDisabled = false, expectPlate = false, phrases = [];
  const stopRecognition = () => {
    const current = recognition, settle = settleRecognition;
    recognition = null; settleRecognition = null;
    settle?.();
    try { current?.abort(); } catch { /* It may already have ended. */ }
  };
  const clearMeter = () => { if (meter !== null) browser.clearInterval(meter); meter = null; };
  const stop = () => {
    active = false; paused = false; generation++; preparation = null;
    stopRecognition();
    transcriptionController?.abort(); transcriptionController = null;
    clearMeter();
    if (recorder?.state === 'recording') recorder.stop();
    recorder = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    source?.disconnect(); source = null; analyser = null;
    context?.close().catch(() => {}); context = null;
    onPreparingChange(false); onListeningChange(false); onTranscribingChange(false);
  };
  const fail = (message) => { stop(); onError(message); };
  const record = async () => {
    if (!active || !stream || recorder) return;
    const token = generation;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find((value) => browser.MediaRecorder.isTypeSupported?.(value));
    const current = new browser.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder = current;
    const ownsTurn = () => active && token === generation && recorder === current;
    const chunks = [], readiness = deferred(), finalResult = deferred();
    const boundary = createSpeechBoundary();
    let accepting = false, heardSpeech = false, fastTranscript = '';
    let nativeReady = false, nativeRejected = false, nativeEnded = false;
    current.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    current.onerror = () => {
      if (ownsTurn()) fail(language === 'vi' ? 'Không thể ghi âm. Vui lòng thử lại hoặc nhập bằng bàn phím.' : 'Unable to record audio. Please try again or type your request.');
    };
    current.onstop = async () => {
      if (!ownsTurn()) { if (recorder === current) recorder = null; return; }
      clearMeter();
      stream.getTracks().forEach((track) => { track.enabled = false; });
      onListeningChange(false);
      // stop() asks for the final text; abort() would discard a first-turn
      // result that is still being returned by a cold recognition service.
      if (nativeReady && !nativeRejected && !nativeEnded && !fastTranscript && heardSpeech && recognition) {
        onTranscribingChange(true);
        let timer;
        try {
          const timeout = new Promise((resolve) => { timer = later(resolve, nativeFinalWaitMs); });
          recognition.stop();
          await Promise.race([finalResult.promise, timeout]);
        } catch { /* The original recording remains available. */ }
        finally { if (timer !== undefined) cancelLater(timer); }
      }
      if (!ownsTurn()) return;
      recorder = null; accepting = false; paused = true; stopRecognition();
      if (fastTranscript) {
        onTranscribingChange(false);
        language = detectBookingInputLanguage(fastTranscript, verifiedSpeechLanguage || language).language;
        onTranscript(fastTranscript, language);
        return;
      }
      if (!heardSpeech) {
        // An isolated click, device warmup or room noise is not a failed
        // user request. Keep listening without creating an empty chat turn.
        onTranscribingChange(false); paused = false;
        await prepareRecord();
        return;
      }
      onTranscribingChange(true);
      const controller = new AbortController();
      transcriptionController = controller;
      let deadline;
      try {
        const blob = new browser.Blob(chunks, { type: current.mimeType });
        if (blob.size > 3 * 1024 * 1024) throw new Error(language === 'vi' ? 'Đoạn nói quá dài. Vui lòng nói lại ngắn hơn.' : 'The recording is too long. Please try a shorter request.');
        const audio = await blobBase64(browser, blob);
        if (!active || token !== generation) return;
        const timeout = new Promise((_, reject) => {
          deadline = later(() => {
            reject(new Error(language === 'vi' ? 'Nhận giọng nói mất quá lâu. Vui lòng thử lại hoặc nhập bằng bàn phím.' : 'Speech recognition took too long. Please try again or type your request.'));
            controller.abort();
          }, transcriptionTimeoutMs);
        });
        const response = await Promise.race([transcribe(audio, current.mimeType, language, { signal: controller.signal, contextPhrases: phrases }), timeout]);
        if (!active || token !== generation) return;
        if (!response.ok) throw new Error(response.data?.message || (language === 'vi' ? 'Dịch vụ nhận giọng nói tạm thời không khả dụng. Vui lòng thử lại.' : 'Speech recognition is temporarily unavailable. Please try again.'));
        const data = response.data?.data || {};
        onTranscribingChange(false);
        if (['vi', 'en'].includes(data.language)) language = data.language;
        if (!data.transcript || data.needsRepeat) { onClarification(language); return; }
        if (['vi', 'en'].includes(data.language)) verifiedSpeechLanguage = data.language;
        onTranscript(data.transcript, language);
      } catch (error) { if (active && token === generation) fail(error.message); }
      finally {
        if (deadline !== undefined) cancelLater(deadline);
        if (transcriptionController === controller) { transcriptionController = null; onTranscribingChange(false); }
      }
    };

    if (!nativeDisabled && verifiedSpeechLanguage) {
      let startupTimer;
      try {
        let candidate;
        const ownsRecognition = () => ownsTurn() && recognition === candidate;
        const canAccept = () => ownsRecognition() && accepting && !paused && heardSpeech;
        const finish = () => {
          finalResult.resolve();
          if (current.state === 'recording') current.stop();
        };
        candidate = createAiBookingRecognition(browser, {
          language: verifiedSpeechLanguage, continuous: true, automaticLanguage: true, expectLicensePlate: expectPlate, contextPhrases: phrases,
          onAudioStart: () => { if (ownsRecognition()) { nativeReady = true; readiness.resolve(); } },
          onSpeechStart: () => { if (ownsRecognition() && accepting && !paused) heardSpeech = true; },
          onTranscript: (text) => {
            if (!canAccept()) return;
            if (canUseFastBookingSpeech(text, verifiedSpeechLanguage)) fastTranscript = text;
            else nativeRejected = true;
            finish();
          },
          onClarification: () => { if (canAccept()) { nativeRejected = true; finish(); } },
          onError: () => { if (ownsRecognition()) { nativeDisabled = true; nativeRejected = true; stopRecognition(); } },
          onEnd: () => { if (ownsRecognition()) { nativeEnded = true; stopRecognition(); } },
        });
        if (candidate) {
          recognition = candidate;
          settleRecognition = () => { readiness.resolve(); finalResult.resolve(); };
          startupTimer = later(() => { if (ownsRecognition()) { nativeDisabled = true; stopRecognition(); } }, nativeStartupTimeoutMs);
          candidate.start();
          await readiness.promise;
        }
      } catch { nativeDisabled = true; stopRecognition(); }
      finally { if (startupTimer !== undefined) cancelLater(startupTimer); }
    }
    if (!ownsTurn()) return;
    stream.getTracks().forEach((track) => { track.enabled = true; });
    paused = false; accepting = true;
    current.start();
    onPreparingChange(false); onListeningChange(true);
    const samples = new Float32Array(analyser.fftSize);
    meter = browser.setInterval(() => {
      if (!ownsTurn() || paused) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      const state = boundary.sample(rms, Date.now());
      heardSpeech ||= state.heardSpeech;
      if (state.finished) { clearMeter(); if (current.state === 'recording') current.stop(); }
    }, 80);
  };
  const prepareRecord = () => {
    if (!active || !stream || preparation || recorder || transcriptionController) return;
    const pending = { generation }; preparation = pending; paused = true;
    stream.getTracks().forEach((track) => { track.enabled = false; });
    onPreparingChange(true);
    return record().catch((error) => {
      if (active && pending.generation === generation) fail(error.message);
    }).finally(() => { if (preparation === pending) preparation = null; });
  };
  const start = async () => {
    if (active) return;
    active = true; paused = false; nativeDisabled = false;
    const token = ++generation;
    onPreparingChange(true);
    try {
      context = new AudioContext(); await context.resume();
      const acquired = await browser.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!active || token !== generation) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream = acquired;
      analyser = context.createAnalyser(); analyser.fftSize = 2048;
      source = context.createMediaStreamSource(stream); source.connect(analyser);
      await prepareRecord();
    } catch {
      if (active && token === generation) fail(language === 'vi' ? 'Không thể mở micro. Vui lòng cấp quyền micro hoặc nhập bằng bàn phím.' : 'Unable to open the microphone. Please allow microphone access or type your request.');
    }
  };
  return {
    start, stop, isActive: () => active,
    pause() {
      paused = true; generation++; preparation = null;
      clearMeter(); stopRecognition();
      transcriptionController?.abort(); transcriptionController = null;
      onPreparingChange(false); onTranscribingChange(false);
      stream?.getTracks().forEach((track) => { track.enabled = false; });
      if (recorder?.state === 'recording') recorder.stop();
      recorder = null;
      onListeningChange(false);
    },
    resume() { if (!active || !stream) return; return prepareRecord(); },
    setLanguage(value) { language = value === 'vi' ? 'vi' : 'en'; },
    setExpectLicensePlate(value) { expectPlate = Boolean(value); },
    setContextPhrases(value) { phrases = Array.isArray(value) ? value : []; },
  };
}
