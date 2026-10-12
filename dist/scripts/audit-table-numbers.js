import { db } from "../config/firebase.js";
import { findTableNameDuplicates, normalizeTableName } from "../modules/restaurant-ops/table-name.js";
import { tableNameReservationCollection, tableNameReservationId } from "../modules/restaurant-ops/table-uniqueness.js";
// Read-only: no reservation backfill, table mutation, deletion, or renumbering.
async function audit() {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--restaurant" || !args[1]))
        throw new Error("Usage: node dist/scripts/audit-table-numbers.js [--restaurant ID]");
    const selected = args[1];
    const restaurantRefs = selected
        ? [db.collection("restaurants").doc(selected)]
        : (await db.collection("restaurants").get()).docs.map((snapshot) => snapshot.ref);
    const report = [];
    for (const restaurant of restaurantRefs) {
        const [tableSnapshot, reservationSnapshot] = await Promise.all([
            restaurant.collection("tables").get(), restaurant.collection(tableNameReservationCollection).get()
        ]);
        const tables = tableSnapshot.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id, name: String(snapshot.data().name ?? "") }));
        const live = tables.filter((table) => !table.deletedAt);
        const duplicates = findTableNameDuplicates(tables);
        const reservations = new Map(reservationSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
        report.push({
            restaurantId: restaurant.id,
            liveTableCount: live.length,
            duplicates,
            missingReservations: live.filter((table) => !reservations.has(tableNameReservationId(table.name))).map((table) => ({ id: table.id, name: table.name })),
            orphanReservations: reservationSnapshot.docs.filter((snapshot) => !live.some((table) => table.id === snapshot.data().tableId && normalizeTableName(table.name) === snapshot.data().normalizedName)).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        });
    }
    console.log(JSON.stringify({ readOnly: true, auditedAt: new Date().toISOString(), restaurants: report }, null, 2));
}
audit().catch((error) => {
    console.error("Table-number audit failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
