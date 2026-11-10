import { cacheTotals } from "./read-cache.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
const scope = new AsyncLocalStorage<{ documents: number; seen: WeakSet<object> }>();
let since = Date.now();
const totals = new Map<string, { requests: number; documents: number; failures: number }>();
export function measuredSnapshot<T extends { docs?: unknown[]; exists?: boolean }>(snapshot: T): T {
  const current = scope.getStore();
  if (current && !current.seen.has(snapshot)) {
    current.documents += snapshot.docs ? Math.max(1, snapshot.docs.length) : 1;
    current.seen.add(snapshot);
    for (const doc of snapshot.docs ?? []) if (typeof doc === "object" && doc !== null) current.seen.add(doc);
  }
  return snapshot;
}
export const readMetrics: RequestHandler = (req, res, next) => {
  scope.run({ documents: 0, seen: new WeakSet() }, () => {
    const current = scope.getStore()!;
    res.on("finish", () => {
      // Route templates only: never record tenant IDs, tokens, bodies or query strings.
      const key = `${req.method} ${req.route?.path ?? "unmatched"}`;
      const count = totals.get(key) ?? { requests: 0, documents: 0, failures: 0 };
      count.requests++; count.documents += current.documents;
      if (res.statusCode >= 500) count.failures++;
      totals.set(key, count);
      if (Date.now() - since >= 60_000) {
        console.info(JSON.stringify({ event: "firestore_read_estimates", windowMs: Date.now() - since, routes: Object.fromEntries(totals), cache: { ...cacheTotals } }));
        totals.clear(); cacheTotals.hits = 0; cacheTotals.misses = 0; since = Date.now();
      }
    });
    next();
  });
};
