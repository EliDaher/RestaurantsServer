export const cacheTotals = { hits: 0, misses: 0 };
/** Bounded, single-flight cache. Expiry starts BEFORE loading, never after it. */
export class ReadCache {
    ttl;
    capacity;
    entries = new Map();
    hits = 0;
    misses = 0;
    constructor(ttl = 15_000, capacity = 500) {
        this.ttl = ttl;
        this.capacity = capacity;
    }
    get(key, load) {
        const current = this.entries.get(key);
        if (current && current.until > Date.now()) {
            this.hits++;
            cacheTotals.hits++;
            return current.value;
        }
        this.misses++;
        cacheTotals.misses++;
        const entry = { until: Date.now() + this.ttl, value: Promise.resolve().then(load) };
        this.entries.delete(key);
        this.entries.set(key, entry);
        while (this.entries.size > this.capacity)
            this.entries.delete(this.entries.keys().next().value);
        entry.value.catch(() => { if (this.entries.get(key) === entry)
            this.entries.delete(key); });
        return entry.value;
    }
    clear() { this.entries.clear(); }
    delete(key) { this.entries.delete(key); }
}
