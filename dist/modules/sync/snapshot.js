import { db } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import { withId } from "../../utils/firestore.js";
import { measuredSnapshot } from "../../utils/read-metrics.js";
import { entityCollections } from "./logged-transaction.js";
export function incrementalEnabled(tenant) {
    const tenants = (process.env.INCREMENTAL_SYNC_TENANTS ?? "").split(",").map(s => s.trim());
    return tenants.includes("*") || tenants.includes(tenant);
}
export async function snapshotPage(tenant, entity, after) {
    if (!Object.hasOwn(entityCollections, entity))
        throw new HttpError(400, "Invalid snapshot entity");
    if (!incrementalEnabled(tenant))
        throw new HttpError(409, "Incremental sync is not enabled");
    const parent = db.collection("restaurants").doc(tenant);
    return db.runTransaction(async (tx) => {
        const meta = measuredSnapshot(await tx.get(parent.collection("syncMeta").doc("main")));
        let query = parent.collection(entityCollections[entity]).orderBy("__name__").limit(500);
        if (after)
            query = query.startAfter(after);
        const snapshot = measuredSnapshot(await tx.get(query));
        return { schemaVersion: 1, baselineCursor: Number(meta.data()?.cursor ?? 0), records: snapshot.docs.map(doc => withId(doc)),
            after: snapshot.docs.at(-1)?.id ?? after ?? null, hasMore: snapshot.docs.length === 500 };
    }, { readOnly: true });
}
