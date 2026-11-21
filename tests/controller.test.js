import test from 'node:test';
import assert from 'node:assert/strict';
import {duration, ago, safeSource} from '../site/assets/controller.js';
test('source links reject active protocols and replay labels preserve elapsed time', () => {
  assert.equal(safeSource('javascript:alert(1)'), false); assert.equal(safeSource('https://example.org/report'), true);
  assert.equal(duration(540), '09:00'); assert.equal(ago('2026-01-01T00:00:00Z', new Date('2026-01-01T02:00:00Z').getTime()), '2 hours ago');
});
