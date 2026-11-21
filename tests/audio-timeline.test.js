import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudioTimeline} from '../site/assets/audio-timeline.js';
test('bursty packets remain contiguous within the jitter buffer', () => {
 const t = new AudioTimeline();
 const arrival = [0, .04, .13, .131, .20, .201];
 const starts = arrival.map(now => t.schedule(now, .04));
 for (let i=1;i<starts.length;i++) assert.ok(Math.abs(starts[i]-starts[i-1]-.04)<1e-9);
 assert.equal(t.underruns,0);
});
test('a real underrun re-buffers once without overlapping audio', () => {
 const t = new AudioTimeline(); t.schedule(0,.04);
 assert.equal(t.schedule(1,.04),1.24);
 assert.equal(t.schedule(1.01,.04),1.28);
 assert.equal(t.underruns,1);
});
