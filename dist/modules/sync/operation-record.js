import { HttpError } from "../../utils/http.js";
import { operationPayloadHash } from "./operation-fingerprint.js";
import { operationRecordReuseViolation } from "./operation-record-rules.js";
export function assertSameOperationRecord(operation, record, context, hash = operationPayloadHash(operation)) {
    const violation = operationRecordReuseViolation(operation, record, context, hash);
    if (violation)
        throwOperationReuse(violation);
}
function throwOperationReuse(label) {
    throw new HttpError(409, `Operation id was already used for a different ${label}`, {
        code: "operation_reuse"
    });
}
