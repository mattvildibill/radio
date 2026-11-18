// Preserve actual aired words, with early context and recent exchanges. No new AI call.
export function episodeMemory(transcripts, events) {
 const turns = [];
 for (const t of transcripts) {
  if (t.type !== 'session.output_transcript.delta' || !t.onAir) continue;
  if (turns.at(-1)?.host !== t.host) turns.push({host:t.host, text:''});
  turns.at(-1).text += t.delta || '';
 }
 const render = values => values.map(t => `${t.host}: ${t.text}`).join('\n');
 const opening = render(turns.slice(0,2)).slice(0,2500);
 const recent = render(turns.slice(2)).slice(-10500);
 const requests = events.filter(e=>e.type==='followup-delivered').map(e=>e.text).join('\n').slice(-3000);
 return `Opening context (already covered; do not reintroduce):\n${opening}\nRecent actual discussion (preserve stated views and open questions):\n${recent}\nListener requests already delivered:\n${requests}`;
}
