import { db } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import { operationPayloadHash } from "./operation-fingerprint.js";
export function operationRef(restaurantId, operationId) {
    return db.collection("restaurants").doc(restaurantId).collection("syncOperations").doc(operationId);
}
export function payloadHash(operation) {
    return operationPayloadHash(operation);
}
export function duplicateResult(operation, record) {
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
export function assertSamePayload(operation, existingHash) {
    if (existingHash && existingHash !== payloadHash(operation)) {
        throw new HttpError(409, "Operation id was already used with a different payload", {
            code: "operation_reuse"
        });
    }
}
