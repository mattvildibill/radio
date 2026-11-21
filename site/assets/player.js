import {preferPlayback, enableAudio, audioInterrupted} from './audio-start.js';
import {episodeMemory} from './episode-memory.js';
import {AudioTimeline} from './audio-timeline.js';
import {duration, safeSource} from './controller.js';
import * as library from './library.js';
import {PILOT_QUESTION, PILOT_FOLLOWUP, REPORT_KEY, assessPilot, conversationMetrics} from './verification.js';
const $ = id => document.getElementById(id);
const names = ['Mara', 'Eli'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let testingSound = false;
let show = null, run = null, recording = null, urls = [];
let notes = {events: [], transcripts: [], usage: [null, null]};
let lastTranscript = null;
let pilotReport = null, loadedPilot = false, libraryRender = 0, libraryUrls = [];
const channels = names.map((_, index) => $('host-' + index));
try { pilotReport = JSON.parse(localStorage.getItem(REPORT_KEY)); loadedPilot = Boolean(pilotReport); } catch { /* Storage is checked when saving. */ }

function safeNotes() {
  const safeShow = show ? Object.fromEntries(Object.entries(show).filter(([k]) => !['ticket', 'owner'].includes(k))) : null;
  return {show: safeShow, ...notes};
}
function renderPilot() {
  if (!pilotReport) return;
  $('pilot-results').replaceChildren();
  for (const check of assessPilot(pilotReport)) {
    const li = document.createElement('li');
    li.textContent = `${check.passed ? 'Verified' : 'Not verified'}: ${check.label}`;
    $('pilot-results').append(li);
  }
  const pacing = conversationMetrics(pilotReport);
  const pacingItem = document.createElement('li');
  pacingItem.textContent = pacing.secondHostSeconds === null ? 'Pacing unavailable' : `Second host: ${pacing.secondHostSeconds}s (target ≤12s) · First-minute turns: ${pacing.firstMinuteContributions}`;
  $('pilot-results').append(pacingItem);
  $('pilot-status').textContent = pilotReport.error || '';
  $('pilot-reload').hidden = !pilotReport.recordingId || loadedPilot;
  $('pilot-download').hidden = false;
}
function savePilotReport() {
  try { localStorage.setItem(REPORT_KEY, JSON.stringify(pilotReport)); }
  catch { fail('Pilot report could not be stored. Download it before reloading.'); }
  renderPilot();
}

async function api(path, payload, options = {}) {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), ...options});
  let data;
  try { data = await response.json(); }
  catch {
    const error = new Error(`The server returned an unreadable response (HTTP ${response.status}). No automatic retry was made.`);
    log('api-failure', {path, status: response.status}); throw error;
  }
  if (!response.ok) {
    const detail = data.detail;
    const error = new Error(typeof detail === 'string' ? detail : detail?.message || 'The request could not be completed.');
    log('api-failure', {path, status: response.status, diagnostic: detail?.diagnostic || null, message: error.message});
    if (path === '/api/research') { notes.research_failure = detail?.diagnostic || {message: error.message}; renderUsage(); }
    throw error;
  }
  return data;
}
function log(type, data = {}) {
  notes.events.push({at: new Date().toISOString(), type, ...data});
}
function fail(error) { $('error').textContent = error instanceof Error ? error.message : String(error); }
function setStatus(text) { $('status').textContent = text; }
function setActiveHost(active = -1) {
  channels.forEach((channel, index) => {
    const speaking = index === active;
    channel.classList.toggle('speaking', speaking);
    channel.querySelector('.host-state').textContent = speaking ? 'Speaking' : active === -1 ? '' : 'Listening';
    if (!speaking) channel.querySelector('meter').value = 0;
  });
}
function setRecording(active) {
  $('record-label').textContent = active ? 'Stop recording' : 'Record';
  $('record').classList.toggle('recording', active);
}
function setReplayAvailability() {
  document.querySelectorAll('.replay audio').forEach(audio => {
    audio.inert = Boolean(run);
    if (run) audio.pause();
  });
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
  $('research-title').textContent = show.brief.title;
  $('research-date').dateTime = show.researched_at;
  $('research-date').textContent = new Date(show.researched_at).toLocaleDateString(undefined, {dateStyle:'medium'});
  $('brief').replaceChildren();
  const paragraph = (label, text) => {
    const p = document.createElement('p'), title = document.createElement('strong');
    title.textContent = label + ': '; p.append(title, document.createTextNode(text)); $('brief').append(p);
    return p;
  };
  const plan = show.brief.conversation;
  if (plan) {
    paragraph('Approach', `${plan.mode} · ${plan.listener_intent}`);
    paragraph('Opening idea', plan.opening);
    paragraph('Possible threads', plan.paths);
    paragraph('Mara’s curiosity', plan.mara_interest);
    paragraph('Eli’s curiosity', plan.eli_interest);
  }
  for (const evidence of show.brief.evidence || []) {
    const p = paragraph('Evidence', `${evidence.claim}\n${evidence.date_or_context}\nLimits: ${evidence.limits}`);
    if (safeSource(evidence.source_url)) {
      const link = document.createElement('a'); link.href = evidence.source_url; link.target = '_blank';
      link.rel = 'noopener noreferrer'; link.textContent = 'Read source'; p.append(document.createElement('br'), link);
    }
  }
  paragraph('Uncertainties', show.brief.uncertainties);
  paragraph('Public perspectives', show.brief.social_context);
  sourceList($('sources'), show.sources);
  $('sources-details').hidden = !$('sources').childElementCount;
  $('research').hidden = false;
  $('research-link').hidden = false;
}
function renderUsage() {
  const usage = {conversation_pacing: conversationMetrics(notes), research: show?.research_usage || notes.research_failure?.usage || null, research_failure: notes.research_failure || null, web_search_calls: show?.search_calls || notes.research_failure?.search_calls || 0,
    voice: notes.usage.map((u, i) => ({host: names[i], ...u}))};
  $('usage').textContent = JSON.stringify(usage, null, 2);
}
function transcript(index, e, onAir) {
  // Input transcripts are evidence of what each host actually heard. Output
  // fragments are captions, not an invented completed-turn transcript.
  onAir = Boolean(onAir && !run?.stopping);
  notes.transcripts.push({at: new Date().toISOString(), host: names[index], onAir, type: e.type, delta: e.delta, start_ms: e.start_ms, end_ms: e.end_ms});
  if (e.type !== 'session.output_transcript.delta' || !onAir) return;
  if (!lastTranscript || lastTranscript.index !== index) {
    const p = document.createElement('p'), strong = document.createElement('strong'), span = document.createElement('span');
    strong.textContent = names[index] + ': '; p.append(strong, span); $('transcript').append(p);
    lastTranscript = {index, span};
  }
  lastTranscript.span.append(document.createTextNode(e.delta));
}
async function checkRelay() {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/live');
    let finished = false;
    const finish = error => { if (finished) return; finished = true; clearTimeout(timer); ws.close(); error ? reject(new Error(error)) : resolve(); };
    const timer = setTimeout(() => finish('Audio relay connection timed out before research. No OpenAI calls were made.'), 15000);
    ws.onopen = () => ws.send(JSON.stringify({type: 'check'}));
    ws.onmessage = ({data}) => { const e = JSON.parse(data); if (e.type === 'check-ok') finish(); else if (e.type === 'relay-error') finish(e.message); };
    ws.onclose = e => finish(`Audio relay connection closed (${e.code}) before research. No OpenAI calls were made.`);
    ws.onerror = () => finish('This browser could not open the secure audio relay. No OpenAI calls were made.');
  });
}

