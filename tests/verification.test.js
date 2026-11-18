import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPilot} from '../site/assets/verification.js';

test('failed or absent evidence never passes the pilot', () => {
  assert.ok(assessPilot({}).every(check => !check.passed));
  assert.ok(assessPilot({events: [{type: 'research-started'}], usage: [null, null], error: 'quota'}).every(check => !check.passed));
});
test('captions and delivered follow-up alone cannot claim audio or response success', () => {
  const report = {events: [{type: 'followup-delivered', at: '2026-11-18T12:00:10Z'}], transcripts: [
    {host: 'Mara', type: 'session.output_transcript.delta', at: '2026-11-18T12:00:09Z', delta: 'Earlier speech'},
  ]};
  assert.ok(assessPilot(report).every(check => !check.passed));
});
test('media evidence stays separate from post-reload persistence and semantic review', () => {
  const report = {events: [
    {type: 'research-completed'}, {type: 'session-started'},
    {type: 'audio-level', floor: 0, rms: [0.1, 0]},
    {type: 'audio-level', floor: 1, rms: [0, 0.2]},
    {type: 'followup-delivered', at: '2026-11-18T12:00:10Z'},
  ], transcripts: [
    ...['Mara', 'Eli'].map(host => ({host, type: 'session.input_transcript.delta', delta: 'What I heard'})),
    {host: 'Mara', onAir: true, type: 'session.output_transcript.delta', at: '2026-11-18T12:00:11Z', delta: 'Next speech'},
  ], usage: [{final: true, seconds: 90}, {final: true, seconds: 91}], recordingId: 'saved-id'};
  const checks = assessPilot(report);
  assert.ok(checks.slice(0, 6).every(check => check.passed));
  assert.ok(checks.slice(6).every(check => !check.passed));
  report.replay = {decodedAfterReload: true, playedAfterReload: true};
  assert.ok(assessPilot(report).every(check => check.passed));
  report.usage[1].final = false;
  assert.equal(assessPilot(report)[4].passed, false);
});
