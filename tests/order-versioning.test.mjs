import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentOrderVersion, nextOrderVersion, orderVersionConflict } from "../dist/modules/sync/order-versioning.js";

describe("order versioning rules", () => {
  it("uses an explicit server version when present", () => {
    assert.equal(currentOrderVersion({ version: 42, updatedAt: "2026-09-22T10:00:00.000Z" }), 42);
  });

  it("falls back to updatedAt for existing unversioned orders", () => {
    assert.equal(currentOrderVersion({ updatedAt: "2026-09-22T10:00:00.000Z" }), Date.parse("2026-09-22T10:00:00.000Z"));
  });

  it("falls back to Firestore timestamp millis for existing unversioned orders", () => {
    assert.equal(currentOrderVersion({ updatedAt: { toMillis: () => 1_795_168_800_000 } }), 1_795_168_800_000);
  });

  it("falls back to createdAt when updatedAt is unavailable", () => {
    assert.equal(currentOrderVersion({ createdAt: "2026-09-22T09:00:00.000Z" }), Date.parse("2026-09-22T09:00:00.000Z"));
  });

  it("uses zero for old orders without version timestamps", () => {
    assert.equal(currentOrderVersion({}), 0);
  });

  it("increments beyond the current version when the clock is behind", () => {
    assert.equal(nextOrderVersion(100, 50), 101);
  });

  it("uses the current clock when it is ahead of the stored version", () => {
    assert.equal(nextOrderVersion(100, 500), 500);
  });

  it("accepts a matching base version", () => {
    assert.equal(orderVersionConflict(100, 100), "");
  });

  it("rejects a missing base version", () => {
    assert.equal(orderVersionConflict(undefined, 100), "missing_base_version");
  });

  it("rejects a stale base version", () => {
    assert.equal(orderVersionConflict(99, 100), "version_conflict");
  });
});
