'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
let mode = 'new', current = null, state = null, liveTimer = null, syncing = false;
let heard;
try { heard = new Set(JSON.parse(localStorage.getItem('radio.heard.v1') || '[]')); }
catch { heard = new Set(); }
function say(text) { $('status').textContent = text; }
function when(stamp) { return new Date(stamp * 1000).toLocaleString([], {dateStyle:'medium', timeStyle:'short'}); }
async function refresh() {
  const r = await fetch('/api/station', {cache:'no-store'});
  if (!r.ok) throw new Error('Station unavailable');
  state = await r.json();
  $('freshness').textContent = state.latest_published_at ? `Latest fresh edition · ${when(state.latest_published_at)}` : 'No fresh edition published yet';
  renderArchive();
  return state;
}
function element(tag, text, cls) { const e=document.createElement(tag); e.textContent=text; if(cls)e.className=cls; return e; }
function transcript(item) {
  $('transcript-panel').hidden = !item.transcript;
  if (!item.transcript) return;
  $('transcript-title').textContent = item.title;
  $('transcript').replaceChildren(...item.transcript.map(t => {
    const div=element('div','','turn');div.append(element('small',`${t.speaker.toUpperCase()} · ${t.kind.toUpperCase()}`),element('p',t.text));return div;
  }));
  $('sources').replaceChildren(...item.stories.map(s=>{
    const div=element('div','','source');div.append(element('small',s.kind.toUpperCase()),element('p',s.development),element('p',`What changed: ${s.material_change}`));
    for(const source of s.sources){const link=element('a',source.title);if(source.url.startsWith('https://'))link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';div.append(link);}return div;
  }));
}
function renderArchive() {
  if (!state.editions.length) return;
  $('editions').replaceChildren(...state.editions.map(e=>{
    const row=element('article','','edition'), text=element('div','');
    text.append(element('h3',e.title),element('p',`${when(e.published_at)} · ${Math.ceil(e.duration/60)} min · ${heard.has(e.id)?'Heard':'Unheard'}`));
    const button=element('button','Listen');button.onclick=()=>{mode='new';clearTimeout(liveTimer);playItem(e,0).catch(playError);};row.append(text,button);return row;
  }));
}
async function playItem(item, offset) {
  current=item;
  $('mode-label').textContent=mode==='live'?'SHARED UTC CLOCK':'ON DEMAND';
  $('now-title').textContent=item.title;
  $('now-description').textContent=item.kind==='evergreen'?item.description:'Alex & Morgan · Synthetic voices · Sources and transcript below';
  transcript(item);
  if(audio.getAttribute('src')!==item.audio_url){
    audio.src=item.audio_url;
    await new Promise((resolve,reject)=>{
      const done=()=>{audio.removeEventListener('loadedmetadata',good);audio.removeEventListener('error',bad);};
      const good=()=>{done();resolve();}; const bad=()=>{done();reject(new Error('Audio unavailable'));};
      audio.addEventListener('loadedmetadata',good,{once:true});audio.addEventListener('error',bad,{once:true});audio.load();
    });
  }
  audio.currentTime=Math.max(0,Math.min(offset,Math.max(0,audio.duration-0.2)));
  await audio.play();
  say(item.kind==='evergreen'?'Evergreen interlude · not a fresh news edition.':mode==='live'?'You’re tuned to the shared program clock.':'Playing an edition for you.');
  if('mediaSession' in navigator) navigator.mediaSession.metadata=new MediaMetadata({title:item.title,artist:'Radio · Alex & Morgan',album:'Radio'});
}
function playError(){say('Playback needs another tap, or the audio is temporarily unavailable. Use the audio controls or try Tune in live.');}
async function playNew(){
  mode='new';clearTimeout(liveTimer);
  try{
    await refresh();const next=state.editions.find(e=>!heard.has(e.id));
    if(!next){audio.pause();say(state.editions.length?'You’re caught up on this device. Tune in live for the station interlude.':'The first fresh edition hasn’t aired yet. Tune in live for the evergreen interlude.');return;}
    await playItem(next,0);
  }catch{playError();}
}
async function tuneLive(){
  if(syncing)return;
  syncing=true;clearTimeout(liveTimer);liveTimer=null;mode='live';
  try{
    const before=performance.now();await refresh();
    const live=state.live;
    await playItem(live.item,live.offset+(performance.now()-before)/2000);
    liveTimer=setTimeout(tuneLive,Math.max(1000,(live.next_boundary-state.server_time)*1000));
  }catch{say('The station clock is temporarily unavailable. Your loaded audio remains available.');liveTimer=setTimeout(tuneLive,30000);}
  finally{syncing=false;}
}
// Only a completed on-demand listen is marked heard. Joining near the end of live
// playback must not hide an edition the listener has never heard in full.
audio.addEventListener('ended',()=>{
  if(mode==='live'){tuneLive();return;}
  if(current && current.kind!=='evergreen'){
    heard.add(current.id);try{localStorage.setItem('radio.heard.v1',JSON.stringify([...heard].slice(-1000)));}catch{}
    renderArchive();say('Edition finished. Play something new to hear your next unheard edition.');
  }
});
audio.addEventListener('pause',()=>{if(mode==='live'){clearTimeout(liveTimer);liveTimer=null;}});
audio.addEventListener('play',()=>{if(mode==='live' && !liveTimer && !syncing)tuneLive();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && mode==='live' && !audio.paused)tuneLive();});
$('new-button').onclick=playNew;$('live-button').onclick=tuneLive;
setInterval(()=>{$('clock').textContent=new Date().toISOString().slice(11,19)+' UTC';},1000);
refresh().catch(()=>say('The newsroom is temporarily unavailable. Please try again shortly.'));
