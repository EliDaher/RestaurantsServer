# Restaurant-scoped table-number uniqueness

## Model and identity

Tables remain at `restaurants/{restaurantId}/tables/{stableTableId}`. The existing `name` string is the number/name; there is no numeric table-number field. Order `tableId` references and table IDs are unchanged. The same name/number is allowed in different restaurants and areas do not create a separate numbering scope. A live `DISABLED` table still owns its number. A sync-deleted tombstone does not.

Identity normalization trims surrounding whitespace. Only entirely numeric names convert Arabic-Indic and Persian digits to English digits and remove leading zeros without converting to JavaScript Number (so arbitrarily long numbers remain exact). Thus `5`, `٥`, `۵`, and `05` share one identity. Named identities retain digits, case, punctuation, prefixes, and internal spacing: `A05` != `A5`, `Table 5` != `5`, `Table 5` != `table 5`, and `طاولة ٥` != `طاولة 5`. The display field remains a string and existing records are not rewritten by auditing.

The original cause is that independently generated table IDs permit repeated `name` values; document identity alone imposes no uniqueness on a field within a restaurant. Cached validation cannot arbitrate concurrent server writes. The workspace already contained the reservation implementation when this request was received; this pass verified it and corrected normalization that previously folded digits inside legitimate named identities.

## Atomic enforcement

A reservation at `restaurants/{restaurantId}/tableNameReservations/{sha256(normalizedName)}` contains `{ normalizedName, tableId }`. Creation, rename, and deletion read reservations and stage reservation/table writes in one Firestore transaction. Rename releases only a reservation owned by the edited table and acquires the new reservation in the same commit. Deletion retains its existing semantics: REST hard delete, sync tombstone. Both release only their own reservation. No order records are modified.

Both REST and the existing table sync transaction call the same reservation helper. The helper performs all reads before returning a write callback so sync's existing change-log reads still precede every write. Sync operation IDs, queues, cursors, payloads, and Dexie schemas are unchanged. Old queued operations cannot bypass uniqueness and conflicts use the existing conflict response path.

Legacy tables may have no reservations. Each administration transaction scans the restaurant's tables within that transaction to detect normalized legacy collisions; the reservation document arbitrates concurrent requests. Consequently strict new-number enforcement does not require a risky blind backfill. This scan has a read cost proportional to the restaurant's table count and may increase transaction contention; monitor retries/latency for unusually large restaurants. A later indexed migration would be a separate task.

REST conflicts are HTTP 409 with `error.message = رقم الطاولة مستخدم بالفعل، اختر رقمًا آخر` and `error.details = { code: duplicate_table_number, field: name }`. Existing response envelopes and data contracts remain unchanged.

## Frontend and offline behavior

Both table administration forms validate name, positive integer capacity, and cached same-restaurant duplicate identities, excluding the edited ID. A disabled Save button and inline Arabic feedback accompany known duplicates. A server conflict leaves all values open for correction. Submit handlers repeat validation and have a synchronous in-flight lock.

The inspected forms formerly enqueued writes. To meet the requirement that creation/update success requires server confirmation, these two forms now use existing authenticated REST endpoints and update the existing local table cache only after confirmation. Offline browsing and order operations remain on their existing cache/sync paths. Existing queued table changes are retained and processed normally with backend uniqueness checks. Administration refuses to overwrite a table with pending local changes or an unresolved conflict; sync/resolve it first. No offline administration writes are added. Edit requests omit the non-editable `currentOrderId` field so a stale cached form cannot detach a server order. Cache refresh also protects an unresolved local current-order operation.

A successful write followed by a failed cache refresh is reported as saved on the server with a separate refresh warning; it is never reported as a retryable creation failure. Missing/ambiguous write confirmation preserves the form and asks the operator to verify the list before retrying. No automatic write retry is introduced.

## Read-only audit

Run from the backend folder with the intended deployment's Firebase credentials:

```powershell
npm run build
node dist/scripts/audit-table-numbers.js
node dist/scripts/audit-table-numbers.js --restaurant RESTAURANT_ID
```

