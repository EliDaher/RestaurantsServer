/** Explicitly scoped, resumable migration. Default: report only. Never runs at startup. */
import { db } from "../config/firebase.js";
import { normalizeTableName } from "../modules/restaurant-ops/table-name.js";
import { tableNameReservationId } from "../modules/restaurant-ops/table-uniqueness.js";
import { runLoggedTransaction } from "../modules/sync/logged-transaction.js";

const tenant = process.argv.find(arg => arg.startsWith("--tenant="))?.slice(9);
if (!tenant || tenant.includes("/")) throw new Error("Required: --tenant=RESTAURANT_ID [--apply]");
const apply = process.argv.includes("--apply");
const parent = db.collection("restaurants").doc(tenant);
if (!(await parent.get()).exists) throw new Error("Restaurant not found");
for (const collection of ["items", "categories"] as const) {
  const result = await db.runTransaction(async tx => {
    const docs = await tx.get(parent.collection(collection));
    const counter = await tx.get(parent.collection("usageMeta").doc(collection));
    if (apply) tx.set(counter.ref, { count: docs.size, schemaVersion: 1 });
    return { collection, actual: docs.size, previous: counter.data()?.count ?? null };
  });
  console.info(JSON.stringify({ mode: apply ? "apply" : "preview", ...result }));
}
// Cursor checkpoint is committed together with each reservation page. Every writer
// reads the readiness document, so enabling the fast path conflicts with old scans.
let after: string | undefined;
if (apply) after = (await parent.collection("optimizationMeta").doc("tableMigration").get()).data()?.after;
while (true) {
  const pageResult = await db.runTransaction(async tx => {
    const checkpoint = parent.collection("optimizationMeta").doc("tableMigration");
    const ready = parent.collection("optimizationMeta").doc("main");
    let query = parent.collection("tables").orderBy("__name__").limit(150);
    if (after) query = query.startAfter(after);
    const page = await tx.get(query);
    const peers = await tx.get(parent.collection("tables"));
    const reservations: Array<{ ref: FirebaseFirestore.DocumentReference; data: object }> = [];
    for (const table of page.docs) {
      if (table.data().deletedAt) continue;
      const normalizedName = normalizeTableName(String(table.data().name ?? ""));
      const ref = parent.collection("tableNameReservations").doc(tableNameReservationId(normalizedName));
      const existing = await tx.get(ref);
      // Check legacy peers in this transaction before trusting any reservation.
      if (!normalizedName || peers.docs.some(p => p.id !== table.id && !p.data().deletedAt && normalizeTableName(String(p.data().name ?? "")) === normalizedName)) {
        throw new Error("Duplicate/empty table names: resolve with audit-table-numbers before applying");
      }
      if (existing.exists && existing.data()?.tableId !== table.id) throw new Error("Conflicting table reservation: run table audit");
      reservations.push({ ref, data: { normalizedName, tableId: table.id } });
    }
    if (apply) {
      reservations.forEach(r => tx.set(r.ref, r.data));
      tx.set(checkpoint, { after: page.docs.at(-1)?.id ?? after ?? "", complete: page.size < 150 });
      if (page.size < 150) tx.set(ready, { tableReservationsReady: true }, { merge: true });
    }
    return { after: page.docs.at(-1)?.id ?? after, done: page.size < 150 };
  });
  // Advance external state only after commit; transaction callbacks may retry.
  after = pageResult.after;
  if (pageResult.done) break;
}
// Old histories are indexed in pages. Concurrent additions change the order's
// cursor; restart that order safely while clients continue the legacy fallback.
let orderAfter: string | undefined;
while (true) {
  let query = parent.collection("orders").orderBy("__name__").limit(100);
  if (orderAfter) query = query.startAfter(orderAfter);
  const orders = await query.get();
  for (const order of orders.docs) {
    if (order.data().waiterBatchSequenceReady === true) continue;
    if (!apply) { console.info(JSON.stringify({ event: "history_requires_index", orderId: order.id })); continue; }
    const checkpoint = parent.collection("optimizationMeta").doc(`history_${order.id}`);
    let complete = false;
    while (!complete) {
      complete = await runLoggedTransaction(db, async tx => {
        const current = await tx.get(order.ref);
        if (!current.exists || current.data()?.waiterBatchSequenceReady) return true;
        const saved = await tx.get(checkpoint);
        const epoch = Number(current.data()?.waiterBatchCursor ?? 0);
        const progress = saved.data()?.epoch === epoch ? saved.data()! : { epoch, sequence: 0, after: null };
        let batches = parent.collection("waiterBatches").where("orderId", "==", order.id).orderBy("__name__").limit(200);
        if (progress.after) batches = batches.startAfter(progress.after);
        const page = await tx.get(batches);
        let sequence = Number(progress.sequence);
        page.docs.forEach(batch => tx.update(batch.ref, { batchCursor: ++sequence }));
        tx.set(checkpoint, { epoch, sequence, after: page.docs.at(-1)?.id ?? progress.after });
        if (page.size < 200) tx.update(order.ref, { waiterBatchSequenceReady: true, waiterBatchCursor: sequence });
        return page.size < 200;
      });
    }
  }
  orderAfter = orders.docs.at(-1)?.id;
  if (orders.size < 100) break;
}
console.info(JSON.stringify({ event: "read_optimization_prepared", apply }));
