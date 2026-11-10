import { entityCollections } from "./logged-transaction.js";
import { withId } from "../../utils/firestore.js";
import { measuredSnapshot } from "../../utils/read-metrics.js";
import { db, FieldValue } from "../../config/firebase.js";
export async function listChanges(restaurantId, cursor, throughCursor) {
    const parent = db.collection("restaurants").doc(restaurantId);
    const upper = throughCursor ?? Number(measuredSnapshot(await parent.collection("syncMeta").doc("main").get()).data()?.cursor ?? 0);
    const snapshot = await db
        .collection("restaurants")
        .doc(restaurantId)
        .collection("changeLog")
        .where("cursor", ">", cursor)
        .where("cursor", "<=", upper)
        .orderBy("cursor", "asc")
        .limit(500)
        .get();
    measuredSnapshot(snapshot);
    const changes = snapshot.docs.map((doc) => doc.data());
    const references = new Map();
    for (const change of changes) {
        const collection = entityCollections[change.entityType];
        if (!collection)
            throw new Error("Unknown journal entity");
        const ref = parent.collection(collection).doc(change.entityId);
        references.set(ref.path, ref);
    }
    const hydrated = new Map();
    const refs = [...references.values()];
    // BatchGet avoids hundreds of serial RPCs when catching up a full page.
    for (let offset = 0; offset < refs.length; offset += 100) {
        const documents = await db.getAll(...refs.slice(offset, offset + 100));
        for (const document of documents)
            hydrated.set(document.ref.path, measuredSnapshot(document));
    }
    for (const change of changes) {
        const document = hydrated.get(parent.collection(entityCollections[change.entityType]).doc(change.entityId).path);
        change.action = document.exists ? "upsert" : "delete";
        if (document.exists) {
            change.data = withId(document);
            change.version = Number(change.data.version) || Date.parse(String(change.data.updatedAt ?? change.data.createdAt ?? "")) || change.version;
        }
        else
            delete change.data;
    }
    return {
        cursor: changes.at(-1)?.cursor ?? cursor,
        changes,
        throughCursor: upper,
        hasMore: snapshot.docs.length === 500 && (changes.at(-1)?.cursor ?? cursor) < upper
    };
}
export async function recordChange(transaction, restaurantId, input) {
    const cursors = await recordChanges(transaction, restaurantId, [input]);
    return cursors[0] ?? 0;
}
export async function recordChanges(transaction, restaurantId, inputs) {
    if (!inputs.length)
        return [];
    const metaRef = db.collection("restaurants").doc(restaurantId).collection("syncMeta").doc("main");
    const metaSnapshot = await transaction.get(metaRef);
    const currentCursor = Number(metaSnapshot.data()?.cursor ?? 0);
    const changedAt = new Date().toISOString();
    const cursors = inputs.map((_, index) => currentCursor + index + 1);
    transaction.set(metaRef, {
        cursor: cursors.at(-1) ?? currentCursor,
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    inputs.forEach((input, index) => {
        const cursor = cursors[index];
        const changeRef = db.collection("restaurants").doc(restaurantId).collection("changeLog").doc(String(cursor).padStart(20, "0"));
        transaction.set(changeRef, {
            cursor,
            entityType: input.entityType,
            entityId: input.entityId,
            action: input.action,
            version: input.version,
            changedAt,
            ...(input.data ? { data: input.data } : {})
        });
    });
    return cursors;
}
