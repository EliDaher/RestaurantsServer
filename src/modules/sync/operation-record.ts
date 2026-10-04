import { HttpError } from "../../utils/http.js";
import { operationPayloadHash } from "./operation-fingerprint.js";
import { operationRecordReuseViolation, type OperationContext, type OperationRecordSnapshot } from "./operation-record-rules.js";
import type { SyncPushOperation } from "./types.js";

export function assertSameOperationRecord(
  operation: SyncPushOperation,
  record: OperationRecordSnapshot,
  context: OperationContext,
  hash = operationPayloadHash(operation)
) {
  const violation = operationRecordReuseViolation(operation, record, context, hash);
  if (violation) throwOperationReuse(violation);
}

function throwOperationReuse(label: string): never {
  throw new HttpError(409, `Operation id was already used for a different ${label}`, {
    code: "operation_reuse"
  });
}
