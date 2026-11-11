/**
 * Estimates the offset between server time and local time (offset = server - local),
 * NTP style: keep the sample with the lowest round-trip time from a sliding window.
 */
export class TimeSync {
  private samples: { offset: number; rtt: number; at: number }[] = [];
  offset = 0;
  rtt = Number.POSITIVE_INFINITY;
  synced = false;

  addSample(t0: number, serverTime: number, t1: number): { changedBy: number } {
    const rtt = Math.max(0, t1 - t0);
    const offset = serverTime - (t0 + rtt / 2);
    this.samples.push({ offset, rtt, at: t1 });
    if (this.samples.length > 12) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    const changedBy = Math.abs(best.offset - this.offset);
    this.offset = best.offset;
    this.rtt = best.rtt;
    this.synced = true;
    return { changedBy };
  }

  reset() {
    this.samples = [];
    this.synced = false;
  }
}
