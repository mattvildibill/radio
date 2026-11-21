import {save} from '/assets/library.js';
import {REPORT_KEY} from '/assets/verification.js';
document.getElementById('test').onclick = async () => {
  const result = document.getElementById('result');
  try {
    const context = new AudioContext(); await context.resume();
    const mix = context.createMediaStreamDestination();
    const speakers = [330, 440].map(frequency => {
      const oscillator = context.createOscillator(), level = context.createGain();
      oscillator.frequency.value = frequency; level.gain.value = 0.06;
      oscillator.connect(level); level.connect(mix); oscillator.start(); return oscillator;
    });
    const chunks = [], recorder = new MediaRecorder(mix.stream, {mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000});
    recorder.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise(resolve => recorder.onstop = resolve);
    recorder.start(); result.textContent = 'Recording two test tones…';
    await new Promise(resolve => setTimeout(resolve, 3000));
    recorder.stop(); await stopped; speakers.forEach(s => s.stop()); await context.close();
    const audio = new Blob(chunks, {type: recorder.mimeType});
    await save({id: 'local-browser-verification', title: 'TEST ONLY · two-tone mixed recording', question: 'Local persistence test, no OpenAI call',
      createdAt: new Date().toISOString(), timezone: 'America/Denver', duration: 3, complete: true,
      researchedAt: new Date().toISOString(), sources: [{title: 'Web Audio documentation (test reference)', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API'}],
      mimeType: recorder.mimeType, audio});
    localStorage.setItem(REPORT_KEY, JSON.stringify({recordingId: 'local-browser-verification', events: [], transcripts: [], usage: [null, null],
      error: 'LOCAL TONE FIXTURE ONLY. No host speech, research, or provider calls. Only recording persistence is being checked.', replay: {}}));
    result.textContent = 'Saved ' + audio.size + ' bytes to the actual private library. Open it, reload, and play the recording.';
  } catch(e) { result.textContent = 'FAILED: ' + e.message; }
};
