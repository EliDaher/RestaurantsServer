import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "../../utils/http.js";
import { duplicateTableNameMessage, normalizeTableName } from "./table-name.js";
export const tableNameReservationCollection = "tableNameReservations";
export function tableNameReservationId(name) {
    return createHash("sha256").update(normalizeTableName(name), "utf8").digest("hex");
}
// Read/prepare first, write later: sync's change log also reads inside the transaction.
export async function prepareTableNameReservation(transaction, restaurantRef, tableId, current, nextName) {
    const reservations = restaurantRef.collection(tableNameReservationCollection);
    const oldKey = current?.name ? normalizeTableName(current.name) : undefined;
    const nextKey = nextName === undefined ? undefined : normalizeTableName(nextName);
    if (nextKey === "")
        throw new HttpError(400, "اسم/رقم الطاولة مطلوب", { code: "invalid_table_name" });
    const oldRef = oldKey === undefined ? null : reservations.doc(tableNameReservationId(oldKey));
    const nextRef = nextKey === undefined ? null : reservations.doc(tableNameReservationId(nextKey));
    const oldSnapshot = oldRef ? await transaction.get(oldRef) : null;
    const nextSnapshot = nextRef
        ? oldRef?.path === nextRef.path ? oldSnapshot : await transaction.get(nextRef)
        : null;
    let claimNext = Boolean(nextRef);
    if (nextRef && nextKey !== undefined) {
        // Legacy records do not have reservations. Scan them in the SAME transaction;
        // the shared reservation document arbitrates all concurrent writers.
        const tables = await transaction.get(restaurantRef.collection("tables"));
        const duplicate = tables.docs.some((snapshot) => {
            const table = snapshot.data();
            return snapshot.id !== tableId && !table.deletedAt && normalizeTableName(String(table.name ?? "")) === nextKey;
        });
        const unchangedLegacyDuplicate = duplicate && Boolean(current && !current.deletedAt && oldKey === nextKey);
        const reservedByOther = nextSnapshot?.exists && nextSnapshot.data()?.tableId !== tableId;
        if (!unchangedLegacyDuplicate && (duplicate || reservedByOther)) {
            throw new HttpError(409, duplicateTableNameMessage, { code: "duplicate_table_number", field: "name" });
        }
        // Existing duplicates can still receive unchanged-number metadata updates;
        // they are resolved explicitly by renaming a chosen stable table ID.
        claimNext = !unchangedLegacyDuplicate;
    }
    return (writeTransaction) => {
        if (oldRef && oldKey !== nextKey && oldSnapshot?.data()?.tableId === tableId)
            writeTransaction.delete(oldRef);
        if (nextRef && claimNext)
            writeTransaction.set(nextRef, { normalizedName: nextKey, tableId });
    };
}
export async function createTableWithUniqueName(firestore, restaurantId, input, timestamp) {
    const restaurantRef = firestore.collection("restaurants").doc(restaurantId);
    const ref = restaurantRef.collection("tables").doc(randomUUID());
    await firestore.runTransaction(async (transaction) => {
        const writeReservation = await prepareTableNameReservation(transaction, restaurantRef, ref.id, null, String(input.name ?? ""));
        writeReservation(transaction);
        transaction.create(ref, { ...input, name: String(input.name).trim(), restaurantId, createdAt: timestamp, updatedAt: timestamp });
    });
    return { id: ref.id };
}
export async function updateTableWithUniqueName(firestore, restaurantId, tableId, input, timestamp) {
    const restaurantRef = firestore.collection("restaurants").doc(restaurantId);
    const ref = restaurantRef.collection("tables").doc(tableId);
    await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.data();
        if (!current || current.deletedAt)
            throw new HttpError(404, "Table not found");
        const nextName = input.name === undefined ? current.name : String(input.name).trim();
        const writeReservation = await prepareTableNameReservation(transaction, restaurantRef, tableId, current, nextName);
        writeReservation(transaction);
        transaction.update(ref, { ...input, ...(input.name === undefined ? {} : { name: nextName }), restaurantId, updatedAt: timestamp });
    });
}
export async function deleteTableWithUniqueName(firestore, restaurantId, tableId) {
    const restaurantRef = firestore.collection("restaurants").doc(restaurantId);
    const ref = restaurantRef.collection("tables").doc(tableId);
    await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists)
            throw new HttpError(404, "Table not found");
        const writeReservation = await prepareTableNameReservation(transaction, restaurantRef, tableId, snapshot.data());
        writeReservation(transaction);
        transaction.delete(ref);
    });
}
