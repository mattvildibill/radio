import {episodeMemory} from './episode-memory.js';
import {AudioTimeline} from './audio-timeline.js';
import {duration, ago, safeSource} from './controller.js';
import * as library from './library.js';
import {PILOT_QUESTION, PILOT_FOLLOWUP, REPORT_KEY, assessPilot} from './verification.js';
const $ = id => document.getElementById(id);
const names = ['Mara', 'Eli'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let show = null, run = null, recording = null, urls = [];
let notes = {events: [], transcripts: [], usage: [null, null]};
let lastTranscript = null;
let pilotReport = null, loadedPilot = false, libraryRender = 0, libraryUrls = [];
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
  $('pilot-status').textContent = pilotReport.error || 'Pilot evidence saved. Listen to judge the voices, handoffs, and whether the hospital follow-up changed the conversation. These judgments are not automatically marked as passed.';
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
    p.append(title, document.createTextNode(typeof value === 'string' ? value : JSON.stringify(value, null, 2))); $('brief').append(p);
  }
  sourceList($('sources'), show.sources);
}
function renderUsage() {
  const usage = {research: show?.research_usage || notes.research_failure?.usage || null, research_failure: notes.research_failure || null, web_search_calls: show?.search_calls || notes.research_failure?.search_calls || 0,
    voice: notes.usage.map((u, i) => ({host: names[i], ...u}))};
  $('usage').textContent = JSON.stringify(usage, null, 2);
}
function transcript(index, e) {
  // Input transcripts are evidence of what each host actually heard. Output
  // fragments are captions, not an invented completed-turn transcript.
  const onAir = run?.controller?.active === index && !run?.stopping;
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
      } else if (e.type.includes('transcript.delta')) transcript(index, e);
      else log('host-event', {host:names[index], event:e});
    } else if (event.type === 'ready') {
      clearTimeout(setupTimer);
      if (r.stopping) { ws.send(JSON.stringify({type:'stop'})); return; }
      if (!r.started) {
        r.started = Date.now(); r.controller = {active: -1, stop() { this.active = -1; }};
        if (r.pilot) {
          await changeRecording();
          if (!recording) { r.error = 'Pilot recording could not start.'; await stopShow(r.error); return; }
          r.recordingId = recording.record.id;
          r.followupTimer = setTimeout(() => queueRelayFollowup(r, PILOT_FOLLOWUP), 35000);
        }
        setStatus(r.pilot ? '90-second pilot · recording' : 'Live from the studio'); $('signal').classList.add('live');
        $('record').disabled = !window.MediaRecorder; $('followup').disabled = false; $('send').disabled = false;
        r.interval = setInterval(() => { $('clock').textContent = duration((Date.now() - r.started) / 1000) + ' / ' + duration(r.limit); }, 250);
        r.timeout = setTimeout(() => void stopShow('The show has finished.'), r.limit * 1000);
        r.context.onstatechange = () => { if (r.context.state === 'suspended' && !r.stopping) void stopShow('Audio was suspended. Both sessions are closing.'); };
      }
      ws.send(JSON.stringify({type:'go'}));
      for (const item of r.followups || []) if (item.status === 'waiting') { ws.send(JSON.stringify({type:'followup', id:item.id, text:item.text})); item.status = 'sent'; }
    } else if (event.type === 'floor') {
      r.controller.active = event.host;
      log('floor', {host: names[event.host], segment: r.segment});
      names.forEach((_, i) => { $('host-' + i).classList.toggle('speaking', i === event.host); $('host-' + i).querySelector('.host-state').textContent = i === event.host ? 'On air' : 'Listening'; });
    } else if (event.type === 'audio' && !r.stopping) {
      playRelayAudio(r, event.pcm);
    } else if (event.type === 'meter') {
      const rms = [0, 0]; rms[event.host] = event.rms; log('audio-level', {rms, floor:event.host});
    } else if (event.type === 'followup-accepted' || event.type === 'followup-rejected') {
      const item = r.followups?.find(x => x.id === event.id);
      if (item) item.status = event.type === 'followup-accepted' ? 'queued' : 'rejected';
      renderFollowups(r);
    } else if (event.type === 'followup-delivered') {
      const item = r.followups?.find(x => x.id === event.id); if (item) item.status = 'addressing';
      renderFollowups(r);
      log('followup-delivered', {text:event.text, nextHost:names[event.host]});
      $('followup-status').textContent = `${names[event.host]} is taking your follow-up into the next exchange.`;
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
  for (const item of (r.followups || []).slice(-8)) {
    const li = document.createElement('li'); li.textContent = `${item.status}: ${item.text}`; list.append(li);
  }
}
function queueRelayFollowup(r, text) {
  if (!text || r.stopping) return;
  r.followups ||= [];
  if (r.followups.filter(x => ['waiting','sent','queued'].includes(x.status)).length >= 8) { fail('Eight follow-ups are queued. Please wait for an answer.'); return; }
  const item = {id:crypto.randomUUID(), text, status:'waiting'}; r.followups.push(item);
  log('followup-queued', {id:item.id, text});
  if (r.relay?.readyState === WebSocket.OPEN) { r.relay.send(JSON.stringify({type:'followup', id:item.id, text})); item.status = 'sent'; }
  renderFollowups(r);
}
async function startShow(event, pilot = false) {
  event.preventDefault(); if (run) return;
  document.querySelectorAll('.replay audio').forEach(audio => audio.pause());
  $('error').textContent = ''; $('recording-status').textContent = '';
  if (!window.WebSocket || !window.AudioContext || !window.isSecureContext) {
    fail('This browser needs secure audio streaming and Web Audio on HTTPS. Try current Chrome or Safari.'); return;
  }
  const context = new AudioContext(); await context.resume();
  const r = {context,
    stopping: false, limit: pilot ? 90 : 540, pilot, abort: new AbortController(), started: null};
  run = r; show = null; notes = {events: [], transcripts: [], usage: [null, null]}; lastTranscript = null;
  $('followup-queue').replaceChildren(); $('transcript').replaceChildren(); $('start').disabled = true; $('run-pilot').disabled = true; $('stop').disabled = false; $('question').disabled = true;
  $('clock').textContent = '00:00 / ' + duration(r.limit);
  $('research').hidden = true; setStatus('The producer is researching…'); log('research-started');
  r.mix = context.createDynamicsCompressor(); r.mix.threshold.value = -15; r.mix.ratio.value = 4;
  r.master = context.createGain(); r.master.gain.value = Number($('volume').value);
  r.capture = context.createMediaStreamDestination(); r.mix.connect(r.master); r.master.connect(context.destination); r.mix.connect(r.capture);
  try {
    setStatus('Preparing studio audio…');
    log('audio-transport', {mode: 'relay'});
    await checkRelay();
    if (r.stopping) return;
    setStatus('The producer is researching…');
    show = await api('/api/research', {question: $('question').value.trim()}, {signal: r.abort.signal});
    if (r.stopping) return;
    log('research-completed', {researched_at: show.researched_at, sources: show.sources.length}); renderResearch(); renderUsage();
    setStatus('Brief ready. Connecting Mara and Eli…');
    await relaySegment(r);
  } catch (error) {
    if (!r.stopping) { r.error = error.message; fail(error); await stopShow('The show could not start.'); }
  }
}
async function stopShow(message = 'The show has ended.') {
  const r = run; if (!r || r.stopping) return;
  r.stopping = true; r.abort.abort(); r.controller?.stop(); clearInterval(r.interval); clearTimeout(r.timeout); clearTimeout(r.followupTimer);
  $('stop').disabled = true; $('record').disabled = true; $('send').disabled = true; $('followup').disabled = true;
  setStatus('Closing both host sessions…'); $('signal').classList.remove('live');
  const saved = stopRecording();
  r.master.gain.value = 0;
  if (r.relay) {
    if (r.relay.readyState === WebSocket.OPEN) r.relay.send(JSON.stringify({type:'stop'}));
    await Promise.race([r.relayClosed, sleep(10000)]);
    r.relay.close();
  }
  r.capture.stream.getTracks().forEach(t => t.stop()); await r.context.close(); await saved;
  log('show-ended', {audioUnderruns: r.audioTimeline?.underruns || 0}); renderUsage();
  for (const id of r.recordingIds || []) { try { await library.update(id, {notes:safeNotes()}); } catch (error) { fail(error); } }
  await renderLibrary();
  const incomplete = r.relay && !r.relayFinalized;
  setStatus(message + (incomplete ? ' Final provider usage is unconfirmed.' : ''));
  names.forEach((_, i) => { $('host-' + i).classList.remove('speaking'); $('host-' + i).querySelector('.host-state').textContent = 'Off air'; });
  if (r.pilot) {
    let savedRecording;
    try { savedRecording = (await library.list()).find(item => item.id === r.recordingId && item.complete); } catch { /* Report the missing evidence. */ }
    pilotReport = {...safeNotes(), createdAt: new Date().toISOString(), recordingId: savedRecording?.id || null,
      error: r.error || (message === 'The show has finished.' ? null : message), replay: {}};
    loadedPilot = false; savePilotReport(); $('pilot-check').open = true;
  }
  run = null; $('start').disabled = false; $('run-pilot').disabled = false; $('question').disabled = false;
}
function blobLink(blob, filename, title, collection = urls) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); collection.push(a.href);
  a.download = filename; a.textContent = title; return a;
}
async function toggleRecording() {
  $('record').disabled = true;
  try { await changeRecording(); } finally { $('record').disabled = !run?.started || run.stopping; }
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
    if (state.saveError) throw state.saveError;
    await library.update(final.id, {duration:final.duration, complete:true, notes:safeNotes()});
    $('recording-status').textContent = 'Recording saved to your private replay library.';
    await renderLibrary();
  } catch (error) {
    fail(error); $('recording-status').replaceChildren(document.createTextNode('Save failed. Export your captured recording: '), blobLink(audio, 'radio-recording.' + (state.record.mimeType.includes('mp4') ? 'm4a' : 'webm'), 'Download recording'));
  }
  $('record').textContent = '● Record & save'; $('record').classList.remove('recording');
}
async function renderLibrary() {
  const version = ++libraryRender;
  try {
    const all = (await library.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (version !== libraryRender) return;
    libraryUrls.forEach(url => URL.revokeObjectURL(url)); libraryUrls = [];
    $('library').replaceChildren();
    if (!all.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing saved yet. A good conversation is worth keeping.'; $('library').append(p); }
    const query = $('replay-search').value.trim().toLowerCase();
    for (const record of all.filter(r => !query || (r.title + ' ' + r.question).toLowerCase().includes(query))) {
      const article = document.createElement('article'); article.className = 'replay';
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = 'Recording' + (record.complete ? '' : ' · interrupted');
      const title = document.createElement('h3'); title.textContent = record.title;
      const meta = document.createElement('p'); meta.className = 'replay-meta';
      const date = new Date(record.createdAt);
      meta.textContent = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'long', timeZone: record.timezone}).format(date) + ` · ${record.timezone} · ${ago(date)} · ${duration(record.duration)}`;
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata';
      audio.src = URL.createObjectURL(record.audio); libraryUrls.push(audio.src);
      audio.onplay = () => { if (run) audio.pause(); else document.querySelectorAll('.replay audio').forEach(other => { if (other !== audio) other.pause(); }); };
      audio.ontimeupdate = () => {
        if (loadedPilot && record.id === pilotReport?.recordingId && audio.currentTime > 1 && !pilotReport.replay?.playedAfterReload) {
          pilotReport.replay = {...pilotReport.replay, playedAfterReload: true}; savePilotReport();
        }
      };
      const links = document.createElement('ul'); links.className = 'sources'; sourceList(links, record.sources);
      const researched = document.createElement('p'); researched.className = 'small'; researched.textContent = 'Original research: ' + new Date(record.researchedAt).toLocaleString();
      const sourceDetails = document.createElement('details'), sourceSummary = document.createElement('summary');
      sourceSummary.textContent = 'Original sources'; sourceDetails.append(sourceSummary, researched, links);
      const actions = document.createElement('div'); actions.className = 'actions';
      const exportLink = blobLink(record.audio, 'radio-' + record.id + (record.mimeType.includes('mp4') ? '.m4a' : '.webm'), 'Export audio', libraryUrls);
      const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = 'Delete recording';
      remove.onclick = async () => { if (confirm('Delete this private recording from this browser? Export a copy first if you want to keep it.')) { await library.remove(record.id); await renderLibrary(); } };
      const rename = document.createElement('button'); rename.className='text-button'; rename.textContent='Rename';
      rename.onclick=async()=>{const title=prompt('Recording title',record.title);if(title?.trim()){await library.update(record.id,{title:title.trim().slice(0,180)});await renderLibrary();}};
      actions.append(exportLink, rename, remove);
      if(record.notes) actions.append(blobLink(new Blob([JSON.stringify(record.notes,null,2)],{type:'application/json'}),'radio-notes.json','Export transcript & notes', libraryUrls)); article.append(badge, title, meta, audio, sourceDetails, actions); $('library').append(article);
    }
  } catch (error) { $('library').textContent = 'Replay storage is unavailable: ' + error.message; }
}
async function init() {
  const status = await (await fetch('/api/status')).json();
  $('access').hidden = status.unlocked; $('studio').hidden = !status.unlocked;
  if (!status.unlocked) $('access-status').textContent = status.message || 'Open the protected radio Preview to use this studio.';
  if (status.unlocked) {
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
$('replay-search').oninput = () => void renderLibrary();
$('retry-access').onclick = () => init().catch(fail);
$('question-form').onsubmit = startShow;
$('run-pilot').onclick = event => {
  if (run) return;
  $('question').value = PILOT_QUESTION;
  $('pilot-status').textContent = 'Running one pilot. No automatic retries. Recording starts when the hosts are ready.';
  void startShow(event, true);
};
$('pilot-reload').onclick = () => { if (!run) location.reload(); };
$('pilot-download').onclick = () => {
  if (pilotReport) blobLink(new Blob([JSON.stringify({...pilotReport, checks: assessPilot(pilotReport)}, null, 2)], {type: 'application/json'}), 'radio-pilot-report.json', 'Download').click();
};
$('stop').onclick = () => void stopShow();
$('record').onclick = () => void toggleRecording();
$('volume').oninput = () => { if (run) run.master.gain.value = Number($('volume').value); };
$('followup-form').onsubmit = e => {
  e.preventDefault(); if (!run?.started || run.stopping) return;
  queueRelayFollowup(run, $('followup').value.trim()); $('followup').value = '';
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
