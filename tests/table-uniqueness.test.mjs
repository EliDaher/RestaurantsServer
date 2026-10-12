import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorHandler } from "../dist/middleware/error.js";
import {
  createTableWithUniqueName as createTable, updateTableWithUniqueName as updateTable,
  deleteTableWithUniqueName as deleteTable, prepareTableNameReservation,
  tableNameReservationId
} from "../dist/modules/restaurant-ops/table-uniqueness.js";
import { normalizeTableName, findTableNameDuplicates } from "../dist/modules/restaurant-ops/table-name.js";

// Optimistic transaction harness models document read conflicts and query changes.
// It retries conflicted callbacks and commits the complete write set atomically.
// No Firebase credentials or production writes are used by this test suite.
class TestFirestore {
  records = new Map();
  versions = new Map();
  epochs = new Map();
  collection(path) { return new Collection(this, path); }
  seed(path, data) {
    this.records.set(path, structuredClone(data));
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
    const parent = path.substring(0, path.lastIndexOf("/"));
    this.epochs.set(parent, (this.epochs.get(parent) ?? 0) + 1);
  }
  async runTransaction(action) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = new TestTransaction(this);
      const result = await action(tx);
      if ([...tx.reads].some(([path, version]) => (this.versions.get(path) ?? 0) !== version) ||
          [...tx.queries].some(([path, epoch]) => (this.epochs.get(path) ?? 0) !== epoch)) continue;
      // Validate all preconditions BEFORE writing any reservation or table.
      for (const [kind, ref] of tx.writes) {
        if (kind === "create" && this.records.has(ref.path)) throw new Error("already exists");
        if (kind === "update" && !this.records.has(ref.path)) throw new Error("missing update");
      }
      for (const [kind, ref, data] of tx.writes) {
        if (kind === "delete") {
          this.records.delete(ref.path);
          this.versions.set(ref.path, (this.versions.get(ref.path) ?? 0) + 1);
          this.epochs.set(ref.parent.path, (this.epochs.get(ref.parent.path) ?? 0) + 1);
        } else this.seed(ref.path, kind === "update" ? { ...this.records.get(ref.path), ...data } : data);
      }
      return result;
    }
    throw new Error("transaction retry exhaustion");
  }
}
class Collection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Doc(this.db, `${this.path}/${id}`); }
  get parent() { return new Doc(this.db, this.path.substring(0, this.path.lastIndexOf("/"))); }
}
class Doc {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  get parent() { return new Collection(this.db, this.path.substring(0, this.path.lastIndexOf("/"))); }
}
class TestTransaction {
  reads = new Map(); queries = new Map(); writes = [];
  constructor(db) { this.db = db; }
  async get(ref) {
    assert.equal(this.writes.length, 0, "Firestore reads must precede all writes");
    if (ref instanceof Collection) {
      this.queries.set(ref.path, this.db.epochs.get(ref.path) ?? 0);
      return { docs: [...this.db.records].filter(([path]) => path.substring(0, path.lastIndexOf("/")) === ref.path).map(([path, data]) => {
        const id = path.split("/").at(-1);
        return { id, exists: true, data: () => structuredClone(data) };
      }) };
    }
    this.reads.set(ref.path, this.db.versions.get(ref.path) ?? 0);
    const data = this.db.records.get(ref.path);
    return { id: ref.id, exists: data !== undefined, data: () => data === undefined ? undefined : structuredClone(data) };
  }
  set(ref, data) { this.writes.push(["set", ref, data]); }
  create(ref, data) { this.writes.push(["create", ref, data]); }
  update(ref, data) { this.writes.push(["update", ref, data]); }
  delete(ref) { this.writes.push(["delete", ref]); }
}
const tablePath = (tenant, id) => `restaurants/${tenant}/tables/${id}`;
const reservationPath = (tenant, name) => `restaurants/${tenant}/tableNameReservations/${tableNameReservationId(name)}`;
const input = (name) => ({ name, area: "Main", capacity: 4, status: "AVAILABLE", currentOrderId: "", qrCode: "" });
const duplicate = (error) => error.status === 409 && error.details.code === "duplicate_table_number" && error.message === "رقم الطاولة مستخدم بالفعل، اختر رقمًا آخر";