function playRelayAudio(r, encoded) {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer), buffer = r.context.createBuffer(1, bytes.length / 2, 24000);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  const source = r.context.createBufferSource(); source.buffer = buffer; source.connect(r.mix);
  r.audioTimeline ||= new AudioTimeline();
  const at = r.audioTimeline.schedule(r.context.currentTime, buffer.duration);
  source.start(at);
  source.onended = () => source.disconnect();
}

async function relaySegment(r, firstHost = 0) {
  const remaining = r.limit - (r.started ? (Date.now() - r.started) / 1000 : 0);
  if (remaining <= 1 || r.stopping) { await stopShow('The show has finished.'); return; }
  r.segment = (r.segment || 0) + 1;
  const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/live'); r.relay = ws;
  r.relayFinalized = false;
  const setupTimer = setTimeout(() => {
    r.error = 'The audio relay did not become ready in time. Both sessions are closing.';
    fail(r.error); void stopShow(r.error);
  }, 55000);
  let resolveClosed;
  r.relayClosed = new Promise(resolve => { resolveClosed = resolve; });
  let receivedClose = false;
  const usageBase = notes.usage.map(u => u?.seconds || 0);
  const history = r.segment === 1 ? '' : episodeMemory(notes.transcripts, notes.events);
  ws.onopen = () => ws.send(JSON.stringify({ticket: show.ticket, duration: Math.min(210, remaining), history, first_host: firstHost}));
  ws.onmessage = async ({data}) => {
    let event; try { event = JSON.parse(data); } catch { return; }
    if (event.type === 'host-event') {
      const e = event.event, index = event.host;
      if (e.type === 'session.started') {
        if (notes.usage[index]) notes.usage[index].final = false;
        log('session-started', {host: names[index], transport: 'relay', segment: r.segment});
      }
      else if (e.type === 'session.usage.updated' || e.type === 'session.closed') {
        const measured = Number.isFinite(e.usage?.seconds);
        notes.usage[index] = {seconds: measured ? usageBase[index] + e.usage.seconds : null,
          final: e.type === 'session.closed' && measured, reason: e.reason};
        if (e.type === 'session.closed') log('session-closed', {host: names[index], reason: e.reason, segment: r.segment});
        renderUsage();
      } else if (e.type.includes('transcript.delta')) transcript(index, e, event.on_air);
      else log('host-event', {host:names[index], event:e});
    } else if (event.type === 'ready') {
      clearTimeout(setupTimer);
      if (r.stopping) { ws.send(JSON.stringify({type:'stop'})); return; }
      if (r.context.state !== 'running') { r.error = 'Your browser interrupted audio before playback. Both hosts are closing. Use Test sound before trying again.'; fail(r.error); await stopShow(r.error); return; }
      if (!r.started) {
        r.started = Date.now(); r.controller = {active: -1, stop() { this.active = -1; }};
        if (r.pilot) {
          await changeRecording();
          if (!recording) { r.error = 'Pilot recording could not start.'; await stopShow(r.error); return; }
          r.recordingId = recording.record.id;
          r.followupTimer = setTimeout(() => queueRelayFollowup(r, PILOT_FOLLOWUP), 35000);
        }
        setStatus('On air'); $('signal').classList.add('live');
        $('stop-label').textContent = 'End show';
        $('followup-form').hidden = false;
        $('record').disabled = !window.MediaRecorder; $('followup').disabled = false; $('send').disabled = false;
        r.interval = setInterval(() => { $('clock').textContent = duration((Date.now() - r.started) / 1000) + ' / ' + duration(r.limit); }, 250);
        r.timeout = setTimeout(() => void stopShow('The show has finished.'), r.limit * 1000);

      }
      ws.send(JSON.stringify({type:'go'}));
      for (const item of r.followups || []) if (item.status === 'waiting') { ws.send(JSON.stringify({type:'followup', id:item.id, text:item.text})); item.status = 'sent'; }
    } else if (event.type === 'floor' && !r.stopping) {
      r.controller.active = event.host;
      log('floor', {host: names[event.host], segment: r.segment});
      setActiveHost(event.host);
    } else if (event.type === 'audio' && !r.stopping) {
      playRelayAudio(r, event.pcm);
    } else if (event.type === 'speech-started' || event.type === 'turn-ended') {
      log(event.type, {host:names[event.host], turn:event.turn, elapsed:event.elapsed, seconds:event.seconds, forced:event.forced, segment:r.segment});
    } else if (event.type === 'meter') {
      const rms = [0, 0]; rms[event.host] = event.rms; log('audio-level', {rms, floor:event.host});
      if (!r.stopping && r.controller?.active === event.host && Number.isFinite(event.rms)) {
        channels[event.host].querySelector('meter').value = Math.min(1, event.rms * 4);
      }
    } else if (event.type === 'followup-accepted' || event.type === 'followup-rejected') {
      const item = r.followups?.find(x => x.id === event.id);
      if (item) item.status = event.type === 'followup-accepted' ? 'queued' : 'rejected';
      renderFollowups(r);
      $('followup-status').textContent = event.type === 'followup-accepted' ? 'Follow-up queued' : 'Follow-up could not be queued';
    } else if (event.type === 'followup-delivered') {
      const item = r.followups?.find(x => x.id === event.id); if (item) item.status = 'addressing';
      renderFollowups(r);
      log('followup-delivered', {text:event.text, nextHost:names[event.host]});
      $('followup-status').textContent = `Follow-up sent to ${names[event.host]}`;
    } else if (event.type === 'relay-error') {
      r.error = event.message; fail(event.message);
    } else if (event.type === 'relay-closed') {
      clearTimeout(setupTimer); r.relayFinalized = event.finalized;
      for (const item of event.pending_followups || []) {
        const local = r.followups?.find(x => x.id === item.id); if (local) local.status = 'waiting';
      }
      receivedClose = true; resolveClosed(); ws.close();
      if (!r.stopping) {
        if (event.reason === 'segment_complete' && event.finalized && !r.error) {
          log('relay-continuation', {segment: r.segment});
          void relaySegment(r, event.next_host);
        } else void stopShow(r.error || (event.finalized ? 'The show has finished.' : 'Host finalization was not confirmed.'));
      }
    }
  };
  ws.onerror = () => { r.error = 'The secure audio relay could not connect. No automatic retry was made.'; fail(r.error); };
  ws.onclose = () => {
    clearTimeout(setupTimer);
    resolveClosed();
    if (!receivedClose && !r.stopping) { r.error ||= 'The audio relay disconnected. Both host connections are closing.'; void stopShow(r.error); }
  };
}

