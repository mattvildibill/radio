// GPT-Live has no response.done / output-audio-done event. Detect actual media
// activity; transcript delivery alone must never determine a handoff.
export class FloorController {
  constructor({now, onFloor, onStop, onRecover}) {
    Object.assign(this, {now, onFloor, onStop, onRecover});
    this.active = -1; this.turns = 0; this.recovered = false;
  }
  start() { this.change(0); }
  change(index) {
    this.active = index; this.since = this.now(); this.lastSound = this.since;
    this.heard = false; this.turns++; this.recovered = false;
    this.onFloor(index, this.turns);
  }
  tick(levels) {
    if (this.active < 0) return;
    const now = this.now(), age = now - this.since;
    if (levels[this.active] > 0.009) { this.lastSound = now; this.heard = true; }
    if (this.heard && age > 3500 && now - this.lastSound > 1250) {
      this.change(1 - this.active);
    } else if (age >= 40000) {
      this.change(1 - this.active);
    } else if (!this.heard && age > 18000) {
      this.active = -1; this.onStop('The audio connection went quiet. Both sessions are closing.');
    } else if (!this.heard && age > 9000 && !this.recovered) {
      this.recovered = true; this.onRecover(this.active);
    }
  }
  stop() { this.active = -1; }
}
export function safeSource(url) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}
export function duration(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
export function ago(date, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
  if (!minutes) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
