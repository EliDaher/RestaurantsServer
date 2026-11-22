import { incrementalEnabled, snapshotPage } from "./snapshot.js";
import { Router } from "express";
import { getRequiredTenantId, getTenantContext } from "../../services/tenant.js";
import { HttpError, sendJson } from "../../utils/http.js";
import { pullChanges, pushOperations } from "./service.js";
import { syncPullQuerySchema, syncPushSchema } from "./validators.js";
import { operationRef } from "./idempotency.js";
import { assertSameOperationRecord } from "./operation-record.js";
export const syncRouter = Router();
syncRouter.post("/operations/:operationId", async (req, res, next) => {
    try {
        const { restaurantId } = await getTenantContext(req);
        const id = String(req.params.operationId);
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id))
            throw new HttpError(400, "Invalid operation id");
        const snapshot = await operationRef(restaurantId, id).get();
        const record = snapshot.data();
        const input = syncPushSchema.parse(req.body);
        if (input.operations.length !== 1 || input.operations[0].operationId !== id)
            throw new HttpError(400, "Expected matching operation");
        if (record)
            assertSameOperationRecord(input.operations[0], record, { restaurantId, deviceId: input.deviceId, userId: req.user.id ?? req.user.email });
        sendJson(res, { record: record ?? null });
    }
    catch (error) {
        next(error);
    }
});
syncRouter.get("/health", async (req, res, next) => {
    try {
        const restaurantId = getRequiredTenantId(req);
        sendJson(res, {
            ok: true,
            restaurantId,
            serverTime: new Date().toISOString()
        });
    }
    catch (error) {
        next(error);
    }
});
syncRouter.post("/push", async (req, res, next) => {
    try {
        const { restaurantId } = await getTenantContext(req);
        const input = syncPushSchema.parse(req.body);
        sendJson(res, await pushOperations(restaurantId, req.user, input.deviceId, input.operations));
    }
    catch (error) {
        next(error);
    }
});
syncRouter.get("/pull", async (req, res, next) => {
    try {
        const { restaurantId } = await getTenantContext(req);
        const input = syncPullQuerySchema.parse(req.query);
        sendJson(res, await pullChanges(restaurantId, input.cursor, input.throughCursor));
    }
    catch (error) {
        next(error);
    }
});
syncRouter.get("/config", (req, res) => {
    const restaurantId = getRequiredTenantId(req);
    sendJson(res, { enabled: incrementalEnabled(restaurantId), schemaVersion: 1 });
});
syncRouter.get("/snapshot", async (req, res, next) => {
    try {
        const { restaurantId } = await getTenantContext(req);
        const entity = String(req.query.entity ?? "");
        const after = req.query.after === undefined ? undefined : String(req.query.after);
        if (after && (after.length > 1500 || after.includes("/")))
            throw new HttpError(400, "Invalid snapshot cursor");
        sendJson(res, await snapshotPage(restaurantId, entity, after));
    }
    catch (error) {
        next(error);
    }
});
