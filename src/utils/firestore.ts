import type { DocumentData, DocumentSnapshot, Timestamp } from "firebase-admin/firestore";

function toIso(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return value;
}

export function withId<T>(doc: DocumentSnapshot<DocumentData>): T {
  const data = doc.data();
  return Object.fromEntries(
    Object.entries({ id: doc.id, ...data }).map(([key, value]) => [key, toIso(value)])
  ) as T;
}
