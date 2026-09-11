/** Bounded single-process fixed-window limiter. No timers or distributed state. */
export class McpRateLimit {
  private windows = new Map<string, { end: number; used: number }>();
  constructor(
    private limit = 120,
    private windowMs = 60000,
    private clock = Date.now,
  ) {}
  take(userId: string): boolean {
    const now = this.clock();
    for (const [id, entry] of this.windows) {
      if (entry.end <= now) this.windows.delete(id);
    }
    let entry = this.windows.get(userId);
    if (!entry) {
      if (this.windows.size >= 10000) return false;
      entry = { end: now + this.windowMs, used: 0 };
      this.windows.set(userId, entry);
    }
    if (entry.used >= this.limit) return false;
    entry.used++;
    return true;
  }
}
