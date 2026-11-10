import { incrementalEnabled, snapshotPage } from "./snapshot.js";
import { Router } from "express";
import { getRequiredTenantId, getTenantContext } from "../../services/tenant.js";
import { HttpError, sendJson } from "../../utils/http.js";
import { pullChanges, pushOperations } from "./service.js";
import { syncPullQuerySchema, syncPushSchema } from "./validators.js";
export const syncRouter = Router();
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
