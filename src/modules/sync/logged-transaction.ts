import { measuredSnapshot } from "../../utils/read-metrics.js";
import { randomUUID } from "node:crypto";
import type { Firestore, Transaction, ReadWriteTransactionOptions } from "firebase-admin/firestore";
import { publicInvalidation } from "../../services/public-invalidation.js";

export const entityCollections = {
  table: "tables", order: "orders", inventoryItem: "inventoryItems",
  inventoryTransaction: "inventoryTransactions", recipeIngredient: "recipeIngredients",
  supplier: "suppliers", invoice: "invoices", payment: "payments", expense: "expenses",
  cashRegister: "cashRegisters", cashMovement: "cashMovements", account: "accounts",
  journalEntry: "journalEntries", category: "categories", menuItem: "items"
} as const;
const entities: Map<string, string> = new Map(Object.entries(entityCollections).map(([entity, collection]) => [collection, entity]));

/** Buffer writes so the business callback and the journal can finish ALL reads first.
 * Existing sync records are preserved; missing side effects receive invalidations.
 * Invalidations resolve authoritative documents during pull (including FieldValues).
 */
export async function runLoggedTransaction<T>(firestore: Firestore, callback: (tx: Transaction) => Promise<T>, options?: ReadWriteTransactionOptions): Promise<T> {
  const result = await firestore.runTransaction(async raw => {
    const writes: Array<{ method: string; args: any[] }> = [];
    const proxy = new Proxy(raw, {
      get(target, property) {
        if (["set", "update", "delete", "create"].includes(String(property))) {
          return (...args: any[]) => { writes.push({ method: String(property), args }); return proxy; };
        }
        if (property === "get") return async (...args: any[]) => measuredSnapshot(await (target.get as any)(...args));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const value = await callback(proxy);
    const changed = new Map<string, { tenant: string; entity: string; id: string; action: string }>();
    const covered = new Set<string>();
    const invalidated = new Set<string>();
    for (const { method, args } of writes) {
      const parts = String(args[0].path).split("/");
      if (parts[0] !== "restaurants") continue;
      if (parts.length === 2 || (parts.length === 4 && ["items", "categories"].includes(parts[2]))) invalidated.add(parts[1]);
      if (parts.length !== 4) continue;
      if (parts[2] === "changeLog") {
        covered.add(`${parts[1]}/${args[1].entityType}/${args[1].entityId}`);
      }
      const entity = entities.get(parts[2]);
      if (entity) changed.set(`${parts[1]}/${entity}/${parts[3]}`, { tenant: parts[1], entity, id: parts[3], action: method === "delete" ? "delete" : "upsert" });
    }
    const tenants = new Set([...changed.values()].filter(c => !covered.has(`${c.tenant}/${c.entity}/${c.id}`)).map(c => c.tenant));
    for (const tenant of tenants) {
      const meta = firestore.collection("restaurants").doc(tenant).collection("syncMeta").doc("main");
      const pendingMeta = writes.filter(w => w.args[0].path === meta.path).at(-1);
      let cursor = pendingMeta ? Number(pendingMeta.args[1].cursor ?? 0) : Number((await raw.get(meta)).data()?.cursor ?? 0);
      const changedAt = new Date().toISOString();
      for (const [key, change] of changed) {
        if (change.tenant !== tenant || covered.has(key)) continue;
        cursor++;
        writes.push({ method: "set", args: [firestore.collection("restaurants").doc(tenant).collection("changeLog").doc(String(cursor).padStart(20, "0")), {
          cursor, entityType: change.entity, entityId: change.id, action: change.action,
          version: Date.now(), changedAt, invalidation: true
        }] });
      }
      writes.push({ method: "set", args: [meta, { cursor, updatedAt: changedAt }, { merge: true }] });
    }
    for (const tenant of invalidated) {
      // Updating metadata and all menu writes is one commit; remote replicas check it.
      if (!writes.some(w => w.method === "delete" && w.args[0].path === `restaurants/${tenant}`)) {
        writes.push({ method: "update", args: [firestore.collection("restaurants").doc(tenant), { publicMenuVersion: randomUUID() }] });
      }
    }
    for (const write of writes) (raw as any)[write.method](...write.args);
    return { value, invalidated: [...invalidated] };
  }, options);
  if (result.invalidated.length) publicInvalidation.emit("changed");
  return result.value;
}
