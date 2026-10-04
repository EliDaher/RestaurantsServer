import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { operationPayloadHash } from "../dist/modules/sync/operation-fingerprint.js";
import { operationRecordReuseViolation } from "../dist/modules/sync/operation-record-rules.js";

const baseOperation = {
  operationId: "op_1",
  entityType: "order",
  entityId: "order_1",
  action: "completeOrder",
  payload: {
    paymentMethod: "CASH",
    paidAmount: 25,
    note: "paid"
  },
  dependencyIds: [],
  clientCreatedAt: "2026-09-22T00:00:00.000Z"
};

const expenseOperation = {
  operationId: "expense_op_1",
  entityType: "expense",
  entityId: "expense_1",
  action: "create",
  payload: {
    category: "TEST",
    amount: 12.5,
    paymentMethod: "CASH",
    paidAt: "2026-10-04T12:00:00.000Z",
    notes: "offline test"
  },
  dependencyIds: [],
  clientCreatedAt: "2026-10-04T12:00:00.000Z"
};

const cashMovementOperation = {
  operationId: "cash_movement_op_1",
  entityType: "cashMovement",
  entityId: "cash_movement_1",
  action: "create",
  payload: {
    cashRegisterId: "register_1",
    type: "IN",
    amount: 50,
    referenceType: "MANUAL",
    referenceId: "manual",
    note: "offline deposit"
  },
  dependencyIds: [],
  clientCreatedAt: "2026-10-04T12:10:00.000Z"
};

const context = {
  restaurantId: "restaurant_a",
  deviceId: "device_a",
  userId: "user_a"
};

function matchingRecord(operation = baseOperation) {
  return {
    operationId: operation.operationId,
    payloadHash: operationPayloadHash(operation),
    restaurantId: context.restaurantId,
    deviceId: context.deviceId,
    userId: context.userId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    action: operation.action
  };
}

describe("sync operation idempotency contract", () => {
  it("uses a stable payload fingerprint regardless of object key order", () => {
    const first = {
      ...baseOperation,
      payload: { paymentMethod: "CASH", paidAmount: 25, note: "paid" }
    };
    const second = {
      ...baseOperation,
      payload: { note: "paid", paidAmount: 25, paymentMethod: "CASH" }
    };

    assert.equal(operationPayloadHash(first), operationPayloadHash(second));
  });

  it("changes the fingerprint when the mutation payload changes", () => {
    const changed = {
      ...baseOperation,
      payload: { ...baseOperation.payload, paidAmount: 30 }
    };

    assert.notEqual(operationPayloadHash(baseOperation), operationPayloadHash(changed));
  });

  it("accepts retrying the same operation from the same restaurant and device", () => {
    assert.equal(operationRecordReuseViolation(baseOperation, matchingRecord(), context), "");
  });

  it("rejects reusing the same operation id with a different payload", () => {
    const changed = {
      ...baseOperation,
      payload: { ...baseOperation.payload, note: "different" }
    };

    assert.equal(operationRecordReuseViolation(changed, matchingRecord(), context), "payload");
  });

  it("rejects reusing the same operation id from another restaurant", () => {
    assert.equal(operationRecordReuseViolation(baseOperation, matchingRecord(), {
      ...context,
      restaurantId: "restaurant_b"
    }), "restaurant");
  });

  it("rejects reusing the same operation id from another device", () => {
    assert.equal(operationRecordReuseViolation(baseOperation, matchingRecord(), {
      ...context,
      deviceId: "device_b"
    }), "device");
  });

  it("rejects reusing the same operation id for another order", () => {
    const changed = {
      ...baseOperation,
      entityId: "order_2"
    };
    assert.equal(operationRecordReuseViolation(changed, {
      ...matchingRecord(),
      payloadHash: operationPayloadHash(changed)
    }, context), "entity");
  });

  it("rejects reusing the same operation id for another mutation action", () => {
    const changed = {
      ...baseOperation,
      action: "cancelOrder",
      payload: { reason: "changed" }
    };
    assert.equal(operationRecordReuseViolation(changed, {
      ...matchingRecord(),
      payloadHash: operationPayloadHash(changed)
    }, context), "action");
  });

  it("accepts legacy records that only stored the original payload hash", () => {
    assert.equal(operationRecordReuseViolation(baseOperation, {
      payloadHash: operationPayloadHash(baseOperation)
    }, context), "");
  });

  it("uses the same idempotency contract for expense creation", () => {
    const record = {
      operationId: expenseOperation.operationId,
      payloadHash: operationPayloadHash(expenseOperation),
      restaurantId: context.restaurantId,
      deviceId: context.deviceId,
      userId: context.userId,
      entityType: "expense",
      entityId: "expense_1",
      action: "create"
    };

    assert.equal(operationRecordReuseViolation(expenseOperation, record, context), "");
    assert.equal(operationRecordReuseViolation({
      ...expenseOperation,
      payload: { ...expenseOperation.payload, amount: 99 }
    }, record, context), "payload");
    assert.equal(operationRecordReuseViolation(expenseOperation, record, {
      ...context,
      restaurantId: "restaurant_b"
    }), "restaurant");
    assert.equal(operationRecordReuseViolation(expenseOperation, record, {
      ...context,
      userId: "user_b"
    }), "user");
  });

  it("uses the same idempotency contract for manual cash movement creation", () => {
    const record = {
      operationId: cashMovementOperation.operationId,
      payloadHash: operationPayloadHash(cashMovementOperation),
      restaurantId: context.restaurantId,
      deviceId: context.deviceId,
      userId: context.userId,
      entityType: "cashMovement",
      entityId: "cash_movement_1",
      action: "create"
    };

    assert.equal(operationRecordReuseViolation(cashMovementOperation, record, context), "");
    assert.equal(operationRecordReuseViolation({
      ...cashMovementOperation,
      payload: { ...cashMovementOperation.payload, amount: 75 }
    }, record, context), "payload");
    assert.equal(operationRecordReuseViolation(cashMovementOperation, record, {
      ...context,
      restaurantId: "restaurant_b"
    }), "restaurant");
    assert.equal(operationRecordReuseViolation(cashMovementOperation, record, {
      ...context,
      userId: "user_b"
    }), "user");
  });
});