function renderFollowups(r) {
  const list = $('followup-queue'); list.replaceChildren();
  const labels = {waiting:'Waiting', sent:'Sending', queued:'Queued', addressing:'With hosts', rejected:'Queue full'};
  for (const item of (r.followups || []).slice(-8)) {
    const li = document.createElement('li'), question = document.createElement('span'), status = document.createElement('span');
    question.className = 'followup-question'; question.textContent = item.text;
    status.className = 'followup-state'; status.textContent = labels[item.status];
    li.append(question, status); list.append(li);
  }
}
function queueRelayFollowup(r, text) {
  if (!text || r.stopping) return false;
  r.followups ||= [];
  if (r.followups.filter(x => ['waiting','sent','queued'].includes(x.status)).length >= 8) { fail('Follow-up queue is full.'); return false; }
  fail('');
  const item = {id:crypto.randomUUID(), text, status:'waiting'}; r.followups.push(item);
  log('followup-queued', {id:item.id, text});
  if (r.relay?.readyState === WebSocket.OPEN) { r.relay.send(JSON.stringify({type:'followup', id:item.id, text})); item.status = 'sent'; }
  renderFollowups(r);
  return true;
}
async function requireAudio(r) {
  while (!r.stopping && r.context.state !== 'running') {
    setStatus('Sound paused');
    $('enable-audio').hidden = false;
    const enabled = await new Promise(resolve => { r.audioWait = resolve; });
    r.audioWait = null; $('enable-audio').hidden = true;
    if (!enabled) return false;
  }
  return !r.stopping;
}
async function startShow(event, pilot = false) {
  event.preventDefault(); if (run || testingSound) return;
  fail(''); $('recording-status').textContent = ''; $('audio-status').textContent = '';
  if (!window.WebSocket || !window.AudioContext || !window.isSecureContext) {
    fail('This browser needs secure audio streaming and Web Audio on HTTPS. Try current Chrome or Safari.'); return;
  }
  preferPlayback();
  let context;
  try { context = new AudioContext(); } catch (error) { fail(error); return; }
  const r = {context,
    stopping: false, limit: pilot ? 90 : 540, pilot, abort: new AbortController(), started: null};
  run = r; show = null; notes = {events: [], transcripts: [], usage: [null, null]}; lastTranscript = null;
  setReplayAvailability();
  $('diagnostics').hidden = false;
  $('usage').textContent = '';
  $('followup-queue').replaceChildren(); $('transcript').replaceChildren(); $('start').disabled = true; $('run-pilot').disabled = true; $('stop').disabled = false; $('question').disabled = true;
  $('followup-status').textContent = ''; $('followup').value = ''; $('stop-label').textContent = 'Cancel';
  $('clock').textContent = '00:00 / ' + duration(r.limit);
  $('research').hidden = true; $('research-link').hidden = true;
  $('brief-details').open = false; $('sources-details').open = false;
  setStatus('Starting…'); $('status').focus(); log('research-started');
  try {
    r.mix = context.createDynamicsCompressor(); r.mix.threshold.value = -15; r.mix.ratio.value = 4;
    r.master = context.createGain(); r.master.gain.value = Number($('volume').value);
    r.capture = context.createMediaStreamDestination(); r.mix.connect(r.master); r.master.connect(context.destination); r.mix.connect(r.capture);
    r.context.onstatechange = () => {
      log('audio-state', {state:r.context.state});
      if ((r.started || r.relay) && !r.stopping && audioInterrupted(r.context.state)) void stopShow('Audio was interrupted. Both sessions are closing. Keep the page visible and use Test sound before trying again.');
    };
    $('test-sound').disabled = true;
    // resume() is invoked inside the initiating gesture, before network waits.
    await enableAudio(context);
    if (!await requireAudio(r)) return;
    setStatus('Connecting audio…');
    log('audio-transport', {mode: 'relay'});
    await checkRelay();
    if (r.stopping) return;
    setStatus('Researching…');
    show = await api('/api/research', {question: $('question').value.trim()}, {signal: r.abort.signal});
    if (r.stopping) return;
    log('research-completed', {researched_at: show.researched_at, sources: show.sources.length}); renderResearch(); renderUsage();
    if (!await requireAudio(r)) return;
    setStatus('Connecting hosts…');
    await relaySegment(r);
  } catch (error) {
    if (!r.stopping) { r.error = error.message; await stopShow(r.error); }
  }
}
async function stopShow(message) {
  const r = run; if (!r || r.stopping) return;
  const moveFocus = $('followup-form').contains(document.activeElement) || [$('stop'), $('record'), $('enable-audio')].includes(document.activeElement);
  r.stopping = true; r.audioWait?.(false); $('enable-audio').hidden = true; r.abort.abort(); r.controller?.stop(); clearInterval(r.interval); clearTimeout(r.timeout); clearTimeout(r.followupTimer);
  $('stop').disabled = true; $('record').disabled = true; $('send').disabled = true; $('followup').disabled = true;
  $('followup-form').hidden = true;
  setStatus(r.started ? 'Ending show…' : 'Closing…'); $('signal').classList.remove('live'); setActiveHost();
  if (moveFocus) $('status').focus();
  const saved = stopRecording();
  if (r.master) r.master.gain.value = 0;
  if (r.relay) {
    if (r.relay.readyState === WebSocket.OPEN) r.relay.send(JSON.stringify({type:'stop'}));
    await Promise.race([r.relayClosed, sleep(10000)]);
    r.relay.close();
  }
  r.capture?.stream.getTracks().forEach(t => t.stop());
  if (r.context.state !== 'closed') await r.context.close();
  await saved;
  log('show-ended', {audioUnderruns: r.audioTimeline?.underruns || 0}); renderUsage();
  for (const id of r.recordingIds || []) { try { await library.update(id, {notes:safeNotes()}); } catch (error) { fail(error); } }
  await renderLibrary();
  const incomplete = r.relay && !r.relayFinalized;
  setStatus(r.started ? 'Show ended' : 'Off air');
  if (message && message !== 'The show has finished.') fail(message);
  if (incomplete) log('usage-unconfirmed');
  if (r.pilot) {
    let savedRecording;
    try { savedRecording = (await library.list()).find(item => item.id === r.recordingId && item.complete); } catch { /* Report the missing evidence. */ }
    pilotReport = {...safeNotes(), createdAt: new Date().toISOString(), recordingId: savedRecording?.id || null,
      error: r.error || (message === 'The show has finished.' ? null : message || 'Pilot stopped early'), replay: {}};
    loadedPilot = false; savePilotReport(); $('pilot-check').open = true;
  }
  run = null; setReplayAvailability();
  $('test-sound').disabled = false; $('start').disabled = false; $('run-pilot').disabled = false; $('question').disabled = false;
}
function blobLink(blob, filename, title, collection = urls) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); collection.push(a.href);
  a.download = filename; a.textContent = title; return a;
}
async function toggleRecording() {
  const button = $('record');
  const hadFocus = document.activeElement === button;
  button.disabled = true;
  try { await changeRecording(); }
  finally {
    button.disabled = !run?.started || run.stopping;
    if (hadFocus && !button.disabled && document.activeElement === document.body) button.focus();
  }
}
async function changeRecording() {
  if (recording) { await stopRecording(); return; }
  if (!run?.started || run.stopping) return;
  const ownerRun = run;
  try {
    const entries = await library.list();
    if (run !== ownerRun || ownerRun.stopping) return;
    if (entries.reduce((sum, r) => sum + r.audio.size, 0) > library.LIMIT - 8 * 1024 * 1024) throw new Error('Library nearly full. Export and remove a recording before starting another.');
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('This browser cannot record this audio format. Try Chrome or Safari.');
    const recorder = new MediaRecorder(run.capture.stream, {mimeType, audioBitsPerSecond: 64000});
    const record = {id: crypto.randomUUID(), title: show.brief.title, question: show.question, createdAt: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, sources: show.sources, researchedAt: show.researched_at,
      duration: 0, complete: false, mimeType};
    const state = {recorder, record, chunks: [], started: Date.now(), writes: Promise.resolve()};
    await library.begin(record);
    if (run !== ownerRun || ownerRun.stopping) { await library.remove(record.id); return; }
    (ownerRun.recordingIds ||= []).push(record.id);
    recording = state;
    recorder.ondataavailable = e => {
      if (!e.data.size) return;
      state.chunks.push(e.data);
      state.writes = state.writes.then(() => library.append(record.id, e.data, (Date.now() - state.started) / 1000)).catch(error => {
        state.saveError = error;
        fail(error); $('recording-status').textContent = 'Browser storage failed. Keep this tab open and export the recording after stopping.';
      });
    };
    recorder.onerror = () => { fail('Recording failed. Captured audio will be saved where possible.'); void stopRecording(); };
    recorder.start(1000);
    setRecording(true);
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
    if (state.saveError) throw state.saveError;
    await library.update(final.id, {duration:final.duration, complete:true, notes:safeNotes()});
    $('recording-status').textContent = '';
    await renderLibrary();
  } catch (error) {
    fail(error);
    if (audio.size) $('recording-status').replaceChildren(blobLink(audio, 'radio-recording.' + (state.record.mimeType.includes('mp4') ? 'm4a' : 'webm'), 'Download unsaved audio'));
  }
  setRecording(false);
}
function filterReplays() {
  const search = $('replay-search');
  const rows = $('library').querySelectorAll('.replay');
  $('search-field').hidden = !rows.length;
  if (!rows.length) search.value = '';
  const query = search.value.trim().toLowerCase();
  let matches = 0;
  for (const row of rows) {
    row.hidden = !row.dataset.search.includes(query);
    if (row.hidden) row.querySelector('audio').pause();
    else matches++;
  }
  $('library-no-results').hidden = !rows.length || matches > 0;
}
function showEmptyLibrary(message = 'No recordings yet') {
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = message;
  $('library').replaceChildren(empty);
  filterReplays();
}
async function renderLibrary() {
  const version = ++libraryRender;
  try {
    const all = (await library.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (version !== libraryRender) return;
    libraryUrls.forEach(url => URL.revokeObjectURL(url)); libraryUrls = [];
    if (!all.length) { showEmptyLibrary(); return; }
    const rows = document.createDocumentFragment();
    for (const record of all) {
      const article = document.createElement('article'); article.className = 'replay';
      const title = document.createElement('h3'); title.textContent = record.title;
      const meta = document.createElement('p'); meta.className = 'replay-meta';
      const date = document.createElement('time'); date.dateTime = record.createdAt;
      date.textContent = new Date(record.createdAt).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});
      meta.append(date, ` · ${duration(record.duration)}${record.complete ? '' : ' · Interrupted'}`);
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none';
      audio.src = URL.createObjectURL(record.audio);
      const rowUrls = [audio.src];
      audio.onplay = () => { if (run) audio.pause(); else document.querySelectorAll('.replay audio').forEach(other => { if (other !== audio) other.pause(); }); };
      audio.ontimeupdate = () => {
        if (loadedPilot && record.id === pilotReport?.recordingId && audio.currentTime > 1 && !pilotReport.replay?.playedAfterReload) {
          pilotReport.replay = {...pilotReport.replay, playedAfterReload: true}; savePilotReport();
        }
      };
      const links = document.createElement('ul'); links.className = 'sources'; sourceList(links, record.sources);
      const sourceDetails = document.createElement('details'), sourceSummary = document.createElement('summary');
      sourceDetails.className = 'disclosure';
      sourceSummary.textContent = 'Sources'; sourceDetails.append(sourceSummary, links);
      const actions = document.createElement('div'); actions.className = 'actions';
      const exportLink = blobLink(record.audio, 'radio-' + record.id + (record.mimeType.includes('mp4') ? '.m4a' : '.webm'), 'Download audio', rowUrls);
      exportLink.className = 'text-button';
      const remove = document.createElement('button'); remove.className = 'text-button delete'; remove.textContent = 'Delete';
      remove.onclick = async () => {
        if (!confirm(`Delete “${record.title}”?`)) return;
        try {
          await library.remove(record.id);
          $('library-status').textContent = '';
          audio.pause(); article.remove();
          rowUrls.forEach(url => URL.revokeObjectURL(url));
          libraryUrls = libraryUrls.filter(url => !rowUrls.includes(url));
          if ($('library').childElementCount) filterReplays();
          else showEmptyLibrary();
          if (!$('search-field').hidden) $('replay-search').focus();
          else $('replays').focus();
        } catch (error) { $('library-status').textContent = error.message; }
      };
      const rename = document.createElement('button'); rename.className='text-button'; rename.textContent='Rename';
      const setTitle = value => {
        record.title = value;
        title.textContent = value;
        article.dataset.search = `${value} ${record.question || ''}`.toLowerCase();
        audio.setAttribute('aria-label', value);
        rename.setAttribute('aria-label', `Rename ${value}`);
        remove.setAttribute('aria-label', `Delete ${value}`);
      };
      setTitle(record.title);
      rename.onclick = async () => {
        const name = prompt('Recording title', record.title)?.trim().slice(0, 180);
        if (!name || name === record.title) return;
        try {
          await library.update(record.id, {title:name});
          $('library-status').textContent = '';
          setTitle(name);
          filterReplays();
          if (article.hidden) $('replay-search').focus();
        } catch (error) { $('library-status').textContent = error.message; }
      };
      actions.append(exportLink);
      if (record.notes) {
        const download = blobLink(new Blob([JSON.stringify(record.notes,null,2)], {type:'application/json'}), 'radio-notes.json', 'Download notes', rowUrls);
        download.className = 'text-button';
        actions.append(download);
      }
      actions.append(rename, remove);
      article.append(title, meta, audio);
      if (links.childElementCount) article.append(sourceDetails);
      article.append(actions); rows.append(article);
      libraryUrls.push(...rowUrls);
    }
    $('library').replaceChildren(rows);
    $('library-status').textContent = '';
    setReplayAvailability();
    filterReplays();
  } catch (error) {
    if (version === libraryRender) showEmptyLibrary('Replay storage unavailable');
  }
}
async function init() {
  const retryFocused = document.activeElement === $('retry-access');
  $('retry-access').hidden = true;
  $('access-status').textContent = 'Checking access…';
  let status;
  try { status = await (await fetch('/api/status')).json(); }
  catch { status = {unlocked:false, message:'Couldn’t check studio access'}; }
  $('access').hidden = status.unlocked; $('studio').hidden = !status.unlocked; $('navigation').hidden = !status.unlocked;
  if (!status.unlocked) {
    $('access-status').textContent = status.message || 'Sign in to Vercel to open the studio.';
    $('retry-access').hidden = false;
    if (retryFocused) $('retry-access').focus();
  }
  if (status.unlocked) {
    if (retryFocused) $('studio-heading').focus();
    await renderLibrary(); renderPilot();
    if (loadedPilot && pilotReport?.recordingId) {
      $('pilot-check').open = true;
      let decoder;
      try {
        const saved = (await library.list()).find(item => item.id === pilotReport.recordingId);
        if (!saved?.audio.size) throw new Error('The pilot recording is missing from this browser.');
        decoder = new AudioContext();
        const decoded = await decoder.decodeAudioData(await saved.audio.arrayBuffer());
        pilotReport.replay = {...pilotReport.replay, decodedAfterReload: decoded.duration > 0, duration: decoded.duration};
        savePilotReport();
      } catch (error) { fail(error); }
      finally { if (decoder) await decoder.close(); }
    }
  }
}
$('replay-search').oninput = filterReplays;
$('retry-access').onclick = () => init().catch(fail);
$('question-form').onsubmit = startShow;
$('run-pilot').onclick = event => {
  if (run) return;
  $('question').value = PILOT_QUESTION;
  $('pilot-status').textContent = 'Pilot running…';
  void startShow(event, true);
};
$('pilot-reload').onclick = () => { if (!run) location.reload(); };
$('pilot-download').onclick = () => {
  if (pilotReport) blobLink(new Blob([JSON.stringify({...pilotReport, checks: assessPilot(pilotReport)}, null, 2)], {type: 'application/json'}), 'radio-pilot-report.json', 'Download').click();
};
$('enable-audio').onclick = async () => {
  const r = run; if (!r || r.stopping) return;
  preferPlayback();
  const enabled = await enableAudio(r.context);
  if (run !== r || r.stopping) return;
  if (enabled) { $('audio-status').textContent = ''; $('status').focus(); r.audioWait?.(true); }
  else $('audio-status').textContent = 'Sound is blocked. Try opening the preview directly in Safari or Chrome.';
};
$('test-sound').onclick = async () => {
  if (run || testingSound) return;
  testingSound = true;
  const button = $('test-sound'), hadFocus = document.activeElement === button;
  button.disabled = true;
  $('start').disabled = true; $('run-pilot').disabled = true;
  let context;
  try {
    $('audio-status').textContent = '';
    preferPlayback(); context = new AudioContext();
    if (!await enableAudio(context)) throw new Error('The browser blocked audio playback. Open this page directly in Safari or Chrome and try again.');
    const tone = context.createOscillator(), level = context.createGain();
    tone.frequency.value = 440; level.gain.setValueAtTime(0,context.currentTime);
    level.gain.linearRampToValueAtTime(0.14 * Number($('volume').value),context.currentTime+0.03);
    level.gain.linearRampToValueAtTime(0,context.currentTime+0.3);
    tone.connect(level); level.connect(context.destination); tone.start(); tone.stop(context.currentTime+0.32);
    $('audio-status').textContent = 'Playing a short tone…';
    await Promise.race([new Promise(resolve => { tone.onended = resolve; }), sleep(1000)]);
    $('audio-status').textContent = '';
  } catch (error) { $('audio-status').textContent = error.message; }
  finally {
    if (context && context.state !== 'closed') await context.close();
    testingSound = false; button.disabled = Boolean(run);
    $('start').disabled = Boolean(run); $('run-pilot').disabled = Boolean(run);
    if (hadFocus && !button.disabled && document.activeElement === document.body) button.focus();
  }
};
$('stop').onclick = () => void stopShow();
$('record').onclick = () => void toggleRecording();
$('volume').oninput = () => { if (run) run.master.gain.value = Number($('volume').value); };
$('followup-form').onsubmit = e => {
  e.preventDefault(); if (!run?.started || run.stopping) return;
  const input = $('followup');
  if (queueRelayFollowup(run, input.value.trim())) input.value = '';
  input.focus();
};
$('download-notes').onclick = () => {
  const a = blobLink(new Blob([JSON.stringify(safeNotes(), null, 2)], {type: 'application/json'}), 'radio-show-notes.json', 'Download');
  a.click();
};
window.addEventListener('offline', () => void stopShow('Network disconnected. Both sessions are closing.'));
document.addEventListener('visibilitychange', () => { if (document.hidden && run) void stopShow('The tab became hidden. The show was stopped to limit spend.'); });
window.addEventListener('pagehide', () => {
  const r = run; if (!r) return;
  r.stopping = true; r.controller?.stop(); clearInterval(r.interval); clearTimeout(r.timeout); clearTimeout(r.followupTimer);
  if (recording?.recorder.state === 'recording') recording.recorder.stop();
  if (r.relay?.readyState === WebSocket.OPEN) { r.relay.send(JSON.stringify({type:'stop'})); r.relay.close(); }

});
init().catch(fail);
