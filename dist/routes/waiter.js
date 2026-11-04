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
import { listTables, listOrders } from "../modules/restaurant-ops/service.js";
import { recordChanges } from "../modules/sync/change-log.js";
import { randomUUID, createHash } from "node:crypto";
const credentials = z.object({ name: z.string().trim().min(1).max(80), username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,40}$/), password: z.string().min(8).max(128) }).strict();
const batchSchema = z.object({ operationId: z.string().uuid(), tableId: z.string().min(1).max(128), orderId: z.string().max(128), createdAt: z.string().datetime(), items: z.array(z.object({ menuItemId: z.string().min(1).max(128), quantity: z.number().int().min(1).max(999), notes: z.string().max(500) }).strict()).min(1).max(100), orderNote: z.string().max(1000).optional() }).strict();
const root = (id) => db.collection("restaurants").doc(id);
const accountId = (id, username) => "waiter_" + createHash("sha256").update(id + ":" + username).digest("hex");
export const waiterRouter = Router();
export const ownerWaitersRouter = Router();
ownerWaitersRouter.use(requireOwner);
ownerWaitersRouter.use(async (req, _res, next) => {
    try {
        const { restaurant } = await getTenantContext(req, "tables");
        assertFeature(restaurant, "orders");
        next();
    }
    catch (e) {
        next(e);
    }
});
ownerWaitersRouter.get("/", async (req, res, next) => {
    try {
        const snap = await db.collection("users").where("restaurantId", "==", req.user.restaurantId).get();
        sendJson(res, snap.docs.filter(d => d.data().role === "WAITER").map(d => ({ id: d.id, name: d.data().name, username: d.data().username, isActive: d.data().isActive })));
    }
    catch (e) {
        next(e);
    }
});
ownerWaitersRouter.post("/", async (req, res, next) => {
    try {
        const input = credentials.parse(req.body);
        const id = accountId(req.user.restaurantId, input.username);
        const passwordHash = await hashPassword(input.password);
        await db.runTransaction(async (tx) => {
            const ref = db.collection("users").doc(id);
            if ((await tx.get(ref)).exists)
                throw new HttpError(409, "اسم المستخدم مستخدم بالفعل");
            tx.create(ref, { name: input.name, username: input.username, email: "", passwordHash, role: "WAITER", restaurantId: req.user.restaurantId, isActive: true, permissions: [], createdAt: new Date().toISOString() });
        });
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
        await db.runTransaction(async (tx) => {
            const ref = db.collection("users").doc(req.params.id);
            const user = (await tx.get(ref)).data();
            if (!user || user.role !== "WAITER" || user.restaurantId !== req.user.restaurantId)
                throw new HttpError(404, "الحساب غير موجود");
            const { password, ...patch } = input;
            tx.update(ref, { ...patch, ...(passwordHash ? { passwordHash } : {}), updatedAt: new Date().toISOString() });
        });
        sendJson(res, { ok: true });
    }
    catch (e) {
        next(e);
    }
});
ownerWaitersRouter.get("/orders/:orderId/batches", async (req, res, next) => {
    try {
        const snap = await root(req.user.restaurantId).collection("waiterBatches").where("orderId", "==", req.params.orderId).get();
        sendJson(res, snap.docs.map(d => d.data()).sort((a, b) => String(a.acceptedAt).localeCompare(String(b.acceptedAt))));
    }
    catch (e) {
        next(e);
    }
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
        const user = req.user.id ? await getUserById(req.user.id) : null;
        if (!user || !user.isActive || user.role !== "WAITER" || user.restaurantId !== req.user.restaurantId)
            throw new HttpError(401, "الحساب معطل أو انتهت الجلسة");
        req.user.name = user.name;
        const { restaurant } = await getTenantContext(req, "tables");
        assertFeature(restaurant, "orders");
        next();
    }
    catch (e) {
        next(e);
    }
});
waiterRouter.get("/bootstrap", async (req, res, next) => {
    try {
        const id = req.user.restaurantId;
        const [tables, orders, items, categories] = await Promise.all([listTables(id), listOrders(id), root(id).collection("items").get(), root(id).collection("categories").get()]);
        sendJson(res, { tables: tables.filter(t => t.status !== "DISABLED").map(t => ({ id: t.id, name: t.name, area: t.area, status: t.status, currentOrderId: t.currentOrderId })), orders: orders.filter(o => !["COMPLETED", "CANCELLED"].includes(o.status)).map(o => ({ id: o.id, tableId: o.tableId, status: o.status, items: o.items.map(i => ({ menuItemId: i.menuItemId, name: i.name, quantity: i.quantity, notes: i.notes })) })), items: items.docs.map(d => ({ id: d.id, name: d.data().name, categoryId: d.data().categoryId, isAvailable: d.data().isAvailable, order: d.data().order })), categories: categories.docs.filter(d => d.data().isActive).map(d => ({ id: d.id, name: d.data().name, order: d.data().order })) });
    }
    catch (e) {
        next(e);
    }
});
waiterRouter.post("/batches", async (req, res, next) => {
    try {
        const input = batchSchema.parse(req.body);
        const { restaurant, restaurantId } = await getTenantContext(req);
        const result = await db.runTransaction(async (tx) => {
            const parent = root(restaurantId);
            const batchRef = parent.collection("waiterBatches").doc(input.operationId);
            const prior = await tx.get(batchRef);
            if (prior.exists) {
                const b = prior.data();
                if (b.waiterId !== req.user.id || b.fingerprint !== JSON.stringify(input))
                    throw new HttpError(409, "تعارض معرف العملية");
                return { orderId: b.orderId };
            }
            const activeUser = await tx.get(db.collection("users").doc(req.user.id));
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
            const order = (await tx.get(orderRef)).data();
            if ((input.orderId && !order) || (order && (["COMPLETED", "CANCELLED"].includes(order.status) || order.invoiceId || order.paymentId || order.tableId !== input.tableId)))
                throw new HttpError(409, "الطلب مغلق أو غير قابل للإضافة");
            const snapshots = await Promise.all(input.items.map(i => tx.get(parent.collection("items").doc(i.menuItemId))));
            const lines = input.items.map((i, index) => {
                const item = snapshots[index].data();
                if (!item || !item.isAvailable || !Number.isFinite(item.price) || item.price < 0)
                    throw new HttpError(409, "أحد الأصناف غير متاح؛ راجع الطلب");
                return { ...i, name: item.name, unitPrice: item.price, total: item.price * i.quantity, modifiers: [] };
            });
            const items = [...(order?.items ?? []), ...lines];
            const subTotal = items.reduce((sum, i) => sum + i.total, 0);
            const now = new Date().toISOString();
            const version = Math.max(Date.now(), Number(order?.version ?? 0) + 1);
            const orderNote = input.orderNote?.trim();
            const notes = orderNote ? [order?.notes, `${activeUser.data().name}: ${orderNote}`].filter(Boolean).join("\n") : order?.notes || "";
            const updated = { ...(order ?? {}), currency: order?.currency || restaurant.currency || "SYP", restaurantId, name: order?.name || `طاولة ${table.name}`, tableId: input.tableId, type: order?.type || "DINE_IN", source: order?.source || "WAITER", status: order?.status || "PENDING", items, subTotal, discount: order?.discount ?? 0, tax: order?.tax ?? 0, serviceCharge: order?.serviceCharge ?? 0, total: Math.max(0, subTotal - (order?.discount ?? 0) + (order?.tax ?? 0) + (order?.serviceCharge ?? 0)), paidAmount: order?.paidAmount ?? 0, paymentStatus: order?.paymentStatus || "UNPAID", paymentMethod: order?.paymentMethod || "CASH", notes, createdById: order?.createdById || req.user.id, closedById: "", invoiceId: "", paymentId: "", inventoryDeductedAt: "", completedAt: "", cancelledAt: "", orderedAt: order?.orderedAt || now, createdAt: order?.createdAt || now, updatedAt: now, version };
            const nextTable = { ...table, version, status: "OCCUPIED", currentOrderId: orderId, updatedAt: now };
            await recordChanges(tx, restaurantId, [{ entityType: "order", entityId: orderId, action: "upsert", version, data: { ...updated, id: orderId } }, { entityType: "table", entityId: input.tableId, action: "upsert", version, data: { ...nextTable, id: input.tableId } }]);
            tx.set(orderRef, updated);
            tx.update(tableRef, nextTable);
            tx.create(batchRef, { ...input, orderId, waiterId: req.user.id, waiterName: activeUser.data().name, acceptedAt: now, fingerprint: JSON.stringify(input), items: lines.map(({ menuItemId, name, quantity, notes }) => ({ menuItemId, name, quantity, notes })) });
            return { orderId };
        });
        sendJson(res, result);
    }
    catch (e) {
        next(e);
    }
});
