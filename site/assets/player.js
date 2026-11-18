import {FloorController, duration, ago, safeSource} from './controller.js';
import * as library from './library.js';
const $ = id => document.getElementById(id);
const names = ['Mara', 'Eli'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let show = null, run = null, recording = null, pendingFollowup = '', urls = [];
let notes = {events: [], transcripts: [], usage: [null, null]};
let lastTranscript = null;

async function api(path, payload, options = {}) {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), ...options});
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The request could not be completed.');
  return data;
}
function log(type, data = {}) {
  notes.events.push({at: new Date().toISOString(), type, ...data});
}
function fail(error) { $('error').textContent = error instanceof Error ? error.message : String(error); }
function setStatus(text) { $('status').textContent = text; }
function send(host, type, content) {
  if (!host || host.dc.readyState !== 'open') return false;
  host.dc.send(JSON.stringify({type, ...(content === undefined ? {} : {content, delegation_id: null}), event_id: crypto.randomUUID()}));
  return true;
}
function sourceList(target, sources) {
  target.replaceChildren();
  for (const source of sources || []) {
    if (!safeSource(source.url)) continue;
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = source.title; li.append(a); target.append(li);
  }
}
function renderResearch() {
  $('research').hidden = false;
  $('research-title').textContent = show.brief.title;
  $('research-date').textContent = 'RESEARCHED ' + new Date(show.researched_at).toLocaleString();
  $('brief').replaceChildren();
  for (const [key, value] of Object.entries(show.brief)) {
    if (key === 'title') continue;
    const p = document.createElement('p'), title = document.createElement('strong');
    title.textContent = key.replaceAll('_', ' ') + ': ';
    p.append(title, document.createTextNode(value)); $('brief').append(p);
  }
  sourceList($('sources'), show.sources);
}
function renderUsage() {
  const usage = {research: show?.research_usage || null, web_search_calls: show?.search_calls || 0,
    voice: notes.usage.map((u, i) => ({host: names[i], ...u}))};
  $('usage').textContent = JSON.stringify(usage, null, 2);
}
function transcript(index, e) {
  // Input transcripts are evidence of what each host actually heard. Output
  // fragments are captions, not an invented completed-turn transcript.
  notes.transcripts.push({host: names[index], type: e.type, delta: e.delta, start_ms: e.start_ms, end_ms: e.end_ms});
  if (e.type !== 'session.output_transcript.delta') return;
  if (!lastTranscript || lastTranscript.index !== index) {
    const p = document.createElement('p'), strong = document.createElement('strong'), span = document.createElement('span');
    strong.textContent = names[index] + ': '; p.append(strong, span); $('transcript').append(p);
    lastTranscript = {index, span};
  }
  lastTranscript.span.append(document.createTextNode(e.delta));
}
async function iceComplete(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pc.removeEventListener('icegatheringstatechange', change); reject(new Error('Audio connection setup timed out.')); }, 10000);
    function change() {
      if (pc.iceGatheringState !== 'complete') return;
      clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', change); resolve();
    }
    pc.addEventListener('icegatheringstatechange', change); change();
  });
}
async function connectHost(r, index) {
  const pc = new RTCPeerConnection();
  const dc = pc.createDataChannel('oai-events');
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // The setup promise can reject before SDP has arrived. Attach immediately.
  ready.catch(() => {});
  let closedResolve;
  const closed = new Promise(resolve => { closedResolve = resolve; });
  const host = {index, pc, dc, closed, closedResolve, finalized: false, closeTicket: null, ready: false};
  r.hosts[index] = host;
  pc.addTrack(r.inputs[index].stream.getAudioTracks()[0], r.inputs[index].stream);
  pc.ontrack = ({track}) => {
    const stream = new MediaStream([track]);
    host.source = r.context.createMediaStreamSource(stream);
    host.analyser = r.context.createAnalyser(); host.analyser.fftSize = 1024;
    host.samples = new Float32Array(host.analyser.fftSize);
    host.gate = r.context.createGain(); host.gate.gain.value = 0;
    const level = r.context.createGain(); level.gain.value = index === 0 ? 0.85 : 0.9;
    host.source.connect(level); level.connect(host.analyser); host.analyser.connect(host.gate);
    host.gate.connect(r.mix); host.gate.connect(r.inputs[1 - index]);
    // No own-output-to-own-input path; the co-host hears only on-air speech.
    log('media-connected', {host: names[index], routedTo: names[1 - index]});
  };
  dc.onmessage = ({data}) => {
    let e; try { e = JSON.parse(data); } catch { return; }
    if (e.type === 'session.started') {
      host.ready = true; log('session-started', {host: names[index]}); readyResolve();
    } else if (e.type === 'session.closed') {
      host.finalized = true;
      notes.usage[index] = {seconds: e.usage?.seconds, final: true, reason: e.reason};
      log('session-closed', {host: names[index], reason: e.reason}); renderUsage(); closedResolve();
      if (!r.stopping) void stopShow('A host session ended. Both sessions are closing.');
    } else if (e.type === 'session.usage.updated') {
      notes.usage[index] = {seconds: e.usage?.seconds, final: false}; renderUsage();
    } else if (e.type === 'session.input_transcript.delta' || e.type === 'session.output_transcript.delta') {
      transcript(index, e);
    } else if (e.type === 'error') {
      log('provider-error', {host: names[index], code: e.error?.code});
      readyReject(new Error('GPT-Live rejected the session or a command. No retry was made.'));
      void stopShow(/quota|limit|budget|rate/i.test(e.error?.code || '') ? 'OpenAI spend, quota, or rate limit reached. No retries.' : 'A host connection reported an error. Both sessions are closing.');
    } else if (e.type === 'session.delegation.created') {
      // No surprise paid backend calls. The producer brief is the sole source.
      send(host, 'session.thinking.append', 'No further research is available in this show. State uncertainty and discuss only the supplied evidence.');
    }
  };
  dc.onclose = () => {
    readyReject(new Error('The audio event channel disconnected.'));
    if (!r.stopping && !host.finalized) void stopShow('Disconnected. Both host sessions are closing.');
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected'].includes(pc.connectionState) && !r.stopping) void stopShow('Audio disconnected. Both host sessions are closing.');
  };
  await pc.setLocalDescription(await pc.createOffer()); await iceComplete(pc);
  if (r.stopping) return;
  // Do not abort an in-flight session creation: we need its ID to close it even
  // if Stop was pressed before the response reached the browser.
  const result = await api('/api/session', {host: index, sdp: pc.localDescription.sdp, ticket: show.ticket});
  host.closeTicket = result.close_ticket;
  if (r.stopping) { await emergencyClose(host); return; }
  await pc.setRemoteDescription({type: 'answer', sdp: result.transport.sdp});
  let timeout;
  try {
    await Promise.race([ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The host did not become ready.')), 20000); })]);
  } finally { clearTimeout(timeout); }
}
function floor(r, index, turn) {
  if (r.stopping) return;
  const other = 1 - index;
  for (const h of r.hosts) if (h?.gate) h.gate.gain.setTargetAtTime(0, r.context.currentTime, 0.025);
  send(r.hosts[other], 'session.instructions.append', 'LISTEN. Your co-host has the floor now. Stop speaking, listen carefully, and wait silently for your next ON AIR cue.');
  let followup = false;
  if (pendingFollowup) {
    const message = JSON.stringify({listener_followup: pendingFollowup});
    for (const h of r.hosts) send(h, 'session.thinking.append', message);
    log('followup-delivered', {text: pendingFollowup, nextHost: names[index]});
    pendingFollowup = ''; followup = true;
    $('followup-status').textContent = `${names[index]} is taking your follow-up into the next exchange.`;
  }
  const remaining = r.limit - (Date.now() - r.started) / 1000;
  const cue = turn === 1
    ? 'ON AIR. Open with a brief disclosure that Mara and Eli are AI hosts, then frame the listener question through one concrete fact from the brief. Give Eli something specific to question. Speak for about 20 seconds.'
    : remaining < 45
      ? 'ON AIR. Wrap up naturally: one useful takeaway and one unresolved question. Do not introduce a new topic.'
      : 'ON AIR. You have the floor. Respond to one specific thing you just heard your co-host say, then advance the discussion through your angle. About 15–35 seconds; shorter is welcome. ' + (followup ? 'Address the listener follow-up just added to your context, acknowledging uncertainty where the brief cannot answer it.' : 'You can disagree, ask a genuine question, or follow a worthwhile tangent.');
  send(r.hosts[index], 'session.instructions.append', cue);
  r.hosts[index].gate?.gain.setTargetAtTime(1, r.context.currentTime, 0.025);
  log('floor', {host: names[index], turn});
  names.forEach((_, i) => {
    $('host-' + i).classList.toggle('speaking', i === index);
    $('host-' + i).querySelector('.host-state').textContent = i === index ? 'On air' : 'Listening';
  });
}
async function startShow(event) {
  event.preventDefault(); if (run) return;
  document.querySelectorAll('.replay audio').forEach(audio => audio.pause());
  $('error').textContent = ''; $('recording-status').textContent = ''; pendingFollowup = '';
  if (!window.RTCPeerConnection || !window.AudioContext || !window.isSecureContext) {
    fail('This browser needs WebRTC and Web Audio on HTTPS. Try current Chrome or Safari.'); return;
  }
  const context = new AudioContext(); await context.resume();
  const r = {context, hosts: [], inputs: [context.createMediaStreamDestination(), context.createMediaStreamDestination()],
    stopping: false, limit: 540, abort: new AbortController(), started: null};
  run = r; show = null; notes = {events: [], transcripts: [], usage: [null, null]}; lastTranscript = null;
  $('transcript').replaceChildren(); $('start').disabled = true; $('stop').disabled = false; $('question').disabled = true;
  $('research').hidden = true; setStatus('The producer is researching…'); log('research-started');
  r.mix = context.createDynamicsCompressor(); r.mix.threshold.value = -15; r.mix.ratio.value = 4;
  r.master = context.createGain(); r.master.gain.value = Number($('volume').value);
  r.capture = context.createMediaStreamDestination(); r.mix.connect(r.master); r.master.connect(context.destination); r.mix.connect(r.capture);
  try {
    show = await api('/api/research', {question: $('question').value.trim()}, {signal: r.abort.signal});
    if (r.stopping) return;
    log('research-completed', {researched_at: show.researched_at, sources: show.sources.length}); renderResearch(); renderUsage();
    setStatus('Brief ready. Connecting Mara and Eli…');
    r.setup = Promise.allSettled([connectHost(r, 0), connectHost(r, 1)]);
    const results = await r.setup;
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    if (r.stopping) return;
    if (r.hosts.some(h => !h.gate)) throw new Error('Both audio tracks must be ready before the show starts.');
    r.started = Date.now(); r.context.onstatechange = () => {
      if (r.context.state === 'suspended' && !r.stopping) void stopShow('Audio was suspended. Both sessions are closing.');
    };
    r.controller = new FloorController({now: () => Date.now(), onFloor: (i, t) => floor(r, i, t),
      onStop: message => void stopShow(message), onRecover: i => {
        log('silence-recovery', {host: names[i]});
        send(r.hosts[i], 'session.instructions.append', 'ON AIR. The room is quiet. Give a brief response to the last idea you heard, grounded in the brief.');
      }});
    r.controller.start(); setStatus('Live from the studio'); $('signal').classList.add('live');
    $('record').disabled = !window.MediaRecorder; $('followup').disabled = false; $('send').disabled = false;
    r.interval = setInterval(() => {
      const elapsed = (Date.now() - r.started) / 1000;
      $('clock').textContent = duration(elapsed) + ' / 09:00';
      if (elapsed >= r.limit) { void stopShow('The show has finished.'); return; }
      const levels = r.hosts.map(h => {
        h.analyser.getFloatTimeDomainData(h.samples);
        return Math.sqrt(h.samples.reduce((sum, x) => sum + x * x, 0) / h.samples.length);
      });
      r.controller.tick(levels);
      if (Math.floor(elapsed) !== r.lastMeterSecond) {
        r.lastMeterSecond = Math.floor(elapsed);
        log('audio-level', {rms: levels.map(n => Number(n.toFixed(4))), floor: r.controller.active});
      }
    }, 100);
    r.timeout = setTimeout(() => void stopShow('The show has finished.'), r.limit * 1000);
  } catch (error) {
    if (!r.stopping) { fail(error); await stopShow('The show could not start.'); }
  }
}
async function emergencyClose(host) {
  if (!host?.closeTicket || host.hangupSent) return;
  host.hangupSent = true;
  try { await api('/api/close', {ticket: host.closeTicket}, {keepalive: true}); log('server-hangup', {host: names[host.index]}); }
  catch { log('hangup-unconfirmed', {host: names[host.index]}); }
}
async function stopShow(message = 'The show has ended.') {
  const r = run; if (!r || r.stopping) return;
  r.stopping = true; r.abort.abort(); r.controller?.stop(); clearInterval(r.interval); clearTimeout(r.timeout);
  $('stop').disabled = true; $('record').disabled = true; $('send').disabled = true; $('followup').disabled = true;
  setStatus('Closing both host sessions…'); $('signal').classList.remove('live');
  const saved = stopRecording();
  r.master.gain.value = 0;
  for (const h of r.hosts) { if (h?.gate) h.gate.gain.value = 0; if (h?.ready) send(h, 'session.close'); }
  // Also close any host whose creation resolves after Stop was pressed.
  await r.setup;
  await Promise.all(r.hosts.map(async h => {
    if (!h) return;
    if (h.ready && !h.finalized) {
      send(h, 'session.close');
      await Promise.race([h.closed, sleep(8000)]);
    }
    if (!h.finalized) await emergencyClose(h);
    h.dc.close(); h.pc.getSenders().forEach(s => s.track?.stop()); h.pc.getReceivers().forEach(s => s.track?.stop()); h.pc.close();
    if (!h.finalized && notes.usage[h.index]) notes.usage[h.index].final = false;
  }));
  r.inputs.forEach(input => input.stream.getTracks().forEach(t => t.stop()));
  r.capture.stream.getTracks().forEach(t => t.stop()); await r.context.close(); await saved;
  log('show-ended'); renderUsage();
  const incomplete = r.hosts.some(h => h.ready && !h.finalized);
  setStatus(message + (incomplete ? ' Final provider usage is unconfirmed.' : ''));
  names.forEach((_, i) => { $('host-' + i).classList.remove('speaking'); $('host-' + i).querySelector('.host-state').textContent = 'Off air'; });
  run = null; $('start').disabled = false; $('question').disabled = false;
}
function blobLink(blob, filename, title) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); urls.push(a.href);
  a.download = filename; a.textContent = title; return a;
}
async function toggleRecording() {
  $('record').disabled = true;
  try { await changeRecording(); } finally { $('record').disabled = !run?.started || run.stopping; }
}
async function changeRecording() {
  if (recording) { await stopRecording(); return; }
  if (!run?.started || run.stopping) return;
  try {
    const entries = await library.list();
    if (entries.reduce((sum, r) => sum + r.audio.size, 0) > library.LIMIT - 8 * 1024 * 1024) throw new Error('Library nearly full. Export and remove a recording before starting another.');
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('This browser cannot record this audio format. Try Chrome or Safari.');
    const recorder = new MediaRecorder(run.capture.stream, {mimeType, audioBitsPerSecond: 64000});
    const record = {id: crypto.randomUUID(), title: show.brief.title, question: show.question, createdAt: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, sources: show.sources, researchedAt: show.researched_at,
      duration: 0, complete: false, mimeType};
    const state = {recorder, record, chunks: [], started: Date.now(), writes: Promise.resolve()};
    recording = state;
    recorder.ondataavailable = e => {
      if (!e.data.size) return;
      state.chunks.push(e.data);
      // Checkpoint each second so an abrupt tab close loses at most the last chunk.
      const snapshot = {...record, duration: (Date.now() - state.started) / 1000,
        audio: new Blob(state.chunks, {type: mimeType})};
      state.writes = state.writes.then(() => library.save(snapshot)).catch(error => {
        fail(error); $('recording-status').textContent = 'Browser storage failed. Keep this tab open and export the recording after stopping.';
      });
    };
    recorder.onerror = () => { fail('Recording failed. Captured audio will be saved where possible.'); void stopRecording(); };
    recorder.start(1000);
    $('record').textContent = '■ Stop recording'; $('record').classList.add('recording');
    $('recording-status').textContent = 'Recording the mixed conversation. Saving privately in this browser.';
  } catch (error) { fail(error); }
}
async function stopRecording() {
  const state = recording; if (!state) return;
  recording = null;
  const finished = new Promise(resolve => { state.recorder.onstop = resolve; });
  state.recorder.stop(); await finished; await state.writes;
  const audio = new Blob(state.chunks, {type: state.record.mimeType});
  const final = {...state.record, audio, duration: (Date.now() - state.started) / 1000, complete: true};
  try {
    if (!audio.size) throw new Error('No audio was captured.');
    await library.save(final);
    $('recording-status').textContent = 'Recording saved to your private replay library.';
    await renderLibrary();
  } catch (error) {
    fail(error); $('recording-status').replaceChildren(document.createTextNode('Save failed. Export your captured recording: '), blobLink(audio, 'radio-recording.' + (state.record.mimeType.includes('mp4') ? 'm4a' : 'webm'), 'Download recording'));
  }
  $('record').textContent = '● Record & save'; $('record').classList.remove('recording');
}
async function renderLibrary() {
  try {
    const all = (await library.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $('library').replaceChildren();
    if (!all.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing saved yet. A good conversation is worth keeping.'; $('library').append(p); }
    for (const record of all) {
      const article = document.createElement('article'); article.className = 'replay';
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'Recording' + (record.complete ? '' : ' · interrupted');
      const title = document.createElement('h3'); title.textContent = record.title;
      const meta = document.createElement('p'); meta.className = 'replay-meta';
      const date = new Date(record.createdAt);
      meta.textContent = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'long', timeZone: record.timezone}).format(date) + ` · ${record.timezone} · ${ago(date)} · ${duration(record.duration)}`;
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata';
      audio.src = URL.createObjectURL(record.audio); urls.push(audio.src);
      audio.onplay = () => { if (run) audio.pause(); else document.querySelectorAll('.replay audio').forEach(other => { if (other !== audio) other.pause(); }); };
      const links = document.createElement('ul'); links.className = 'sources'; sourceList(links, record.sources);
      const researched = document.createElement('p'); researched.className = 'small'; researched.textContent = 'Original research: ' + new Date(record.researchedAt).toLocaleString();
      const actions = document.createElement('div'); actions.className = 'actions';
      const exportLink = blobLink(record.audio, 'radio-' + record.id + (record.mimeType.includes('mp4') ? '.m4a' : '.webm'), 'Export audio');
      const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = 'Delete recording';
      remove.onclick = async () => { if (confirm('Delete this private recording from this browser? Export a copy first if you want to keep it.')) { await library.remove(record.id); await renderLibrary(); } };
      actions.append(exportLink, remove); article.append(badge, title, meta, audio, researched, links, actions); $('library').append(article);
    }
  } catch (error) { $('library').textContent = 'Replay storage is unavailable: ' + error.message; }
}
async function init() {
  const status = await (await fetch('/api/status')).json();
  $('access').hidden = status.unlocked; $('studio').hidden = !status.unlocked;
  if (!status.unlocked) $('access-status').textContent = status.message || 'Open the protected radio Preview to use this studio.';;
  if (status.unlocked) await renderLibrary();
}
$('retry-access').onclick = () => init().catch(fail);
$('question-form').onsubmit = startShow;
$('stop').onclick = () => void stopShow();
$('record').onclick = () => void toggleRecording();
$('volume').oninput = () => { if (run) run.master.gain.value = Number($('volume').value); };
$('followup-form').onsubmit = e => {
  e.preventDefault(); if (!run?.started || run.stopping) return;
  pendingFollowup = $('followup').value.trim(); if (!pendingFollowup) return;
  $('followup').value = ''; $('followup-status').textContent = 'Queued for the next natural handoff.'; log('followup-queued', {text: pendingFollowup});
};
$('download-notes').onclick = () => {
  const safeShow = show ? Object.fromEntries(Object.entries(show).filter(([k]) => !['ticket', 'owner'].includes(k))) : null;
  const a = blobLink(new Blob([JSON.stringify({show: safeShow, ...notes}, null, 2)], {type: 'application/json'}), 'radio-show-notes.json', 'Download');
  a.click();
};
window.addEventListener('offline', () => void stopShow('Network disconnected. Both sessions are closing.'));
document.addEventListener('visibilitychange', () => { if (document.hidden && run) void stopShow('The tab became hidden. The show was stopped to limit spend.'); });
window.addEventListener('pagehide', () => {
  const r = run; if (!r) return;
  r.stopping = true; r.controller?.stop(); clearInterval(r.interval); clearTimeout(r.timeout);
  if (recording?.recorder.state === 'recording') recording.recorder.stop();
  for (const host of r.hosts) {
    send(host, 'session.close');
    if (host?.closeTicket) navigator.sendBeacon('/api/close', new Blob([JSON.stringify({ticket: host.closeTicket})], {type: 'application/json'}));
    host?.pc.close();
  }
});
init().catch(fail);
