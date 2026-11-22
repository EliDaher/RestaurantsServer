import type { Request } from "express";
import { pushOperations } from "../sync/service.js";
import type { SyncEntityType, SyncPushOperation } from "../sync/types.js";
import { HttpError } from "../../utils/http.js";

export function durableWriteKey(req: Request) {
  const key = req.get("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{1,128}$/.test(key)) throw new HttpError(400, "A stable Idempotency-Key is required; retain it when retrying", { code: "idempotency_key_required" });
  return key;
}
export async function durableWrite(req: Request, restaurantId: string, entityType: SyncEntityType, action: SyncPushOperation["action"], payload: Record<string, unknown>) {
  const operationId = durableWriteKey(req);
  const deviceId = req.get("X-Device-Id");
  if (!deviceId || deviceId.length > 200) throw new HttpError(400, "A stable X-Device-Id is required");
  const { results } = await pushOperations(restaurantId, req.user!, deviceId, [{ operationId, entityId: operationId, entityType, action, payload, dependencyIds: [], clientCreatedAt: "" }]);
  const result = results[0];
  if (!["applied", "duplicate"].includes(result.status)) throw new HttpError(result.status === "conflict" ? 409 : result.error?.retryable ? 503 : 400, result.error?.message ?? "Write rejected", { code: result.error?.code });
  return { ...result.response, id: operationId };
}
