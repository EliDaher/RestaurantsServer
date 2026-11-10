import { db } from "../config/firebase.js";
import { ReadCache } from "../utils/read-cache.js";
import { measuredSnapshot } from "../utils/read-metrics.js";
export const waiterHistoryCache = new ReadCache();
export async function waiterHistory(tenant, order, after) {
    return waiterHistoryCache.get(`${tenant}:${order}:${after}`, async () => {
        const parent = db.collection("restaurants").doc(tenant);
        const document = measuredSnapshot(await parent.collection("orders").doc(order).get());
        const indexed = document.data()?.waiterBatchSequenceReady === true;
        let query = parent.collection("waiterBatches").where("orderId", "==", order);
        if (indexed)
            query = query.where("batchCursor", ">", after).orderBy("batchCursor").limit(500);
        const snapshot = measuredSnapshot(await query.get());
        const batches = snapshot.docs.map(d => d.data()).sort((a, b) => String(a.acceptedAt).localeCompare(String(b.acceptedAt)));
        return { batches, cursor: indexed ? Math.max(after, ...batches.map(b => Number(b.batchCursor))) : 0, legacy: !indexed, hasMore: indexed && batches.length === 500 };
    });
}
