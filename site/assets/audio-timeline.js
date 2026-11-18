// Absorb ordinary packet jitter without inserting a fresh gap for every packet.
export class AudioTimeline {
  constructor(bufferSeconds = 0.24) { this.bufferSeconds = bufferSeconds; this.next = null; this.underruns = 0; }
  schedule(now, duration) {
    if (this.next === null || this.next < now) {
      if (this.next !== null) this.underruns++;
      this.next = now + this.bufferSeconds;
    }
    const at = this.next;
    this.next += duration;
    return at;
  }
}
