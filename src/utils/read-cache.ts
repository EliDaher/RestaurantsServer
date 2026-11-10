export const cacheTotals = { hits: 0, misses: 0 };
/** Bounded, single-flight cache. Expiry starts BEFORE loading, never after it. */
export class ReadCache<T> {
  private entries = new Map<string, { until: number; value: Promise<T> }>();
  hits = 0;
  misses = 0;
  constructor(private ttl = 15_000, private capacity = 500) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    const current = this.entries.get(key);
    if (current && current.until > Date.now()) { this.hits++; cacheTotals.hits++; return current.value; }
    this.misses++; cacheTotals.misses++;
    const entry = { until: Date.now() + this.ttl, value: Promise.resolve().then(load) };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
    entry.value.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key); });
    return entry.value;
  }
  clear() { this.entries.clear(); }
  delete(key: string) { this.entries.delete(key); }
}
