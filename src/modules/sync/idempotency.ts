import { db } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import { operationPayloadHash } from "./operation-fingerprint.js";
import type { SyncPushOperation, SyncPushResult } from "./types.js";

export function operationRef(restaurantId: string, operationId: string) {
  return db.collection("restaurants").doc(restaurantId).collection("syncOperations").doc(operationId);
}

export function payloadHash(operation: SyncPushOperation) {
  return operationPayloadHash(operation);
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
