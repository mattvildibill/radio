// These are transport/media observations, never a substitute for listening.
export const PILOT_QUESTION = 'What does the best evidence say about a four-day workweek with no pay cut? Where does it work, and where might it fail?';
export const PILOT_FOLLOWUP = 'What changes for a hospital that must staff every day? Discuss patient coverage and staffing costs, and distinguish evidence from assumptions.';
export const REPORT_KEY = 'radio-last-pilot-report-v1';

export function assessPilot(report) {
  const events = report.events || [], transcripts = report.transcripts || [];
  const research = events.findIndex(e => e.type === 'research-completed');
  const firstSession = events.findIndex(e => e.type === 'session-started');
  const firstSound = events.findIndex(e => e.type === 'audio-level' && e.rms[e.floor] > 0.009);
  const delivered = events.find(e => e.type === 'followup-delivered');
  const checks = [
    ['Sourced research finished before either host started', research >= 0 && firstSession > research && firstSound > research],
    ['Both host outputs contained on-air audio', [0, 1].every(i => events.some(e => e.type === 'audio-level' && e.floor === i && e.rms[i] > 0.009))],
    ['Both hosts transcribed incoming co-host audio', ['Mara', 'Eli'].every(host => transcripts.some(t => t.host === host && t.type === 'session.input_transcript.delta' && t.delta?.trim()))],
    ['Follow-up delivered, with host speech afterward', Boolean(delivered && transcripts.some(t => t.type === 'session.output_transcript.delta' && t.onAir && t.at > delivered.at && t.delta?.trim()))],
    ['Both sessions confirmed closure and final usage', report.usage?.length === 2 && report.usage.every(u => u?.final && Number.isFinite(u.seconds))],
    ['Recording saved', Boolean(report.recordingId)],
    ['Saved audio decoded after page reload', Boolean(report.replay?.decodedAfterReload)],
    ['Saved recording played after page reload', Boolean(report.replay?.playedAfterReload)],
  ];
  return checks.map(([label, passed]) => ({label, passed}));
}
