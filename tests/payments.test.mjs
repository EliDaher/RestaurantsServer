import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePayment, normalizeSettlement, normalizeMoney } from "../dist/utils/payments.js";
const row = (originalAmount, currency = "SYP", method = "CASH", exchangeRate = 10000) => ({ originalAmount, currency, method, exchangeRate, cashRegisterId: "" });
describe("multi-currency settlement", () => {
  it("settles one invoice with mixed currencies and methods", () => {
    const result = normalizeSettlement(1000, "FULL", [row(500), row(.05, "USD", "SHAM_CASH")]);
    assert.equal(result.paidAmount, 1000); assert.equal(result.remainingAmount, 0);
    assert.deepEqual(result.payments.map(p => p.exchangeRate), [1, 10000]);
  });
  it("keeps historical snapshots stable after a new exchange rate", () => {
    const old = normalizePayment(row(.05, "USD"));
    const updated = normalizePayment(row(.05, "USD", "CASH", 20000));
    assert.equal(old.amount, 500); assert.equal(updated.amount, 1000);
  });
  it("supports debt and partial while rejecting inconsistent states", () => {
    assert.equal(normalizeSettlement(1000, "DEBT", []).paidAmount, 0);
    assert.equal(normalizeSettlement(1000, "PARTIAL", [row(200)]).remainingAmount, 800);
    for (const [mode, rows] of [["FULL", [row(999)]], ["PARTIAL", []], ["PARTIAL", [row(1000)]], ["DEBT", [row(1)]], ["FULL", [row(1001)]]]) assert.throws(() => normalizeSettlement(1000, mode, rows));
  });
  it("validates precision, supported values, finite amounts and rates", () => {
    for (const payment of [row(-1), row(0), row(NaN), row(Infinity), row(.001, "USD"), row(.1), row(1, "EUR"), row(1, "USD", "CASH", 0), row(1, "USD", "CASH", Infinity), row(1, "SYP", "WALLET")]) assert.throws(() => normalizePayment(payment));
    assert.equal(normalizePayment(row(.01, "USD", "CASH", 12345)).amount, 123);
  });
  it("does not reinterpret legacy money and does not convert twice during synchronization", () => {
    const legacy = { amount: 12.5, method: "WALLET" };
    assert.deepEqual(normalizeMoney(legacy), legacy);
    const once = normalizeMoney({ amount: .05, currency: "USD", exchangeRate: 10000 });
    assert.deepEqual(normalizeMoney(once), once);
    assert.equal(once.originalAmount, .05); assert.equal(once.amount, 500);
  });
});
