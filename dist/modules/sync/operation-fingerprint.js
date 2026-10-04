import { createHash } from "node:crypto";
export function operationPayloadHash(operation) {
    return createHash("sha256").update(stableStringify({
        entityType: operation.entityType,
        entityId: operation.entityId,
        action: operation.action,
        payload: operation.payload
    })).digest("hex");
}
export function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value).sort(([first], [second]) => first.localeCompare(second));
        return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
