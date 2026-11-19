import test from 'node:test';
import assert from 'node:assert/strict';
import {enableAudio, preferPlayback, audioInterrupted} from '../site/assets/audio-start.js';
test('resume is checked rather than assuming a fulfilled promise means sound is enabled', async()=>{
 assert.equal(await enableAudio({state:'suspended',resume:async()=>{}}),false);
 assert.equal(await enableAudio({state:'running',resume:async()=>{}}),true);
 assert.equal(await enableAudio({state:'interrupted',resume:async()=>{throw new Error('blocked');}}),false);
});
test('blocked mobile resume cannot hang startup forever',async()=>{
 assert.equal(await enableAudio({state:'suspended',resume:()=>new Promise(()=>{})},5),false);
});
test('optional playback category and interrupted state are supported',()=>{
 const nav={audioSession:{type:'ambient'}};preferPlayback(nav);assert.equal(nav.audioSession.type,'playback');
 preferPlayback({});preferPlayback({get audioSession(){throw new Error('unsupported');}});
 assert.equal(audioInterrupted('interrupted'),true);assert.equal(audioInterrupted('suspended'),true);
 assert.equal(audioInterrupted('running'),false);
});
