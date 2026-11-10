import { waiterHistory, waiterHistoryCache } from "../services/waiter-history.js";
import { runLoggedTransaction } from "../modules/sync/logged-transaction.js";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "../config/firebase.js";
import { env } from "../config/env.js";
import { requireOwner, requireRole } from "../middleware/auth.js";
import { hashPassword, verifyPassword, getUserById } from "../services/users.js";
import { findRestaurantBySlug } from "../services/restaurants.js";
import { getTenantContext } from "../services/tenant.js";
import { assertFeature } from "../services/plans.js";
import { HttpError, sendJson } from "../utils/http.js";
import { recordChanges } from "../modules/sync/change-log.js";
import type { Order, OrderLine } from "../modules/restaurant-ops/types.js";
import { randomUUID, createHash } from "node:crypto";
const credentials = z.object({ name: z.string().trim().min(1).max(80), username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,40}$/), password: z.string().min(8).max(128) }).strict();
const batchSchema = z.object({ operationId: z.string().uuid(), tableId: z.string().min(1).max(128), orderId: z.string().max(128), createdAt: z.string().datetime(), items: z.array(z.object({ menuItemId: z.string().min(1).max(128), quantity: z.number().int().min(1).max(999), notes: z.string().max(500) }).strict()).min(1).max(100), orderNote: z.string().max(1000).optional() }).strict();
const root = (id: string) => db.collection("restaurants").doc(id);
const accountId = (id: string, username: string) => "waiter_" + createHash("sha256").update(id + ":" + username).digest("hex");
export const waiterRouter = Router();
export const ownerWaitersRouter = Router();
ownerWaitersRouter.use(requireOwner);
ownerWaitersRouter.use(async (req, _res, next) => { try {
    const { restaurant } = await getTenantContext(req, "tables");
    assertFeature(restaurant, "orders");
    next();
}
catch (e) {
    next(e);
} });
ownerWaitersRouter.get("/", async (req, res, next) => {
    try {
        const snap = await db.collection("users").where("restaurantId", "==", req.user!.restaurantId!).get();
        sendJson(res, snap.docs.filter(d => d.data().role === "WAITER").map(d => ({ id: d.id, name: d.data().name, username: d.data().username, isActive: d.data().isActive })));
    }
    catch (e) {
        next(e);
    }
});
ownerWaitersRouter.post("/", async (req, res, next) => {
    try {
        const input = credentials.parse(req.body);
        const id = accountId(req.user!.restaurantId!, input.username);
        const passwordHash = await hashPassword(input.password);
        await runLoggedTransaction(db, async (tx) => { const ref = db.collection("users").doc(id); if ((await tx.get(ref)).exists)
            throw new HttpError(409, "اسم المستخدم مستخدم بالفعل"); tx.create(ref, { name: input.name, username: input.username, email: "", passwordHash, role: "WAITER", restaurantId: req.user!.restaurantId, isActive: true, permissions: [], createdAt: new Date().toISOString() }); });
        sendJson(res, { id }, 201);
    }
    catch (e) {
        next(e);
    }
});
ownerWaitersRouter.patch("/:id", async (req, res, next) => {
    try {
        const input = z.object({ name: z.string().trim().min(1).max(80).optional(), password: z.string().min(8).max(128).optional(), isActive: z.boolean().optional() }).strict().parse(req.body);
        const passwordHash = input.password ? await hashPassword(input.password) : undefined;
        await runLoggedTransaction(db, async (tx) => { const ref = db.collection("users").doc(req.params.id); const user = (await tx.get(ref)).data(); if (!user || user.role !== "WAITER" || user.restaurantId !== req.user!.restaurantId)
            throw new HttpError(404, "الحساب غير موجود"); const { password, ...patch } = input; tx.update(ref, { ...patch, ...(passwordHash ? { passwordHash } : {}), updatedAt: new Date().toISOString() }); });
        sendJson(res, { ok: true });
    }
    catch (e) {
        next(e);
    }
});
ownerWaitersRouter.get("/orders/:orderId/batches", async (req, res, next) => {
  try {
    if (req.query.incremental !== "1") {
      // Keep the complete array contract for previously opened owner clients.
      const snap = await root(req.user!.restaurantId!).collection("waiterBatches").where("orderId", "==", req.params.orderId).get();
      return sendJson(res, snap.docs.map(d => d.data()).sort((a, b) => String(a.acceptedAt).localeCompare(String(b.acceptedAt))));
    }
    const after = z.coerce.number().int().min(0).default(0).parse(req.query.after);
    sendJson(res, await waiterHistory(req.user!.restaurantId!, req.params.orderId, after));
  } catch (error) { next(error); }
});
waiterRouter.post("/login", async (req, res, next) => {
    try {
        const input = z.object({ slug: z.string().min(1), username: credentials.shape.username, password: z.string().min(1).max(128) }).strict().parse(req.body);
        const restaurant = await findRestaurantBySlug(input.slug);
        if (!restaurant)
            throw new HttpError(401, "بيانات الدخول غير صحيحة");
        assertFeature(restaurant, "tables");
        assertFeature(restaurant, "orders");
        const id = accountId(restaurant.id, input.username);
        const user = await getUserById(id);
        if (!user || user.restaurantId !== restaurant.id || user.role !== "WAITER" || !user.isActive || !(await verifyPassword(input.password, user.passwordHash)))
            throw new HttpError(401, "بيانات الدخول غير صحيحة");
        const auth = { id, name: user.name, email: "", role: "WAITER", restaurantId: restaurant.id };
        sendJson(res, { token: jwt.sign(auth, env.JWT_SECRET, { expiresIn: "8h" }), user: auth, restaurantName: restaurant.name });
    }
    catch (e) {
        next(e);
    }
});
waiterRouter.use(requireRole("WAITER"));
waiterRouter.use(async (req, _res, next) => {
    try {
        const user = req.user!.id ? await getUserById(req.user!.id) : null;
        if (!user || !user.isActive || user.role !== "WAITER" || user.restaurantId !== req.user!.restaurantId)
            throw new HttpError(401, "الحساب معطل أو انتهت الجلسة");
        req.user!.name = user.name;
        const { restaurant } = await getTenantContext(req, "tables");
        assertFeature(restaurant, "orders");
        next();
    }
    catch (e) {
        next(e);
    }
});
// All non-terminal statuses in the actual OrderStatus model, including DRAFT.
const activeStatuses = ["DRAFT", "PENDING", "CONFIRMED", "PREPARING", "READY", "SERVED"];
const visibleTable = (id: string, t: FirebaseFirestore.DocumentData) => ({
    id, name: t.name, area: t.area, status: t.status, currentOrderId: t.currentOrderId || ""
});
const visibleOrder = (id: string, o: FirebaseFirestore.DocumentData) => ({
    id, tableId: o.tableId, status: o.status,
    items: (o.items as OrderLine[]).map(({ menuItemId, name, quantity, notes }) => ({ menuItemId, name, quantity, notes }))
});
async function loadMenu(id: string) {
    const [items, categories] = await Promise.all([root(id).collection("items").get(), root(id).collection("categories").get()]);
    return {
        items: items.docs.map(d => ({ id: d.id, name: d.data().name, categoryId: d.data().categoryId, isAvailable: d.data().isAvailable, order: d.data().order })),
        categories: categories.docs.filter(d => d.data().isActive).map(d => ({ id: d.id, name: d.data().name, order: d.data().order }))
    };
}
async function loadState(id: string) {
    // One consistent snapshot for table pointers and their active orders. No history scan.
    return db.runTransaction(async tx => {
        const [tables, orders] = await Promise.all([
            tx.get(root(id).collection("tables")),
            tx.get(root(id).collection("orders").where("status", "in", activeStatuses))
        ]);
        return {
            tables: tables.docs.filter(d => !d.data().deletedAt && d.data().status !== "DISABLED").map(d => visibleTable(d.id, d.data())),
            orders: orders.docs.map(d => visibleOrder(d.id, d.data()))
        };
    }, { readOnly: true });
}
waiterRouter.get("/menu", async (req, res, next) => {
    try { sendJson(res, await loadMenu(req.user!.restaurantId!)); } catch (e) { next(e); }
});
waiterRouter.get("/state", async (req, res, next) => {
    try { sendJson(res, await loadState(req.user!.restaurantId!)); } catch (e) { next(e); }
});
// Compatibility for previously opened clients; the new client never polls this route.
waiterRouter.get("/bootstrap", async (req, res, next) => {
    try {
        const id = req.user!.restaurantId!;
        const [state, menu] = await Promise.all([loadState(id), loadMenu(id)]);
        sendJson(res, { ...state, ...menu });
    } catch (e) { next(e); }
});
waiterRouter.post("/batches", async (req, res, next) => {
    try {
        const input = batchSchema.parse(req.body);
        const { restaurant, restaurantId } = await getTenantContext(req);
        const result = await runLoggedTransaction(db, async (tx) => {
            const parent = root(restaurantId);
            const batchRef = parent.collection("waiterBatches").doc(input.operationId);
            const prior = await tx.get(batchRef);
            if (prior.exists) {
                const b = prior.data()!;
                if (b.waiterId !== req.user!.id || b.fingerprint !== JSON.stringify(input))
                    throw new HttpError(409, "تعارض معرف العملية");
                // A lost reply may be retried after another waiter added lines or the order closed.
                // These two targeted reads return current confirmation without replaying the batch.
                const [tableSnapshot, orderSnapshot] = await Promise.all([
                    tx.get(parent.collection("tables").doc(input.tableId)),
                    tx.get(parent.collection("orders").doc(b.orderId))
                ]);
                const table = tableSnapshot.data(), order = orderSnapshot.data();
                return {
                    orderId: b.orderId,
                    table: table && !table.deletedAt && table.status !== "DISABLED" ? visibleTable(input.tableId, table) : null,
                    order: order && table?.currentOrderId === b.orderId && activeStatuses.includes(order.status) ? visibleOrder(b.orderId, order) : null
                };
            }
            const activeUser = await tx.get(db.collection("users").doc(req.user!.id!));
            if (!activeUser.data()?.isActive || activeUser.data()?.restaurantId !== restaurantId || activeUser.data()?.role !== "WAITER")
                throw new HttpError(401, "الحساب معطل");
            const tableRef = parent.collection("tables").doc(input.tableId);
            const table = (await tx.get(tableRef)).data();
            if (!table || table.deletedAt || table.status === "DISABLED")
                throw new HttpError(409, "الطاولة غير متاحة؛ راجع الطلب");
            const orderId = input.orderId || table.currentOrderId || randomUUID();
            if (input.orderId && table.currentOrderId !== input.orderId)
                throw new HttpError(409, "تغير طلب الطاولة؛ راجع الإضافات");
            const orderRef = parent.collection("orders").doc(orderId);
            const order = (await tx.get(orderRef)).data() as Order | undefined;
            if ((input.orderId && !order) || (order && (["COMPLETED", "CANCELLED"].includes(order.status) || order.invoiceId || order.paymentId || order.tableId !== input.tableId)))
                throw new HttpError(409, "الطلب مغلق أو غير قابل للإضافة");
            const distinctItems = new Map(await Promise.all([...new Set(input.items.map(i => i.menuItemId))].map(async id => [id, await tx.get(parent.collection("items").doc(id))] as const)));
            const snapshots = input.items.map(i => distinctItems.get(i.menuItemId)!);
            const lines: OrderLine[] = input.items.map((i, index) => { const item = snapshots[index].data(); if (!item || !item.isAvailable || !Number.isFinite(item.price) || item.price < 0)
                throw new HttpError(409, "أحد الأصناف غير متاح؛ راجع الطلب"); return { ...i, name: item.name, unitPrice: item.price, total: item.price * i.quantity, modifiers: [] }; });
            const items = [...(order?.items ?? []), ...lines];
            const subTotal = items.reduce((sum, i) => sum + i.total, 0);
            const now = new Date().toISOString();
            const version = Math.max(Date.now(), Number(order?.version ?? 0) + 1);
            const orderNote = input.orderNote?.trim();
            const notes = orderNote ? [order?.notes, `${activeUser.data()!.name}: ${orderNote}`].filter(Boolean).join("\n") : order?.notes || "";
            const historyState = order as (Order & { waiterBatchCursor?: number; waiterBatchSequenceReady?: boolean }) | undefined;
            const firstHistory = order && historyState?.waiterBatchCursor === undefined
                ? await tx.get(parent.collection("waiterBatches").where("orderId", "==", orderId).limit(1)) : undefined;
            const sequenceReady = !order || historyState?.waiterBatchSequenceReady === true || firstHistory?.empty === true;
            const batchCursor = (historyState?.waiterBatchCursor ?? 0) + 1;
            const updated = { ...(order ?? {}), waiterBatchCursor: batchCursor, waiterBatchSequenceReady: sequenceReady, currency: order?.currency || restaurant.currency || "SYP", restaurantId, name: order?.name || `طاولة ${table.name}`, tableId: input.tableId, type: order?.type || "DINE_IN", source: order?.source || "WAITER", status: order?.status || "PENDING", items, subTotal, discount: order?.discount ?? 0, tax: order?.tax ?? 0, serviceCharge: order?.serviceCharge ?? 0, total: Math.max(0, subTotal - (order?.discount ?? 0) + (order?.tax ?? 0) + (order?.serviceCharge ?? 0)), paidAmount: order?.paidAmount ?? 0, paymentStatus: order?.paymentStatus || "UNPAID", paymentMethod: order?.paymentMethod || "CASH", notes, createdById: order?.createdById || req.user!.id!, closedById: "", invoiceId: "", paymentId: "", inventoryDeductedAt: "", completedAt: "", cancelledAt: "", orderedAt: order?.orderedAt || now, createdAt: order?.createdAt || now, updatedAt: now, version };
            const nextTable = { ...table, version, status: "OCCUPIED", currentOrderId: orderId, updatedAt: now };
            await recordChanges(tx, restaurantId, [{ entityType: "order", entityId: orderId, action: "upsert", version, data: { ...updated, id: orderId } }, { entityType: "table", entityId: input.tableId, action: "upsert", version, data: { ...nextTable, id: input.tableId } }]);
            tx.set(orderRef, updated);
            tx.update(tableRef, nextTable);
            tx.create(batchRef, { ...input, batchCursor, orderId, waiterId: req.user!.id, waiterName: activeUser.data()!.name, acceptedAt: now, fingerprint: JSON.stringify(input), items: lines.map(({ menuItemId, name, quantity, notes }) => ({ menuItemId, name, quantity, notes })) });
            return { orderId, table: visibleTable(input.tableId, nextTable), order: visibleOrder(orderId, updated) };
        });
        waiterHistoryCache.clear();
        sendJson(res, result);
    }
    catch (e) {
        next(e);
    }
});
