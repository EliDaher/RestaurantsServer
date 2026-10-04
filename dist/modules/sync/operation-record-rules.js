import { operationPayloadHash } from "./operation-fingerprint.js";
export function operationRecordReuseViolation(operation, record, context, hash = operationPayloadHash(operation)) {
    if (record.payloadHash && record.payloadHash !== hash)
        return "payload";
    if (record.restaurantId !== undefined && record.restaurantId !== context.restaurantId)
        return "restaurant";
    if (record.deviceId !== undefined && record.deviceId !== context.deviceId)
        return "device";
    if (record.userId !== undefined && context.userId !== undefined && record.userId !== context.userId)
        return "user";
    if (record.entityType !== undefined && record.entityType !== operation.entityType)
        return "entity type";
    if (record.entityId !== undefined && record.entityId !== operation.entityId)
        return "entity";
    if (record.action !== undefined && record.action !== operation.action)
        return "action";
    return "";
}
