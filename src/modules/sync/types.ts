import type { Table } from "../restaurant-ops/types.js";

export type SyncEntityType =
  | "table"
  | "order"
  | "inventoryItem"
  | "inventoryTransaction"
  | "recipeIngredient"
  | "supplier"
  | "invoice"
  | "payment"
  | "expense"
  | "cashRegister"
  | "cashMovement"
  | "account"
  | "journalEntry"
  | "category"
  | "menuItem";

export type SyncAction =
  | "create"
  | "update"
  | "delete"
  | "completeOrder"
  | "cancelOrder"
  | "adjustInventory"
  | "saveRecipe";

export type SyncPushOperation = {
  operationId: string;
  entityType: SyncEntityType;
  entityId: string;
  action: SyncAction;
  payload: Record<string, unknown>;
  baseVersion?: number;
  dependencyIds: string[];
  clientCreatedAt: string;
};

export type SyncPushResult = {
  operationId: string;
  status: "applied" | "duplicate" | "rejected" | "conflict";
  entityType: SyncEntityType;
  entityId: string;
  serverVersion?: number;
  serverCursor?: number;
  response?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type SyncChange = {
  cursor: number;
  entityType: SyncEntityType;
  entityId: string;
  action: "upsert" | "delete";
  version: number;
  changedAt: string;
  data?: Record<string, unknown>;
};

export type SyncOperationRecord = {
  operationId: string;
  payloadHash: string;
  entityType: SyncEntityType;
  entityId: string;
  status: "applied";
  response: Record<string, unknown>;
  serverVersion: number;
  serverCursor: number;
  deviceId: string;
  userId: string;
  createdAt: FirebaseFirestore.FieldValue;
};

export type TablePayload = Pick<Table, "name" | "area" | "capacity" | "status" | "currentOrderId" | "qrCode">;
