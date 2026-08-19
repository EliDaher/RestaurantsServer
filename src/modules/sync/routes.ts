import { Router } from "express";
import { getTenantContext } from "../../services/tenant.js";
import { sendJson } from "../../utils/http.js";
import { pullChanges, pushOperations } from "./service.js";
import { syncPullQuerySchema, syncPushSchema } from "./validators.js";

export const syncRouter = Router();

syncRouter.get("/health", async (req, res, next) => {
  try {
    const { restaurantId } = await getTenantContext(req);
    sendJson(res, {
      ok: true,
      restaurantId,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

syncRouter.post("/push", async (req, res, next) => {
  try {
    const { restaurantId } = await getTenantContext(req);
    const input = syncPushSchema.parse(req.body);
    sendJson(res, await pushOperations(restaurantId, req.user!, input.deviceId, input.operations));
  } catch (error) {
    next(error);
  }
});

syncRouter.get("/pull", async (req, res, next) => {
  try {
    const { restaurantId } = await getTenantContext(req);
    const input = syncPullQuerySchema.parse(req.query);
    sendJson(res, await pullChanges(restaurantId, input.cursor));
  } catch (error) {
    next(error);
  }
});