describe("restaurant-scoped atomic table identity", () => {
  it("creates table 5 and rejects the same number in the same restaurant", async () => {
    const db = new TestFirestore();
    const { id } = await createTable(db, "A", input("5"), "now");
    assert.equal(db.records.get(reservationPath("A", "5")).tableId, id);
    await assert.rejects(createTable(db, "A", input("٥"), "now"), duplicate);
    assert.equal([...db.records.keys()].filter((path) => path.includes("/tables/")).length, 1);
  });
  it("allows the same number in different restaurants", async () => {
    const db = new TestFirestore();
    const a = await createTable(db, "A", input("5"), "now");
    const b = await createTable(db, "B", input("5"), "now");
    assert.notEqual(a.id, b.id);
    assert.equal(db.records.get(reservationPath("B", "5")).tableId, b.id);
  });
  it("updates unchanged number and rejects rename to an occupied number", async () => {
    const db = new TestFirestore();
    const a = await createTable(db, "A", input("5"), "now");
    await createTable(db, "A", input("6"), "now");
    await updateTable(db, "A", a.id, { name: "05", capacity: 8 }, "later");
    assert.equal(db.records.get(tablePath("A", a.id)).capacity, 8);
    await assert.rejects(updateTable(db, "A", a.id, { name: "6" }, "later"), duplicate);
    assert.equal(db.records.get(tablePath("A", a.id)).name, "05");
    assert.equal(db.records.get(reservationPath("A", "5")).tableId, a.id);
  });
  it("rename releases old and acquires new reservation without changing stable IDs or orders", async () => {
    const db = new TestFirestore();
    const { id } = await createTable(db, "A", input("5"), "now");
    db.seed("restaurants/A/orders/order-1", { tableId: id });
    await updateTable(db, "A", id, { name: "7" }, "later");
    assert.equal(db.records.has(reservationPath("A", "5")), false);
    assert.equal(db.records.get(reservationPath("A", "7")).tableId, id);
    assert.equal(db.records.get("restaurants/A/orders/order-1").tableId, id);
    await createTable(db, "A", input("5"), "later");
  });
  it("delete releases number and permits recreation", async () => {
    const db = new TestFirestore();
    const { id } = await createTable(db, "A", input("5"), "now");
    await deleteTable(db, "A", id);
    assert.equal(db.records.has(reservationPath("A", "5")), false);
    const next = await createTable(db, "A", input("5"), "later");
    assert.notEqual(next.id, id);
  });
  it("concurrent creates claim one number exactly once", async () => {
    const db = new TestFirestore();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createTable(db, "A", input("5"), "now")));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    for (const result of results.filter((result) => result.status === "rejected")) assert.ok(duplicate(result.reason));
  });
  it("concurrent renames to the same number have exactly one winner", async () => {
    const db = new TestFirestore();
    const a = await createTable(db, "A", input("1"), "now");
    const b = await createTable(db, "A", input("2"), "now");
    const results = await Promise.allSettled([updateTable(db, "A", a.id, { name: "5" }, "later"), updateTable(db, "A", b.id, { name: "5" }, "later")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(duplicate(results.find((result) => result.status === "rejected").reason));
  });
  it("legacy data without reservations is protected, and audit is non-destructive", async () => {
    const db = new TestFirestore();
    db.seed(tablePath("A", "legacy-1"), input("٥"));
    db.seed(tablePath("A", "legacy-2"), input("05"));
    const before = structuredClone([...db.records]);
    const report = findTableNameDuplicates([...db.records].map(([path, data]) => ({ ...data, id: path.split("/").at(-1) })));
    assert.equal(report[0].normalizedName, "5");
    assert.equal(report[0].tables.length, 2);
    assert.deepEqual([...db.records], before);
    await assert.rejects(createTable(db, "A", input("5"), "now"), duplicate);
    // Existing metadata is allowed; explicit rename resolves the legacy duplicate.
    await updateTable(db, "A", "legacy-1", { capacity: 9 }, "later");
    await updateTable(db, "A", "legacy-2", { name: "6" }, "later");
    await updateTable(db, "A", "legacy-1", { name: "5" }, "later");
    assert.equal(db.records.get(reservationPath("A", "5")).tableId, "legacy-1");
  });
  it("soft-deleted records do not block reuse; deletion preparation works in sync write order", async () => {
    const db = new TestFirestore();
    const { id } = await createTable(db, "A", input("5"), "now");
    await db.runTransaction(async (tx) => {
      const restaurant = db.collection("restaurants").doc("A");
      const ref = restaurant.collection("tables").doc(id);
      const current = (await tx.get(ref)).data();
      const release = await prepareTableNameReservation(tx, restaurant, id, current);
      await tx.get(restaurant.collection("metadata").doc("cursor"));
      tx.set(restaurant.collection("metadata").doc("cursor"), { value: 1 });
      release(tx);
      tx.update(ref, { deletedAt: "deleted" });
    });
    await createTable(db, "A", input("5"), "later");
  });
  it("a transaction failure leaves no orphan reservation", async () => {
    const db = new TestFirestore();
    await assert.rejects(db.runTransaction(async (tx) => {
      const restaurant = db.collection("restaurants").doc("A");
      const reserve = await prepareTableNameReservation(tx, restaurant, "broken", null, "5");
      reserve(tx);
      throw new Error("write failed");
    }));
    assert.equal(db.records.size, 0);
  });
  it("delete never releases another table's reservation", async () => {
    const db = new TestFirestore();
    db.seed(tablePath("A", "one"), input("5"));
    db.seed(tablePath("A", "two"), input("5"));
    db.seed(reservationPath("A", "5"), { normalizedName: "5", tableId: "two" });
    await deleteTable(db, "A", "one");
    assert.equal(db.records.get(reservationPath("A", "5")).tableId, "two");
  });
  it("disabled live tables reserve their number, and named identities remain distinct", async () => {
    const db = new TestFirestore();
    await createTable(db, "A", { ...input("5"), status: "DISABLED" }, "now");
    await assert.rejects(createTable(db, "A", input("5"), "now"), duplicate);
    for (const name of ["A05", "A5", "Table 5", "table 5", "5/roof", "طاولة ٥", "طاولة 5", "A۵", "A5/roof", "A٥/roof"]) await createTable(db, "A", input(name), "now");
  });
  it("normalization preserves legitimate names", () => {
    assert.equal(normalizeTableName("  ۰۰۵  "), "5");
    assert.equal(normalizeTableName("A05"), "A05");
    assert.notEqual(normalizeTableName("A05"), normalizeTableName("A5"));
    assert.notEqual(normalizeTableName("Table 5"), normalizeTableName("table 5"));
    assert.equal(normalizeTableName(" طاولة ٥ "), "طاولة ٥");
    assert.notEqual(normalizeTableName("طاولة ٥"), normalizeTableName("طاولة 5"));
  });
});

it("duplicate conflicts retain HTTP 409 and a structured field/code response", async () => {
  const db = new TestFirestore();
  await createTable(db, "A", input("5"), "now");
  let caught;
  try { await createTable(db, "A", input("5"), "now"); } catch (error) { caught = error; }
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  errorHandler(caught, {}, response, () => {});
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error.message, "رقم الطاولة مستخدم بالفعل، اختر رقمًا آخر");
  assert.deepEqual(response.body.error.details, { code: "duplicate_table_number", field: "name" });
});