The JSON report includes an `auditedAt` UTC timestamp and lists duplicate groups by restaurant with original record fields/IDs, missing reservations, and orphan reservations. It writes no database records. Missing reservations are expected before lazy acquisition; they do not require destructive repair. Treat the report as operational data and store it appropriately.

Read-only audit on 2026-10-12 at 09:17 Damascus time (06:17 UTC) of the locally configured Firebase project completed: 9 restaurants, 27 live tables, 0 duplicate groups, 27 missing reservations, and 0 orphan reservations. The JSON report is saved at the project root as `table-number-audit.json`. No Firestore writes were performed. Missing reservations are expected before first acquisition.

The included tests detect existing duplicates without rewriting them. The audit can be rerun at any time.

## Safe resolution and rollout

1. Audit the target database before deployment, retaining the original table IDs and current order associations in the report. Schedule a brief pause of table administration during the server rollout.
2. Have the restaurant operator choose which stable table keeps a duplicate number and choose unused names/numbers for the remaining IDs. Rename those records through the existing edit endpoint/UI; do not delete, merge, reassign orders, or create replacement table IDs. Deactivation alone does not free a number.
3. Deploy the backend to all serving instances before deploying the new forms or resuming administration. Do not run old backend writers alongside the new constraint: old writers do not acquire reservations. Also ensure import/admin scripts and any Firestore direct-write clients cannot bypass this backend enforcement; reservation writes require the same trusted-server permissions as table writes.
4. Re-audit after resolution and verify duplicate groups are empty. For already duplicated legacy records, unchanged-number backend metadata edits remain allowed until explicit resolution; new tables/renames into a conflicting identity are rejected. The UI directs operators to resolve known duplicates before saving.
5. Investigate any orphan reservation manually against the referenced table and its live/deleted state. Do not bulk-remove reservations while writers are active. If manual repair is necessary, pause table writers and verify each reservation's owner and normalized identity before any targeted repair; rerun the audit afterward.
6. Exercise two concurrent creates/renames on a staging Firestore instance and confirm one succeeds and one returns 409. Check remaining pending sync operations for `duplicate_table_number` conflicts and resolve them using the existing conflict workflow.

Rollback must not leave old unconstrained writers active against a database requiring uniqueness. Pause table administration if reverting the backend. No automatic backfill, renumbering, table deletion, order migration, or production deployment is performed by this change.

If an earlier build using digit folding inside names was deployed, audit its reservations before switching normalization. Pause table writers, verify the referenced stable table IDs, and manually repair only reservations whose key no longer matches their owner's identity. The current audit found no reservations requiring such repair.

## Verification

```powershell
npm run typecheck
npm run build
node --test tests/*.test.mjs
```

From frontend:

```powershell
npm run lint
node --experimental-strip-types --test tests/*.test.mjs
```

Backend concurrency tests use an optimistic Firestore transaction harness with document-version/query retries and atomic commits. They do not claim to be live Firestore/emulator integration tests. Frontend tests cover normalized cached duplicates, restaurant scoping, edit exclusion, Arabic 409 mapping, capacity/name validation, unchanged input, and required server confirmation. Existing offline/order regression suites remain included.

Verification on 2026-10-12 passed backend typecheck, backend build, all 35 backend tests, frontend lint (the project's TypeScript check), and all 100 frontend tests. No browser interaction or live concurrent Firestore write test was performed; concurrency verification uses the transaction harness.

Files changed in this pass: `backend/src/modules/restaurant-ops/table-name.ts`, `frontend/src/lib/table-number.ts`, `backend/tests/table-uniqueness.test.mjs`, `frontend/tests/table-number.test.mjs`, `backend/src/scripts/audit-table-numbers.ts`, this document, and root `table-number-audit.json`. Backend build also regenerated the corresponding `dist` JavaScript files. The existing REST service, reservation helper, sync integration, and two administration forms were inspected and verified without additional changes in this pass.
