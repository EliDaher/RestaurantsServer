import { db, FieldValue } from "../../config/firebase.js";
import type { SyncChange, SyncEntityType } from "./types.js";

type RecordChangeInput = {
  entityType: SyncEntityType;
  entityId: string;
  action: "upsert" | "delete";
  version: number;
  data?: Record<string, unknown>;
};

export async function listChanges(restaurantId: string, cursor: number) {
  const snapshot = await db
    .collection("restaurants")
    .doc(restaurantId)
    .collection("changeLog")
    .where("cursor", ">", cursor)
    .orderBy("cursor", "asc")
    .limit(500)
    .get();

  const changes = snapshot.docs.map((doc) => doc.data() as SyncChange);
  return {
    cursor: changes.at(-1)?.cursor ?? cursor,
    changes
  };
}

export async function recordChange(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  input: RecordChangeInput
) {
  const cursors = await recordChanges(transaction, restaurantId, [input]);
  return cursors[0] ?? 0;
}

export async function recordChanges(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  inputs: RecordChangeInput[]
) {
  if (!inputs.length) return [];

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
