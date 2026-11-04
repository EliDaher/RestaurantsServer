import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import { db, store } from "./firestore-fixture.mjs";
const clone = value => structuredClone(value);
mock.module("../dist/config/firebase.js", { namedExports: { db, FieldValue: { serverTimestamp: () => "2026-11-01T12:00:00.000Z", increment: value => ({ increment: value }) } } });
const { pushOperations } = await import("../dist/modules/sync/service.js");
const { completeOrder, createInvoice, createExpense, deleteExpense } = await import("../dist/modules/restaurant-ops/service.js");
const path = (name, id) => `restaurants/r/${name}/${id}`;
const get = (name, id) => clone(store.get(path(name, id)));
const row = (originalAmount, currency = "SYP", method = "CASH", rate = 10000) => ({ originalAmount, currency, method, exchangeRate: rate, cashRegisterId: "cash" });
const owner = { id: "owner", email: "test@example.test", role: "OWNER", permissions: [] };
const operation = (id, entityType, entityId, payload, action = "create", baseVersion) => ({ operationId: id, entityType, entityId, payload, action, baseVersion, dependencyIds: [], clientCreatedAt: "2026-11-01T12:00:00.000Z" });
async function push(op) { return (await pushOperations("r", owner, "test-device", [op])).results[0]; }
beforeEach(() => {
  store.clear();
  store.set("restaurants/r", { currency: "SYP", usdExchangeRate: 10000 });
  store.set(path("cashRegisters", "cash"), { restaurantId: "r", name: "نقد", currentBalance: 0, openingBalance: 0, isOpen: true });
  store.set(path("orders", "o"), { restaurantId: "r", currency: "SYP", name: "طلب", tableId: "", type: "DINE_IN", source: "POS", status: "PENDING", items: [], subTotal: 1000, discount: 0, tax: 0, serviceCharge: 0, total: 1000, paidAmount: 0, paymentStatus: "UNPAID", paymentMethod: "CASH", notes: "", createdById: "owner", invoiceId: "", paymentId: "", inventoryDeductedAt: "", version: 1 });
});
describe("financial transaction integration with an isolated store", () => {
  it("syncs mixed partial checkout once, settles later at a new rate, and refunds every payment", async () => {
    const checkout = operation("checkout", "order", "o", { settlementMode: "PARTIAL", payments: [row(300), row(.02, "USD", "SHAM_CASH")], note: "" }, "completeOrder", 1);
    assert.equal((await push(checkout)).status, "applied");
    assert.equal((await push(checkout)).status, "duplicate");
    assert.equal(get("invoices", "order_o").remainingAmount, 500);
    assert.equal(get("cashRegisters", "cash").currentBalance, 500);
    store.set("restaurants/r", { currency: "SYP", usdExchangeRate: 20000 });
    const settlement = operation("settle", "payment", "p", { invoiceId: "order_o", settlementMode: "FULL", payments: [row(.02, "USD", "CASH", 20000), row(100)], note: "" });
    assert.equal((await push(settlement)).status, "applied");
    assert.equal((await push(settlement)).status, "duplicate");
    assert.equal(get("orders", "o").paidAmount, 1000);
    assert.equal(get("cashRegisters", "cash").currentBalance, 1000);
    assert.equal(get("payments", "order_o_1").exchangeRate, 10000);
    const cancel = operation("cancel", "order", "o", { reason: "test" }, "cancelOrder", get("orders", "o").version);
    assert.equal((await push(cancel)).status, "applied");
    assert.equal(get("cashRegisters", "cash").currentBalance, 0);
    assert.equal([...store.entries()].filter(([p, data]) => p.includes("/payments/") && data.type === "REFUND").length, 4);
  });
  it("direct checkout follows identical conversion rules", async () => {
    await completeOrder("r", "o", { paymentMethod: "CASH", settlementMode: "FULL", payments: [row(500), row(.05, "USD", "SHAM_CASH")], note: "" }, "owner");
    assert.equal(get("cashRegisters", "cash").currentBalance, 1000);
    assert.equal(get("payments", "order_o_1").originalAmount, .05);
  });
  it("rejects invalid totals and a missing saved rate without any writes", async () => {
    const before = clone([...store]);
    const invalid = operation("invalid", "order", "o", { settlementMode: "FULL", payments: [row(1001)], note: "" }, "completeOrder", 1);
    assert.equal((await push(invalid)).status, "rejected"); assert.deepEqual([...store], before);
    store.set("restaurants/r", { currency: "SYP" });
    const result = await push(operation("no-rate", "order", "o", { settlementMode: "FULL", payments: [row(.1, "USD")], note: "" }, "completeOrder", 1));
    assert.equal(result.status, "rejected"); assert.equal(get("cashRegisters", "cash").currentBalance, 0);
  });
  it("records supplier debt, then pays it using mixed currencies", async () => {
    store.set(path("suppliers", "s"), { restaurantId: "r", balance: 0 });
    const invoice = await createInvoice("r", { type: "PURCHASE", status: "UNPAID", orderId: "", supplierId: "s", items: [{ itemId: "", name: "مشتريات", quantity: 1, unitPrice: 1000 }], discount: 0, tax: 0, serviceCharge: 0, paidAmount: 0, paymentMethod: "CASH", dueDate: "", notes: "", settlementMode: "DEBT", payments: [] }, "owner");
    assert.equal(get("suppliers", "s").balance, 1000);
    const result = await push(operation("supplier-pay", "payment", "sp", { invoiceId: invoice.id, settlementMode: "FULL", payments: [row(500), row(.05, "USD", "SHAM_CASH")], note: "" }));
    assert.equal(result.status, "applied"); assert.equal(get("suppliers", "s").balance, 0); assert.equal(get("cashRegisters", "cash").currentBalance, -1000);
  });
  it("records partial expenses, settles the payable and restores cash on deletion", async () => {
    const op = operation("expense-create", "expense", "e", { category: "مصروف", amount: 1000, paymentMethod: "CASH", currency: "SYP", exchangeRate: 1, payments: [row(.05, "USD", "SHAM_CASH")], settlementMode: "PARTIAL", notes: "" });
    assert.equal((await push(op)).status, "applied"); assert.equal(get("expenses", "e").remainingAmount, 500);
    assert.equal(get("cashRegisters", "cash").currentBalance, -500);
    assert.equal((await push(operation("expense-pay", "payment", "ep", { expenseId: "e", settlementMode: "FULL", payments: [row(500)], note: "" }))).status, "applied");
    assert.equal(get("expenses", "e").remainingAmount, 0); assert.equal(get("cashRegisters", "cash").currentBalance, -1000);
    await deleteExpense("r", "e"); assert.equal(get("cashRegisters", "cash").currentBalance, 0);
  });
  for (const [mode, amount, rawName, expectedName] of [
    ["FULL", 1000, "  أحمد العلي  ", "أحمد العلي"],
    ["PARTIAL", 500, "ليلى", "ليلى"],
    ["DEBT", 0, "زبون الدين", "زبون الدين"],
    ["FULL", 1000, "   ", undefined],
    ["DEBT", 0, undefined, undefined]
  ]) {
    it(`persists an optional customer name independently for ${mode} (${JSON.stringify(rawName)})`, async () => {
      const payload = { settlementMode: mode, payments: amount ? [row(amount)] : [], note: "", ...(rawName !== undefined ? { customerName: rawName } : {}) };
      const op = operation("named-checkout", "order", "o", payload, "completeOrder", 1);
      assert.equal((await push(op)).status, "applied");
      assert.equal((await push(op)).status, "duplicate");
      assert.equal(get("orders", "o").customerName, expectedName);
      assert.equal(get("invoices", "order_o").customerName, expectedName);
      assert.equal(get("orders", "o").name, "طلب");
      if (expectedName === undefined) assert.equal(Object.hasOwn(get("invoices", "order_o"), "customerName"), false);
    });
  }
  it("trims and preserves customer names through the direct checkout endpoint", async () => {
    await completeOrder("r", "o", { customerName: "  عمر  ", paymentMethod: "CASH", settlementMode: "FULL", payments: [row(1000)], note: "" }, "owner");
    assert.equal(get("orders", "o").customerName, "عمر");
    assert.equal(get("invoices", "order_o").customerName, "عمر");
    assert.equal(get("orders", "o").name, "طلب");
  });

});
