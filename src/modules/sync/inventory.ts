import { db } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import { inventoryAdjustmentSchema } from "../restaurant-ops/validators.js";
import { runLoggedTransaction } from "./logged-transaction.js";
import { operationRef, payloadHash, duplicateResult } from "./idempotency.js";
import { assertSameOperationRecord } from "./operation-record.js";
import { recordChanges } from "./change-log.js";
import type { AuthUser } from "../../types.js";
import type { SyncPushOperation, SyncPushResult } from "./types.js";

export async function applyInventoryMovement(restaurantId: string, user: AuthUser, deviceId: string, operation: SyncPushOperation): Promise<SyncPushResult> {
  if (operation.action !== "adjustInventory") throw new HttpError(400, "Unsupported inventory action");
  const input = inventoryAdjustmentSchema.parse(operation.payload);
  const parent = db.collection("restaurants").doc(restaurantId);
  const itemRef = parent.collection("inventoryItems").doc(input.inventoryItemId);
  const movementRef = parent.collection("inventoryTransactions").doc(operation.entityId);
  const receipt = operationRef(restaurantId, operation.operationId);
  return runLoggedTransaction(db, async tx => {
    const prior = await tx.get(receipt);
    if (prior.exists) {
      assertSameOperationRecord(operation, prior.data()!, { restaurantId, userId: user.id ?? user.email, deviceId });
      return duplicateResult(operation, prior.data()!);
    }
    const [snapshot, movement] = await Promise.all([tx.get(itemRef), tx.get(movementRef)]);
    if (!snapshot.exists) throw new HttpError(404, "Inventory item not found");
    if (movement.exists) throw new HttpError(409, "Inventory movement already exists", { code: "operation_reuse" });
    const item = snapshot.data()!;
    const delta = input.type === "IN" ? Math.abs(input.quantity) : input.type === "OUT" ? -Math.abs(input.quantity) : input.quantity;
    const now = new Date().toISOString(), version = Math.max(Date.now(), Number(item.version ?? 0) + 1);
    const updated = { ...item, currentQuantity: Number(item.currentQuantity ?? 0) + delta, version, updatedAt: now };
    const data = { ...input, quantity: Math.abs(input.quantity), id: operation.entityId, restaurantId, balanceAfter: updated.currentQuantity, createdById: user.id ?? user.email, createdAt: now, version };
    const cursors = await recordChanges(tx, restaurantId, [
      { entityType: "inventoryItem", entityId: input.inventoryItemId, action: "upsert", version, data: updated },
      { entityType: "inventoryTransaction", entityId: operation.entityId, action: "upsert", version, data }
    ]);
    tx.update(itemRef, updated); tx.create(movementRef, data);
    const result: SyncPushResult = { operationId: operation.operationId, entityType: operation.entityType, entityId: operation.entityId, status: "applied", serverVersion: version, serverCursor: cursors.at(-1), response: data };
    tx.set(receipt, { ...result, restaurantId, deviceId, userId: user.id ?? user.email, action: operation.action, payloadHash: payloadHash(operation), createdAt: now });
    return result;
  });
}
