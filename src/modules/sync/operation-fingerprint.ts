import { createHash } from "node:crypto";
import type { SyncPushOperation } from "./types.js";

export function operationPayloadHash(operation: SyncPushOperation) {
  return createHash("sha256").update(stableStringify({
    entityType: operation.entityType,
    entityId: operation.entityId,
    action: operation.action,
    payload: operation.payload
  })).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) => first.localeCompare(second));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
