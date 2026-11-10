import assert from "node:assert/strict";
import { test, beforeEach, mock } from "node:test";
import express from "express";
import { store, db, readCalls, failReads } from "./firestore-fixture.mjs";
mock.module("../dist/config/firebase.js", { namedExports: { db, FieldValue: { serverTimestamp: () => new Date().toISOString(), increment: n => ({ increment: n }) } } });
const { ReadCache } = await import("../dist/utils/read-cache.js");
const { runLoggedTransaction } = await import("../dist/modules/sync/logged-transaction.js");
const { listChanges } = await import("../dist/modules/sync/change-log.js");
const { snapshotPage } = await import("../dist/modules/sync/snapshot.js");
const restaurants = await import("../dist/services/restaurants.js");
const { getPublicMenu, publicLookups, publicMenus } = await import("../dist/services/public-menu.js");
const { isResourceExhausted } = await import("../dist/utils/firestore-errors.js");
const { pushOperations } = await import("../dist/modules/sync/service.js");
const { errorHandler } = await import("../dist/middleware/error.js");
const { waiterHistory, waiterHistoryCache } = await import("../dist/services/waiter-history.js");
const path = (collection, id) => `restaurants/r/${collection}/${id}`;
beforeEach(() => {
  store.clear(); readCalls.length = 0; failReads(undefined);
  publicLookups.clear(); publicMenus.clear(); waiterHistoryCache.clear();
  process.env.INCREMENTAL_SYNC_TENANTS = "r";
  store.set("restaurants/r", { slug: "restaurant", isActive: true, plan: "basic", subscriptionStatus: "active" });
});
test("cache coalesces concurrent work, expires, is bounded and never caches errors", async () => {
  const cache = new ReadCache(10, 2); let calls = 0;
  const loader = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get("a", loader), cache.get("a", loader)]), [1, 1]);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(await cache.get("a", loader), 2);
  await cache.get("b", loader); await cache.get("c", loader);
  assert.equal(await cache.get("a", loader), 5);
  await assert.rejects(cache.get("failure", async () => { throw new Error("down"); }));
  assert.equal(await cache.get("failure", loader), 6);
});
test("direct transaction journals every side effect atomically and preserves rollback", async () => {
  await runLoggedTransaction(db, async tx => {
    tx.set(db.collection("restaurants").doc("r").collection("orders").doc("o"), { status: "PENDING", version: 1 });
    tx.set(db.collection("restaurants").doc("r").collection("accounts").doc("a"), { name: "Cash" });
  });
  const result = await listChanges("r", 0);
  assert.deepEqual(result.changes.map(c => c.entityType).sort(), ["account", "order"]);
  assert.equal(result.changes.find(c => c.entityType === "account").data.name, "Cash");
  const before = structuredClone([...store]);
  await assert.rejects(runLoggedTransaction(db, async tx => {
    tx.delete(db.collection("restaurants").doc("r").collection("orders").doc("o"));
    throw new Error("abort");
  }));
  assert.deepEqual([...store], before);
});
test("snapshot and journal preserve more than 500 records and resolve deletion", async () => {
  for (let i = 0; i < 1001; i++) store.set(path("orders", String(i).padStart(4, "0")), { version: i, status: "COMPLETED" });
  const first = await snapshotPage("r", "order");
  const second = await snapshotPage("r", "order", first.after);
  const third = await snapshotPage("r", "order", second.after);
  assert.deepEqual([first.records.length, second.records.length, third.records.length], [500, 500, 1]);
  assert.equal(third.hasMore, false);
  for (let i = 1; i <= 501; i++) store.set(path("changeLog", String(i).padStart(20, "0")), { cursor: i, entityType: "order", entityId: "0000", action: "upsert", version: 1 });
  store.set(path("syncMeta", "main"), { cursor: 501 });
  const page = await listChanges("r", 0);
  assert.equal(page.cursor, 500); assert.equal(page.hasMore, true);
  store.delete(path("orders", "0000"));
  store.set(path("changeLog", String(502).padStart(20, "0")), { cursor: 502, entityType: "order", entityId: "0002", action: "upsert", version: 1 });
  store.set(path("syncMeta", "main"), { cursor: 502 });
  const last = await listChanges("r", page.cursor, page.throughCursor);
  assert.equal(last.changes[0].action, "delete"); assert.equal(last.hasMore, false);
  assert.equal(last.cursor, 501);
  assert.equal((await listChanges("r", last.cursor)).cursor, 502);
  await assert.rejects(snapshotPage("other", "order"));
});
test("public menu is reused and an atomic edit changes its version and invalidates it", async () => {
  store.set(path("categories", "c"), { name: "Food", isActive: true, order: 1 });
  store.set(path("items", "i"), { name: "Meal", price: 10, isAvailable: true, order: 1 });
  await Promise.all(Array.from({ length: 20 }, () => getPublicMenu("restaurant")));
  assert.equal(readCalls.filter(p => p === path("items", "").slice(0, -1)).length, 1);
  const oldVersion = store.get("restaurants/r").publicMenuVersion;
  await restaurants.updateItem("r", "i", { price: 20 });
  assert.notEqual(store.get("restaurants/r").publicMenuVersion, oldVersion);
  assert.equal((await getPublicMenu("restaurant")).menu.items[0].price, 20);
  store.set("restaurants/r", { ...store.get("restaurants/r"), isActive: false });
  publicLookups.clear(); // another replica's 15-second validation boundary
  await assert.rejects(getPublicMenu("restaurant"));
});
test("menu counters initialize once and deletions are idempotent", async () => {
  const first = await restaurants.createCategory("r", { name: "One", order: 1, isActive: true });
  const countReads = readCalls.filter(p => p === "restaurants/r/categories").length;
  await restaurants.createCategory("r", { name: "Two", order: 2, isActive: true });
  assert.equal(readCalls.filter(p => p === "restaurants/r/categories").length, countReads);
  assert.equal(store.get(path("usageMeta", "categories")).count, 2);
  await restaurants.deleteCategory("r", first.id); await restaurants.deleteCategory("r", first.id);
  assert.equal(store.get(path("usageMeta", "categories")).count, 1);
});
test("quota failures are sanitized and temporary in both HTTP and per-operation results", async () => {
  for (const code of [8, "8", "RESOURCE_EXHAUSTED", "firestore/resource-exhausted"]) assert.ok(isResourceExhausted({ code }));
  let status, body;
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { body = value; } };
  errorHandler({ code: 8, details: "private metadata" }, {}, res, () => {});
  assert.equal(status, 503); assert.equal(body.error.code, "firestore_resource_exhausted");
  assert.ok(!JSON.stringify(body).includes("private"));
  failReads({ code: 8 });
  const operations = [1, 2].map(i => ({ operationId: `op${i}`, entityType: "order", entityId: "o", action: "create", payload: {}, dependencyIds: [], clientCreatedAt: "" }));
  const result = await pushOperations("r", { id: "owner", email: "owner@example.test", role: "restaurantOwner", permissions: [] }, "device", operations);
  assert.equal(result.results.length, 2);
  for (const item of result.results) { assert.equal(item.error.code, "firestore_resource_exhausted"); assert.equal(item.error.retryable, true); }
});
test("indexed waiter history fetches only new batches and legacy history stays available", async () => {
  store.set(path("orders", "o"), { waiterBatchSequenceReady: true });
  store.set(path("waiterBatches", "b1"), { orderId: "o", batchCursor: 1, acceptedAt: "1" });
  store.set(path("waiterBatches", "b2"), { orderId: "o", batchCursor: 2, acceptedAt: "2" });
  const result = await waiterHistory("r", "o", 1);
  assert.equal(result.batches.length, 1); assert.equal(result.cursor, 2);
  store.set(path("orders", "o"), {}); waiterHistoryCache.clear();
  assert.equal((await waiterHistory("r", "o", 0)).batches.length, 2);
});
test("authenticated health reads no Firestore documents even during quota exhaustion", async () => {
  const { syncRouter } = await import("../dist/modules/sync/routes.js");
  const app = express();
  app.use((req, _res, next) => { req.user = { restaurantId: "r" }; next(); });
  app.use(syncRouter);
  failReads({ code: 8 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).data.restaurantId, "r");
    assert.equal(readCalls.length, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
