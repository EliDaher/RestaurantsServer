import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { io as client } from "../../frontend/node_modules/socket.io-client/build/esm/index.js";
import { db, store } from "./firestore-fixture.mjs";
mock.module("../dist/config/env.js", { namedExports: { env: { JWT_SECRET: "test-secret-at-least-16", CORS_ORIGIN: "http://localhost:3000" } } });
mock.module("../dist/config/firebase.js", { namedExports: { db, FieldValue: {} } });
const { attachRealtime } = await import("../dist/realtime.js");
const { runLoggedTransaction } = await import("../dist/modules/sync/logged-transaction.js");
const { committedChanges } = await import("../dist/services/realtime.js");
const once = (socket, event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), 3000);
  socket.once(event, value => { clearTimeout(timer); resolve(value); });
});
test("authenticated tenant sockets receive only committed changes and reconnect", async () => {
  store.set("users/owner", { isActive: true, restaurantId: "r", role: "restaurantOwner" });
  store.set("users/waiter", { isActive: true, restaurantId: "other", role: "WAITER" });
  const server = createServer();
  const io = attachRealtime(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const token = (id, restaurantId, role) => jwt.sign({ id, restaurantId, role }, "test-secret-at-least-16", { expiresIn: "1h" });
  const owner = client(url, { auth: { token: token("owner", "r", "restaurantOwner") }, autoConnect: false });
  const other = client(url, { auth: { token: token("waiter", "other", "WAITER") }, autoConnect: false });
  const invalid = client(url, { auth: { token: token("waiter", "r", "WAITER") }, autoConnect: false, reconnection: false });
  try {
    const connections = [once(owner, "connect"), once(other, "connect"), once(invalid, "connect_error")];
    owner.connect(); other.connect(); invalid.connect(); await Promise.all(connections);
    let foreign = 0, emitted = 0;
    other.on("sync:changed", () => foreign++);
    const listener = event => { emitted++; assert.ok(store.has(`restaurants/r/orders/${event.changes[0].entityId}`)); };
    committedChanges.on("committed", listener);
    try {
      await assert.rejects(runLoggedTransaction(db, async tx => {
        tx.set(db.collection("restaurants").doc("r").collection("orders").doc("failed"), { status: "PENDING" });
        throw new Error("rollback");
      }));
      assert.equal(emitted, 0);
      const update = once(owner, "sync:changed");
      await runLoggedTransaction(db, async tx => tx.set(db.collection("restaurants").doc("r").collection("orders").doc("o"), { status: "PENDING", version: 2 }));
      const event = await update;
      assert.equal(event.tenantId, "r"); assert.equal(event.cursor, 1);
      assert.equal(event.changes[0].entityId, "o"); assert.equal(foreign, 0);
      owner.disconnect(); const reconnected = once(owner, "connect"); owner.connect(); await reconnected;
      assert.equal(emitted, 1);
    } finally { committedChanges.off("committed", listener); }
  } finally { owner.disconnect(); other.disconnect(); invalid.disconnect(); await new Promise(resolve => io.close(resolve)); }
});
