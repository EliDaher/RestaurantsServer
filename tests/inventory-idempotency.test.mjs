import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
import { db, store, failReads } from "./firestore-fixture.mjs";
mock.module("../dist/config/firebase.js", { namedExports: { db, FieldValue: { serverTimestamp: () => new Date().toISOString() } } });
const { pushOperations } = await import("../dist/modules/sync/service.js");
const { createPayment, deletePayment } = await import("../dist/modules/restaurant-ops/service.js");
const user = { id: "owner", email: "owner@test.test", role: "restaurantOwner" };
const operation = { operationId: "inventory-op", entityId: "movement", entityType: "inventoryTransaction", action: "adjustInventory", payload: { inventoryItemId: "stock", type: "OUT", quantity: 3, reason: "manual" }, dependencyIds: [], clientCreatedAt: "" };
beforeEach(() => { store.clear(); failReads(undefined); store.set("restaurants/r/inventoryItems/stock", { restaurantId: "r", currentQuantity: 10 }); });
test("lost inventory acknowledgment retries the same movement without a second stock deduction", async () => {
  const first = await pushOperations("r", user, "device", [operation]);
  const retry = await pushOperations("r", user, "device", [operation]);
  assert.equal(first.results[0].status, "applied"); assert.equal(retry.results[0].status, "duplicate");
  assert.equal(store.get("restaurants/r/inventoryItems/stock").currentQuantity, 7);
  assert.equal([...store.keys()].filter(key => key.includes("/inventoryTransactions/")).length, 1);
  const mismatch = await pushOperations("r", user, "device", [{ ...operation, payload: { ...operation.payload, quantity: 5 } }]);
  assert.equal(mismatch.results[0].error.code, "operation_reuse");
  assert.equal(store.get("restaurants/r/inventoryItems/stock").currentQuantity, 7);
});
test("Firestore deadline, unavailable and contention errors are retryable", async () => {
  for (const code of [4, 10, 13, 14, "unavailable", "DEADLINE_EXCEEDED"]) {
    failReads(Object.assign(new Error("temporary"), { code }));
    const result = await pushOperations("r", user, "device", [operation]);
    assert.equal(result.results[0].error.retryable, true, String(code));
  }
  failReads(undefined);
});
test("a missing inventory parent retries without creating a movement", async () => {
  store.clear();
  const result = await pushOperations("r", user, "device", [operation]);
  assert.equal(result.results[0].error.retryable, true);
  assert.equal(store.size, 0);
});
test("direct payment receipt survives record deletion and lost-response retries", async () => {
  const input = { amount: 100, currency: "SYP", method: "CASH", type: "SALE", invoiceId: "", orderId: "", supplierId: "", note: "" };
  assert.deepEqual(await createPayment("r", input, "owner", "payment-key"), { id: "payment-key" });
  await deletePayment("r", "payment-key");
  await createPayment("r", input, "owner", "payment-key");
  assert.equal(store.has("restaurants/r/payments/payment-key"), false);
  await assert.rejects(createPayment("r", { ...input, amount: 200 }, "owner", "payment-key"), /reused/);
});
