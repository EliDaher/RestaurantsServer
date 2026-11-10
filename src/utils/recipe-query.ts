import type { Transaction, CollectionReference, QueryDocumentSnapshot } from "firebase-admin/firestore";
export async function orderRecipes(tx: Transaction, collection: CollectionReference, lines: Array<{ menuItemId: string }>) {
  const ids = [...new Set(lines.map(line => line.menuItemId))];
  const docs: QueryDocumentSnapshot[] = [];
  for (let offset = 0; offset < ids.length; offset += 30) {
    const page = await tx.get(collection.where("menuItemId", "in", ids.slice(offset, offset + 30)));
    docs.push(...page.docs);
  }
  return { docs };
}
