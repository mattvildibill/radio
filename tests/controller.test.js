import test from 'node:test';
import assert from 'node:assert/strict';
import {FloorController, duration, ago, safeSource} from '../site/assets/controller.js';
function fixture() {
  let now = 0; const floors = [], stops = [], recoveries = [];
  const c = new FloorController({now: () => now, onFloor: (...x) => floors.push(x), onStop: x => stops.push(x), onRecover: x => recoveries.push(x)});
  c.start(); return {c, floors, stops, recoveries, tick(t, levels) { now = t; c.tick(levels); }};
}
test('handoff follows audible silence, never merely a transcript gap', () => {
  const f = fixture(); f.tick(1000, [0.04, 0]); f.tick(4000, [0.03, 0]); assert.equal(f.c.active, 0);
  f.tick(5100, [0, 0]); assert.equal(f.c.active, 0); f.tick(5300, [0, 0]); assert.equal(f.c.active, 1);
  assert.deepEqual(f.floors, [[0, 1], [1, 2]]);
});
test('silence gets one cue, then closes without creating another paid session', () => {
  const f = fixture(); f.tick(9100, [0, 0]); f.tick(12000, [0, 0]); assert.deepEqual(f.recoveries, [0]);
  f.tick(18100, [0, 0]); assert.equal(f.stops.length, 1); assert.equal(f.c.active, -1);
});
test('monologue has bounded floor and stop prevents future handoffs', () => {
  const f = fixture(); f.tick(39000, [0.1, 0]); assert.equal(f.c.active, 0); f.tick(40000, [0.1, 0]);
  assert.equal(f.c.active, 1); f.c.stop(); f.tick(90000, [0, 0.1]); assert.equal(f.floors.length, 2);
});
test('inactive-host audio does not count as active-host speech', () => {
  const f = fixture(); f.tick(9100, [0, 0.2]); assert.deepEqual(f.recoveries, [0]);
});
test('nine-minute show can keep handing off without a server streaming request', () => {
  const f = fixture();
  for (let t = 100; t < 540000; t += 100) { const levels = [0, 0]; if (t % 20000 < 18000) levels[f.c.active] = 0.05; f.tick(t, levels); }
  assert.ok(f.floors.length >= 25); assert.equal(f.stops.length, 0);
});
test('source links reject active protocols and replay labels preserve elapsed time', () => {
  assert.equal(safeSource('javascript:alert(1)'), false); assert.equal(safeSource('https://example.org/report'), true);
  assert.equal(duration(540), '09:00'); assert.equal(ago('2026-01-01T00:00:00Z', new Date('2026-01-01T02:00:00Z').getTime()), '2 hours ago');
});
