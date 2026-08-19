import { createHash } from "node:crypto";
import { db } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import type { SyncPushOperation, SyncPushResult } from "./types.js";

export function operationRef(restaurantId: string, operationId: string) {
  return db.collection("restaurants").doc(restaurantId).collection("syncOperations").doc(operationId);
}

export function payloadHash(operation: SyncPushOperation) {
  return createHash("sha256").update(stableStringify({
    entityType: operation.entityType,
    entityId: operation.entityId,
    action: operation.action,
    payload: operation.payload
  })).digest("hex");
}

export function duplicateResult(operation: SyncPushOperation, record: FirebaseFirestore.DocumentData): SyncPushResult {
  return {
    operationId: operation.operationId,
    status: "duplicate",
    entityType: operation.entityType,
    entityId: operation.entityId,
    serverVersion: Number(record.serverVersion ?? 0),
    serverCursor: Number(record.serverCursor ?? 0),
    response: record.response ?? {}
  };
}

export function assertSamePayload(operation: SyncPushOperation, existingHash: unknown) {
  if (existingHash && existingHash !== payloadHash(operation)) {
    throw new HttpError(409, "Operation id was already used with a different payload", {
      code: "operation_reuse"
    });
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) => first.localeCompare(second));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
