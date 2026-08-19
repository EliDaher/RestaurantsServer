import { db, FieldValue } from "../../config/firebase.js";
import { hasPermission } from "../../services/permissions.js";
import { getRestaurantById } from "../../services/restaurants.js";
import { HttpError } from "../../utils/http.js";
import { cancelOrder, completeOrder, createOrder, getCashMovement, getInvoice, getJournalEntry, getOrder, getPayment, getTable, updateOrder } from "../restaurant-ops/service.js";
import { cancelOrderSchema, completeOrderSchema, orderCreateSchema, orderPatchSchema } from "../restaurant-ops/validators.js";
import { ZodError } from "zod";
import { listChanges, recordChange, recordChanges } from "./change-log.js";
import { assertSamePayload, duplicateResult, operationRef, payloadHash } from "./idempotency.js";
import { tableSyncPayloadSchema } from "./validators.js";
export function pullChanges(restaurantId, cursor) {
    return listChanges(restaurantId, cursor);
}
export async function pushOperations(restaurantId, user, deviceId, operations) {
    const results = [];
    for (const operation of operations) {
        try {
            results.push(await applyOperation(restaurantId, user, deviceId, operation));
        }
        catch (error) {
            results.push(errorResult(operation, error));
        }
    }
    return { results };
}
async function applyOperation(restaurantId, user, deviceId, operation) {
    if (operation.entityType === "table") {
        assertPermissionForSync(user, "tables.manage");
        return applyTableOperation(restaurantId, user, deviceId, operation);
    }
    if (operation.entityType === "order") {
        return applyOrderOperation(restaurantId, user, deviceId, operation);
    }
    return {
        operationId: operation.operationId,
        status: "rejected",
        entityType: operation.entityType,
        entityId: operation.entityId,
        error: {
            code: "unsupported_entity",
            message: `Offline sync is not enabled for ${operation.entityType} yet`,
            retryable: false
        }
    };
}
async function applyOrderOperation(restaurantId, user, deviceId, operation) {
    assertOrderPermission(user, operation.action);
    const existing = await operationRef(restaurantId, operation.operationId).get();
    if (existing.exists) {
        assertSamePayload(operation, existing.data()?.payloadHash);
        return duplicateResult(operation, existing.data() ?? {});
    }
    const userId = user.id ?? user.email;
    let response = {};
    if (operation.action === "create") {
        const restaurant = await getRestaurantById(restaurantId);
        const input = orderCreateSchema.parse(operation.payload);
        response = await createOrder(restaurantId, input, userId, restaurant, { orderId: operation.entityId });
    }
    else if (operation.action === "update") {
        const input = orderPatchSchema.parse(operation.payload);
        await updateOrder(restaurantId, operation.entityId, input);
        response = { id: operation.entityId, ok: true };
    }
    else if (operation.action === "completeOrder") {
        const input = completeOrderSchema.parse(operation.payload);
        response = await completeOrder(restaurantId, operation.entityId, input, userId);
    }
    else if (operation.action === "cancelOrder") {
        const input = cancelOrderSchema.parse(operation.payload);
        response = await cancelOrder(restaurantId, operation.entityId, userId, input.reason);
    }
    else {
        return {
            operationId: operation.operationId,
            status: "rejected",
            entityType: operation.entityType,
            entityId: operation.entityId,
            error: {
                code: "unsupported_action",
                message: `Unsupported order sync action: ${operation.action}`,
                retryable: false
            }
        };
    }
    const order = await getOrder(restaurantId, operation.entityId);
    const changes = [{
            entityType: "order",
            entityId: operation.entityId,
            data: { ...order }
        }];
    if (order.tableId) {
        await pushChangeIfExists(changes, "table", order.tableId, () => getTable(restaurantId, order.tableId));
    }
    if (operation.action === "completeOrder") {
        const invoiceId = String(response.invoiceId ?? `order_${operation.entityId}`);
        const paymentId = String(response.paymentId ?? "");
        await pushChangeIfExists(changes, "invoice", invoiceId, () => getInvoice(restaurantId, invoiceId));
        if (paymentId)
            await pushChangeIfExists(changes, "payment", paymentId, () => getPayment(restaurantId, paymentId));
        await pushChangeIfExists(changes, "cashMovement", `order_${operation.entityId}`, () => getCashMovement(restaurantId, `order_${operation.entityId}`));
        await pushChangeIfExists(changes, "journalEntry", `order_${operation.entityId}`, () => getJournalEntry(restaurantId, `order_${operation.entityId}`));
    }
    return persistServiceOperationResult(restaurantId, user, deviceId, operation, response, changes);
}
async function applyTableOperation(restaurantId, user, deviceId, operation) {
    const opRef = operationRef(restaurantId, operation.operationId);
    const tableRef = db.collection("restaurants").doc(restaurantId).collection("tables").doc(operation.entityId);
    const hash = payloadHash(operation);
    return db.runTransaction(async (transaction) => {
        const [operationSnapshot, tableSnapshot] = await Promise.all([
            transaction.get(opRef),
            transaction.get(tableRef)
        ]);
        if (operationSnapshot.exists) {
            const existing = operationSnapshot.data() ?? {};
            assertSamePayload(operation, existing.payloadHash);
            return duplicateResult(operation, existing);
        }
        const current = tableSnapshot.exists ? { id: tableSnapshot.id, ...tableSnapshot.data() } : null;
        if (operation.action === "delete") {
            if (!current) {
                return persistOperationResult(transaction, restaurantId, opRef, operation, hash, deviceId, user, {
                    operationId: operation.operationId,
                    status: "applied",
                    entityType: operation.entityType,
                    entityId: operation.entityId,
                    serverVersion: 0,
                    response: { ok: true }
                }, "delete");
            }
            if (current.currentOrderId) {
                return conflict(operation, "table_has_open_order", "Cannot delete a table with an open order");
            }
        }
        if ((operation.action === "update" || operation.action === "delete") && !current) {
            return conflict(operation, "missing_entity", "Table no longer exists on the server");
        }
        const serverVersion = Number(current?.version ?? 0);
        if (operation.baseVersion !== undefined && serverVersion > 0 && operation.baseVersion !== serverVersion) {
            return conflict(operation, "version_conflict", "Table changed on the server before this operation synced");
        }
        const nextVersion = Date.now();
        if (operation.action === "delete") {
            const result = await persistOperationResult(transaction, restaurantId, opRef, operation, hash, deviceId, user, {
                operationId: operation.operationId,
                status: "applied",
                entityType: operation.entityType,
                entityId: operation.entityId,
                serverVersion: nextVersion,
                response: { ok: true }
            }, "delete", nextVersion);
            transaction.set(tableRef, {
                restaurantId,
                deletedAt: new Date().toISOString(),
                version: nextVersion,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            return result;
        }
        const payload = tableSyncPayloadSchema.parse(operation.payload);
        const tableData = {
            ...payload,
            restaurantId,
            deletedAt: "",
            version: nextVersion,
            updatedAt: FieldValue.serverTimestamp(),
            ...(operation.action === "create" || !current ? { createdAt: FieldValue.serverTimestamp() } : {})
        };
        const result = await persistOperationResult(transaction, restaurantId, opRef, operation, hash, deviceId, user, {
            operationId: operation.operationId,
            status: "applied",
            entityType: operation.entityType,
            entityId: operation.entityId,
            serverVersion: nextVersion,
            response: { id: operation.entityId, ok: true }
        }, "upsert", nextVersion, {
            id: operation.entityId,
            ...payload,
            restaurantId,
            deletedAt: "",
            version: nextVersion,
            updatedAt: new Date().toISOString(),
            createdAt: current?.createdAt ?? new Date().toISOString()
        });
        transaction.set(tableRef, tableData, { merge: true });
        return result;
    });
}
async function persistOperationResult(transaction, restaurantId, opRef, operation, hash, deviceId, user, result, changeAction, version = result.serverVersion ?? 0, data) {
    const cursor = await recordChange(transaction, restaurantId, {
        entityType: operation.entityType,
        entityId: operation.entityId,
        action: changeAction,
        version,
        data
    });
    const resultWithCursor = { ...result, serverCursor: cursor };
    transaction.set(opRef, {
        operationId: operation.operationId,
        payloadHash: hash,
        entityType: operation.entityType,
        entityId: operation.entityId,
        status: "applied",
        response: resultWithCursor.response ?? {},
        serverVersion: version,
        serverCursor: cursor,
        deviceId,
        userId: user.id ?? user.email,
        createdAt: FieldValue.serverTimestamp()
    });
    return resultWithCursor;
}
async function persistServiceOperationResult(restaurantId, user, deviceId, operation, response, changes) {
    const opRef = operationRef(restaurantId, operation.operationId);
    const hash = payloadHash(operation);
    const version = Date.now();
    return db.runTransaction(async (transaction) => {
        const operationSnapshot = await transaction.get(opRef);
        if (operationSnapshot.exists) {
            const existing = operationSnapshot.data() ?? {};
            assertSamePayload(operation, existing.payloadHash);
            return duplicateResult(operation, existing);
        }
        const result = {
            operationId: operation.operationId,
            status: "applied",
            entityType: operation.entityType,
            entityId: operation.entityId,
            serverVersion: version,
            response
        };
        const cursors = await recordChanges(transaction, restaurantId, changes.map((change) => ({
            entityType: change.entityType,
            entityId: change.entityId,
            action: "upsert",
            version,
            data: change.data
        })));
        const serverCursor = cursors.at(-1) ?? 0;
        const resultWithCursor = { ...result, serverCursor };
        transaction.set(opRef, {
            operationId: operation.operationId,
            payloadHash: hash,
            entityType: operation.entityType,
            entityId: operation.entityId,
            status: "applied",
            response: resultWithCursor.response ?? {},
            serverVersion: version,
            serverCursor,
            deviceId,
            userId: user.id ?? user.email,
            createdAt: FieldValue.serverTimestamp()
        });
        return resultWithCursor;
    });
}
async function pushChangeIfExists(changes, entityType, entityId, load) {
    try {
        const data = await load();
        changes.push({ entityType, entityId, data: { ...data } });
    }
    catch {
        // Optional linked records, like zero-amount payments, should not fail the applied order operation.
    }
}
function assertOrderPermission(user, action) {
    if (action === "create") {
        assertPermissionForSync(user, "orders.create");
        return;
    }
    if (action === "completeOrder") {
        assertPermissionForSync(user, "payments.create");
        return;
    }
    if (action === "cancelOrder") {
        assertPermissionForSync(user, "orders.cancel");
        return;
    }
    assertPermissionForSync(user, "orders.update");
}
function conflict(operation, code, message) {
    return {
        operationId: operation.operationId,
        status: "conflict",
        entityType: operation.entityType,
        entityId: operation.entityId,
        error: {
            code,
            message,
            retryable: false
        }
    };
}
function errorResult(operation, error) {
    if (error instanceof ZodError) {
        return {
            operationId: operation.operationId,
            status: "rejected",
            entityType: operation.entityType,
            entityId: operation.entityId,
            error: {
                code: "validation_error",
                message: error.issues[0]?.message ?? "Invalid sync payload",
                retryable: false
            }
        };
    }
    if (error instanceof HttpError) {
        const code = errorCodeFor(operation, error);
        return {
            operationId: operation.operationId,
            status: error.status === 409 ? "conflict" : "rejected",
            entityType: operation.entityType,
            entityId: operation.entityId,
            error: {
                code,
                message: error.message,
                retryable: error.status >= 500
            }
        };
    }
    if (isFirestoreTransactionOrderError(error)) {
        return {
            operationId: operation.operationId,
            status: "rejected",
            entityType: operation.entityType,
            entityId: operation.entityId,
            error: {
                code: "sync_transaction_order_error",
                message: "Sync transaction tried to read after writing change log data",
                retryable: false
            }
        };
    }
    return {
        operationId: operation.operationId,
        status: "rejected",
        entityType: operation.entityType,
        entityId: operation.entityId,
        error: {
            code: "unknown_error",
            message: error instanceof Error ? error.message : "Unknown sync error",
            retryable: false
        }
    };
}
function isFirestoreTransactionOrderError(error) {
    return error instanceof Error && /Firestore transactions require all reads to be executed before all writes/i.test(error.message);
}
function assertPermissionForSync(user, permission) {
    if (!hasPermission(user.role, permission, user.permissions ?? [])) {
        throw new HttpError(403, `Missing permission: ${permission}`, { code: "permission_denied" });
    }
}
function errorCodeFor(operation, error) {
    const explicitCode = error.details?.code;
    if (explicitCode)
        return explicitCode;
    if (error.status === 403)
        return "permission_denied";
    if (operation.entityType === "order" && error.status === 404 && /Order not found/i.test(error.message))
        return "missing_order_dependency";
    if (operation.entityType === "order" && error.status === 404 && /Cash register not found/i.test(error.message))
        return "cash_register_missing";
    return `http_${error.status}`;
}
