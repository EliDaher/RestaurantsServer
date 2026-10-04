import { db, FieldValue } from "../../config/firebase.js";
import { hasPermission } from "../../services/permissions.js";
import type { AuthUser, MenuItem, Restaurant } from "../../types.js";
import { HttpError } from "../../utils/http.js";
import type {
  CashMovement,
  CashRegister,
  Expense,
  InventoryItem,
  InventoryTransaction,
  Invoice,
  JournalEntry,
  JournalEntryLine,
  OperationalPayment,
  Order,
  OrderLine,
  RecipeIngredient,
  Table
} from "../restaurant-ops/types.js";
import { cancelOrderSchema, cashMovementCreateSchema, completeOrderSchema, expenseCreateSchema, orderCreateSchema, orderPatchSchema } from "../restaurant-ops/validators.js";
import { ZodError, type z } from "zod";
import { listChanges, recordChange, recordChanges } from "./change-log.js";
import { assertSamePayload, duplicateResult, operationRef, payloadHash } from "./idempotency.js";
import { currentOrderVersion, nextOrderVersion, orderVersionConflict } from "./order-versioning.js";
import { assertSameOperationRecord } from "./operation-record.js";
import type { SyncEntityType, SyncPushOperation, SyncPushResult } from "./types.js";
import { tableSyncPayloadSchema } from "./validators.js";

export function pullChanges(restaurantId: string, cursor: number) {
  return listChanges(restaurantId, cursor);
}

export async function pushOperations(restaurantId: string, user: AuthUser, deviceId: string, operations: SyncPushOperation[]) {
  const results: SyncPushResult[] = [];

  for (const operation of operations) {
    try {
      results.push(await applyOperation(restaurantId, user, deviceId, operation));
    } catch (error) {
      results.push(errorResult(operation, error));
    }
  }

  return { results };
}

async function applyOperation(restaurantId: string, user: AuthUser, deviceId: string, operation: SyncPushOperation): Promise<SyncPushResult> {
  if (operation.entityType === "table") {
    assertPermissionForSync(user, "tables.manage");
    return applyTableOperation(restaurantId, user, deviceId, operation);
  }

  if (operation.entityType === "order") {
    return applyOrderOperation(restaurantId, user, deviceId, operation);
  }

  if (operation.entityType === "expense") {
    assertPermissionForSync(user, "expenses.create");
    return applyExpenseOperation(restaurantId, user, deviceId, operation);
  }

  if (operation.entityType === "cashMovement") {
    assertPermissionForSync(user, "accounting.manage");
    return applyCashMovementOperation(restaurantId, user, deviceId, operation);
  }

  return {
    operationId: operation.operationId,
    status: "rejected",
    entityType: operation.entityType,
    entityId: operation.entityId,
    error: {
      code: "unsupported_entity",
      message: `Offline sync is not enabled for ${operation.entityType} yet`,
      retryable: false
    }
  };
}

async function applyExpenseOperation(restaurantId: string, user: AuthUser, deviceId: string, operation: SyncPushOperation): Promise<SyncPushResult> {
  if (operation.action !== "create") {
    throw new HttpError(400, `Unsupported expense sync action: ${operation.action}`, { code: "unsupported_action" });
  }

  const opRef = operationRef(restaurantId, operation.operationId);
  const globalOpRef = globalOperationRef(operation.operationId);
  const hash = payloadHash(operation);
  const userId = user.id ?? user.email;

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, globalOperationSnapshot] = await Promise.all([
      transaction.get(opRef),
      transaction.get(globalOpRef)
    ]);

    if (operationSnapshot.exists) {
      const existing = operationSnapshot.data() ?? {};
      assertSameOperationRecord(operation, existing, { restaurantId, deviceId, userId }, hash);
      return duplicateResult(operation, existing);
    }

    if (globalOperationSnapshot.exists) {
      assertSameOperationRecord(operation, globalOperationSnapshot.data() ?? {}, { restaurantId, deviceId, userId }, hash);
      throw new HttpError(409, "Operation was recorded globally without a restaurant result", {
        code: "operation_registry_incomplete"
      });
    }

    const prepared = await prepareCreateExpense(transaction, restaurantId, userId, operation);
    const cursors = await recordChanges(transaction, restaurantId, prepared.changes.map((change) => ({
      entityType: change.entityType,
      entityId: change.entityId,
      action: change.action ?? "upsert",
      version: prepared.serverVersion,
      data: change.data
    })));
    const serverCursor = cursors.at(-1) ?? 0;
    const result: SyncPushResult = {
      operationId: operation.operationId,
      status: "applied",
      entityType: operation.entityType,
      entityId: operation.entityId,
      serverVersion: prepared.serverVersion,
      serverCursor,
      response: prepared.response
    };

    prepared.write(transaction);
    const operationRecord = {
      operationId: operation.operationId,
      payloadHash: hash,
      restaurantId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      action: operation.action,
      status: "applied",
      response: result.response ?? {},
      serverVersion: prepared.serverVersion,
      serverCursor,
      deviceId,
      userId,
      createdAt: FieldValue.serverTimestamp()
    };
    transaction.set(opRef, operationRecord);
    transaction.set(globalOpRef, operationRecord);

    return result;
  });
}

async function applyCashMovementOperation(restaurantId: string, user: AuthUser, deviceId: string, operation: SyncPushOperation): Promise<SyncPushResult> {
  if (operation.action !== "create") {
    throw new HttpError(400, `Unsupported cash movement sync action: ${operation.action}`, { code: "unsupported_action" });
  }

  const opRef = operationRef(restaurantId, operation.operationId);
  const globalOpRef = globalOperationRef(operation.operationId);
  const hash = payloadHash(operation);
  const userId = user.id ?? user.email;

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, globalOperationSnapshot] = await Promise.all([
      transaction.get(opRef),
      transaction.get(globalOpRef)
    ]);

    if (operationSnapshot.exists) {
      const existing = operationSnapshot.data() ?? {};
      assertSameOperationRecord(operation, existing, { restaurantId, deviceId, userId }, hash);
      return duplicateResult(operation, existing);
    }

    if (globalOperationSnapshot.exists) {
      assertSameOperationRecord(operation, globalOperationSnapshot.data() ?? {}, { restaurantId, deviceId, userId }, hash);
      throw new HttpError(409, "Operation was recorded globally without a restaurant result", {
        code: "operation_registry_incomplete"
      });
    }

    const prepared = await prepareCreateCashMovement(transaction, restaurantId, userId, operation);
    const cursors = await recordChanges(transaction, restaurantId, prepared.changes.map((change) => ({
      entityType: change.entityType,
      entityId: change.entityId,
      action: change.action ?? "upsert",
      version: prepared.serverVersion,
      data: change.data
    })));
    const serverCursor = cursors.at(-1) ?? 0;
    const result: SyncPushResult = {
      operationId: operation.operationId,
      status: "applied",
      entityType: operation.entityType,
      entityId: operation.entityId,
      serverVersion: prepared.serverVersion,
      serverCursor,
      response: prepared.response
    };

    prepared.write(transaction);
    const operationRecord = {
      operationId: operation.operationId,
      payloadHash: hash,
      restaurantId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      action: operation.action,
      status: "applied",
      response: result.response ?? {},
      serverVersion: prepared.serverVersion,
      serverCursor,
      deviceId,
      userId,
      createdAt: FieldValue.serverTimestamp()
    };
    transaction.set(opRef, operationRecord);
    transaction.set(globalOpRef, operationRecord);

    return result;
  });
}

async function applyOrderOperation(restaurantId: string, user: AuthUser, deviceId: string, operation: SyncPushOperation): Promise<SyncPushResult> {
  assertOrderPermission(user, operation.action);
  const opRef = operationRef(restaurantId, operation.operationId);
  const globalOpRef = globalOperationRef(operation.operationId);
  const hash = payloadHash(operation);
  const userId = user.id ?? user.email;

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, globalOperationSnapshot] = await Promise.all([
      transaction.get(opRef),
      transaction.get(globalOpRef)
    ]);

    if (operationSnapshot.exists) {
      const existing = operationSnapshot.data() ?? {};
      assertSameOperationRecord(operation, existing, { restaurantId, deviceId, userId }, hash);
      return duplicateResult(operation, existing);
    }

    if (globalOperationSnapshot.exists) {
      assertSameOperationRecord(operation, globalOperationSnapshot.data() ?? {}, { restaurantId, deviceId, userId }, hash);
      throw new HttpError(409, "Operation was recorded globally without a restaurant result", {
        code: "operation_registry_incomplete"
      });
    }

    const prepared = await prepareOrderOperation(transaction, restaurantId, userId, operation);
    const cursors = await recordChanges(transaction, restaurantId, prepared.changes.map((change) => ({
      entityType: change.entityType,
      entityId: change.entityId,
      action: change.action ?? "upsert",
      version: prepared.serverVersion,
      data: change.data
    })));
    const serverCursor = cursors.at(-1) ?? 0;
    const result: SyncPushResult = {
      operationId: operation.operationId,
      status: "applied",
      entityType: operation.entityType,
      entityId: operation.entityId,
      serverVersion: prepared.serverVersion,
      serverCursor,
      response: prepared.response
    };

    prepared.write(transaction);
    const operationRecord = {
      operationId: operation.operationId,
      payloadHash: hash,
      restaurantId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      action: operation.action,
      status: "applied",
      response: result.response ?? {},
      serverVersion: prepared.serverVersion,
      serverCursor,
      deviceId,
      userId,
      createdAt: FieldValue.serverTimestamp()
    };
    transaction.set(opRef, operationRecord);
    transaction.set(globalOpRef, operationRecord);

    return result;
  });
}

async function prepareOrderOperation(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  userId: string,
  operation: SyncPushOperation
): Promise<PreparedOrderOperation> {
  if (operation.action === "create") {
    const input = orderCreateSchema.parse(operation.payload);
    return prepareCreateOrder(transaction, restaurantId, operation.entityId, input, userId);
  }

  if (operation.action === "update") {
    const input = orderPatchSchema.parse(operation.payload);
    return prepareUpdateOrder(transaction, restaurantId, operation.entityId, input, operation.baseVersion);
  }

  if (operation.action === "completeOrder") {
    const input = completeOrderSchema.parse(operation.payload);
    return prepareCompleteOrder(transaction, restaurantId, operation.entityId, input, userId, operation.baseVersion);
  }

  if (operation.action === "cancelOrder") {
    const input = cancelOrderSchema.parse(operation.payload);
    return prepareCancelOrder(transaction, restaurantId, operation.entityId, userId, input.reason, operation.baseVersion);
  }

  throw new HttpError(400, `Unsupported order sync action: ${operation.action}`, { code: "unsupported_action" });
}

async function prepareCreateExpense(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  createdById: string,
  operation: SyncPushOperation
): Promise<PreparedOrderOperation> {
  const input = expenseCreateSchema.parse(operation.payload);
  const now = new Date().toISOString();
  const expenseId = operation.entityId;
  const expenseRef = scopedDoc(restaurantId, "expenses", expenseId);
  const expenseSnapshot = await transaction.get(expenseRef);

  if (expenseSnapshot.exists) {
    throw new HttpError(409, "Expense id already exists without an idempotency record", {
      code: "expense_id_exists"
    });
  }

  const serverVersion = Date.now();
  const expense: Expense = {
    id: expenseId,
    restaurantId,
    category: input.category,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    paidAt: input.paidAt ?? now,
    notes: input.notes,
    createdById,
    createdAt: now,
    updatedAt: now
  };

  return {
    response: { id: expenseId },
    serverVersion,
    changes: [upsertChange("expense", expenseId, expense as unknown as Record<string, unknown>)],
    write: (writeTransaction) => {
      writeTransaction.set(expenseRef, timestampForWrite(withoutId(expense as unknown as Record<string, unknown>), ["createdAt", "updatedAt"]));
    }
  };
}

async function prepareCreateCashMovement(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  createdById: string,
  operation: SyncPushOperation
): Promise<PreparedOrderOperation> {
  const input = cashMovementCreateSchema.parse(operation.payload);
  const now = new Date().toISOString();
  const movementId = operation.entityId;
  const movementRef = scopedDoc(restaurantId, "cashMovements", movementId);
  const movementSnapshot = await transaction.get(movementRef);

  if (movementSnapshot.exists) {
    throw new HttpError(409, "Cash movement id already exists without an idempotency record", {
      code: "cash_movement_id_exists"
    });
  }

  const serverVersion = Date.now();
  const movement: CashMovement = {
    id: movementId,
    restaurantId,
    cashRegisterId: input.cashRegisterId,
    type: input.type,
    amount: input.amount,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    note: input.note,
    createdById,
    createdAt: now
  };

  return {
    response: { id: movementId },
    serverVersion,
    changes: [upsertChange("cashMovement", movementId, movement as unknown as Record<string, unknown>)],
    write: (writeTransaction) => {
      writeTransaction.set(movementRef, timestampForWrite(withoutId(movement as unknown as Record<string, unknown>), ["createdAt"]));
    }
  };
}

async function prepareCreateOrder(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  orderId: string,
  input: OrderCreateInput,
  createdById: string
): Promise<PreparedOrderOperation> {
  const now = new Date().toISOString();
  const orderRef = scopedDoc(restaurantId, "orders", orderId);
  const restaurantRef = db.collection("restaurants").doc(restaurantId);
  const [orderSnapshot, restaurantSnapshot, items] = await Promise.all([
    transaction.get(orderRef),
    transaction.get(restaurantRef),
    hydrateOrderItems(transaction, restaurantId, input.items)
  ]);

  if (orderSnapshot.exists) {
    const existingOrder = snapshotData<Order>(orderSnapshot);
    const changes: ServiceChange[] = [upsertChange("order", orderId, existingOrder)];
    if (existingOrder.tableId) {
      const tableSnapshot = await transaction.get(scopedDoc(restaurantId, "tables", existingOrder.tableId));
      if (tableSnapshot.exists) changes.push(upsertChange("table", existingOrder.tableId, snapshotData<Table>(tableSnapshot)));
    }
    return { response: { id: orderId }, serverVersion: currentOrderVersion(existingOrder), changes, write: () => undefined };
  }

  if (!restaurantSnapshot.exists) {
    throw new HttpError(404, "Restaurant not found");
  }

  const restaurant = snapshotData<Restaurant>(restaurantSnapshot);
  const totals = calculateOrderTotals(items, input.discount, input.tax, input.serviceCharge);
  const orderedAt = input.orderedAt || now;
  const serverVersion = Date.now();
  let tableRef: FirebaseFirestore.DocumentReference | null = null;
  let nextTable: Record<string, unknown> | null = null;
  let tableName = "";

  if (input.tableId) {
    tableRef = scopedDoc(restaurantId, "tables", input.tableId);
    const tableSnapshot = await transaction.get(tableRef);
    if (!tableSnapshot.exists) {
      throw new HttpError(404, "Table not found");
    }
    const table = snapshotData<Table>(tableSnapshot);
    if (table.status === "DISABLED") {
      throw new HttpError(400, "Cannot start an order on a disabled table");
    }
    if (table.currentOrderId && table.currentOrderId !== orderId) {
      throw new HttpError(409, "Table already has an open order", { code: "table_occupied" });
    }
    tableName = String(table.name ?? "");
    nextTable = {
      ...table,
      status: "OCCUPIED",
      currentOrderId: orderId,
      updatedAt: now
    };
  }

  const orderData = {
    id: orderId,
    restaurantId,
    name: input.name || defaultOrderName(tableName, orderedAt),
    tableId: input.tableId,
    type: input.type,
    source: input.source,
    status: input.status,
    items,
    ...totals,
    paidAmount: 0,
    paymentStatus: "UNPAID" as const,
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    orderedAt,
    createdById,
    closedById: "",
    invoiceId: "",
    paymentId: "",
    inventoryDeductedAt: "",
    completedAt: "",
    cancelledAt: "",
    currency: restaurant.currency,
    version: serverVersion,
    createdAt: now,
    updatedAt: now
  };

  return {
    response: { id: orderId },
    serverVersion,
    changes: [
      upsertChange("order", orderId, orderData),
      ...(nextTable ? [upsertChange("table", input.tableId, nextTable)] : [])
    ],
    write: (writeTransaction) => {
      if (tableRef) {
        writeTransaction.update(tableRef, {
          status: "OCCUPIED",
          currentOrderId: orderId,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      writeTransaction.set(orderRef, {
        ...withoutId(orderData),
        version: serverVersion,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  };
}

async function prepareUpdateOrder(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  orderId: string,
  input: OrderPatchInput,
  baseVersion: number | undefined
): Promise<PreparedOrderOperation> {
  if (input.status === "COMPLETED") {
    throw new HttpError(400, "Use the complete endpoint to complete orders");
  }
  if (input.status === "CANCELLED") {
    throw new HttpError(400, "Use the cancel endpoint to cancel orders");
  }

  const now = new Date().toISOString();
  const orderRef = scopedDoc(restaurantId, "orders", orderId);
  const orderSnapshot = await transaction.get(orderRef);
  if (!orderSnapshot.exists) {
    throw new HttpError(404, "Order not found");
  }

  const order = snapshotData<Order>(orderSnapshot);
  const currentVersion = currentOrderVersion(order);
  assertOrderBaseVersion(orderId, baseVersion, currentVersion, order);
  const serverVersion = nextOrderVersion(currentVersion);
  const orderIsClosed = ["COMPLETED", "CANCELLED"].includes(order.status);
  const orderHasFinancialLink = Boolean(order.invoiceId || order.paymentId);
  const hasFinancialChanges =
    input.items !== undefined ||
    input.discount !== undefined ||
    input.tax !== undefined ||
    input.serviceCharge !== undefined ||
    input.paymentMethod !== undefined;
  const tableIsChanging = input.tableId !== undefined && input.tableId !== order.tableId;

  if (orderIsClosed && input.status && input.status !== order.status) {
    throw new HttpError(400, "Closed orders cannot be reopened through status updates");
  }
  if (hasFinancialChanges && (orderIsClosed || orderHasFinancialLink)) {
    throw new HttpError(400, "Completed or financially linked orders cannot be edited");
  }
  if (tableIsChanging && (orderIsClosed || orderHasFinancialLink)) {
    throw new HttpError(400, "Completed or financially linked orders cannot be moved");
  }

  const items = input.items ? await hydrateOrderItems(transaction, restaurantId, input.items) : null;
  const nextItems = items ?? order.items;
  const discount = input.discount ?? numberValue(order.discount);
  const tax = input.tax ?? numberValue(order.tax);
  const serviceCharge = input.serviceCharge ?? numberValue(order.serviceCharge);
  const totals = hasFinancialChanges ? calculateOrderTotals(nextItems, discount, tax, serviceCharge) : {};
  const nextTableId = input.tableId ?? order.tableId ?? "";
  let previousTableRef: FirebaseFirestore.DocumentReference | null = null;
  let nextTableRef: FirebaseFirestore.DocumentReference | null = null;
  let releasedTable: Record<string, unknown> | null = null;
  let occupiedTable: Record<string, unknown> | null = null;

  if (tableIsChanging) {
    previousTableRef = order.tableId ? scopedDoc(restaurantId, "tables", order.tableId) : null;
    nextTableRef = nextTableId ? scopedDoc(restaurantId, "tables", nextTableId) : null;
    const [previousTableSnapshot, nextTableSnapshot] = await Promise.all([
      previousTableRef ? transaction.get(previousTableRef) : Promise.resolve(null),
      nextTableRef ? transaction.get(nextTableRef) : Promise.resolve(null)
    ]);

    if (nextTableRef && !nextTableSnapshot?.exists) {
      throw new HttpError(404, "Table not found");
    }
    if (nextTableSnapshot?.exists) {
      const targetTable = snapshotData<Table>(nextTableSnapshot);
      if (targetTable.status === "DISABLED") {
        throw new HttpError(400, "Cannot move an order to a disabled table");
      }
      if (targetTable.currentOrderId && targetTable.currentOrderId !== orderId) {
        throw new HttpError(409, "Target table already has an open order", { code: "table_occupied" });
      }
      occupiedTable = {
        ...targetTable,
        status: "OCCUPIED",
        currentOrderId: orderId,
        updatedAt: now
      };
    }

    if (previousTableSnapshot?.exists && (previousTableSnapshot.data() as Table).currentOrderId === orderId) {
      releasedTable = {
        ...snapshotData<Table>(previousTableSnapshot),
        status: "AVAILABLE",
        currentOrderId: "",
        updatedAt: now
      };
    }
  }

  const orderUpdate = cleanUndefined({
    ...input,
    ...(items ? { items } : {}),
    ...totals,
    restaurantId,
    version: serverVersion,
    updatedAt: now
  });
  const nextOrder = {
    ...order,
    ...orderUpdate
  };
  const changes: ServiceChange[] = [upsertChange("order", orderId, nextOrder)];
  if (releasedTable && order.tableId) changes.push(upsertChange("table", order.tableId, releasedTable));
  if (occupiedTable && nextTableId) changes.push(upsertChange("table", nextTableId, occupiedTable));

  return {
    response: { id: orderId, ok: true },
    serverVersion,
    changes,
    write: (writeTransaction) => {
      if (previousTableRef && releasedTable) {
        writeTransaction.update(previousTableRef, {
          status: "AVAILABLE",
          currentOrderId: "",
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      if (nextTableRef && occupiedTable) {
        writeTransaction.update(nextTableRef, {
          status: "OCCUPIED",
          currentOrderId: orderId,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      writeTransaction.update(orderRef, {
        ...cleanUndefined({
          ...input,
          ...(items ? { items } : {}),
          ...totals,
          restaurantId,
          version: serverVersion
        }),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  };
}

async function prepareCompleteOrder(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  orderId: string,
  input: CompleteOrderInput,
  createdById: string,
  baseVersion: number | undefined
): Promise<PreparedOrderOperation> {
  const now = new Date().toISOString();
  const orderRef = scopedDoc(restaurantId, "orders", orderId);
  const invoiceRef = scopedDoc(restaurantId, "invoices", `order_${orderId}`);
  const paymentRef = scopedDoc(restaurantId, "payments", `order_${orderId}`);
  const cashMovementRef = scopedDoc(restaurantId, "cashMovements", `order_${orderId}`);
  const journalEntryRef = scopedDoc(restaurantId, "journalEntries", `order_${orderId}`);
  const orderSnapshot = await transaction.get(orderRef);
  if (!orderSnapshot.exists) {
    throw new HttpError(404, "Order not found");
  }

  const order = snapshotData<Order>(orderSnapshot);
  const currentVersion = currentOrderVersion(order);
  assertOrderBaseVersion(orderId, baseVersion, currentVersion, order);
  const serverVersion = nextOrderVersion(currentVersion);
  if (order.status === "CANCELLED") {
    throw new HttpError(400, "Cancelled orders cannot be completed");
  }

  const response = {
    orderId,
    invoiceId: invoiceRef.id,
    paymentId: paymentRef.id
  };

  if (order.invoiceId) {
    const changes = await existingOrderChanges(transaction, restaurantId, order);
    return { response, serverVersion: currentVersion, changes, write: () => undefined };
  }

  if (input.paymentMethod === "SPLIT" && (input.paidAmount === undefined || input.paidAmount <= 0)) {
    throw new HttpError(400, "Split payments require a paid amount");
  }

  const paidAmount = input.paymentMethod === "DEBT" ? 0 : input.paidAmount ?? order.total;
  if (paidAmount > order.total) {
    throw new HttpError(400, "Paid amount cannot exceed order total");
  }

  const cashRegisterRef = input.cashRegisterId && paidAmount > 0 ? scopedDoc(restaurantId, "cashRegisters", input.cashRegisterId) : null;
  const cashRegisterSnapshot = cashRegisterRef ? await transaction.get(cashRegisterRef) : null;
  if (cashRegisterRef && !cashRegisterSnapshot?.exists) {
    throw new HttpError(404, "Cash register not found", { code: "cash_register_missing" });
  }

  const inventoryDeductions = await prepareInventoryDeductions(transaction, restaurantId, order, createdById, now);
  const tableRef = order.tableId ? scopedDoc(restaurantId, "tables", order.tableId) : null;
  const tableSnapshot = tableRef ? await transaction.get(tableRef) : null;
  const remainingAmount = Math.max(order.total - paidAmount, 0);
  const invoiceStatus: Invoice["status"] = remainingAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";
  const paymentStatus: Order["paymentStatus"] = remainingAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";
  const invoice = orderInvoice(invoiceRef.id, restaurantId, order, input, paidAmount, remainingAmount, invoiceStatus, createdById, now);
  const payment = paidAmount > 0 ? orderPayment(paymentRef.id, restaurantId, orderId, invoiceRef.id, input, paidAmount, createdById, now) : null;
  const cashMovement = paidAmount > 0 ? orderCashMovement(cashMovementRef.id, restaurantId, paymentRef.id, input, paidAmount, createdById, now) : null;
  const journalEntry = orderJournalEntry(journalEntryRef.id, restaurantId, orderId, paidAmount, remainingAmount, order.total, createdById, now);
  const nextOrder = {
    ...order,
    status: "COMPLETED" as const,
    paidAmount,
    paymentStatus,
    paymentMethod: input.paymentMethod,
    invoiceId: invoiceRef.id,
    paymentId: paidAmount > 0 ? paymentRef.id : "",
    inventoryDeductedAt: now,
    completedAt: now,
    closedById: createdById,
    version: serverVersion,
    updatedAt: now
  };
  const nextTable = tableSnapshot?.exists ? {
    ...snapshotData<Table>(tableSnapshot),
    status: "AVAILABLE",
    currentOrderId: "",
    updatedAt: now
  } : null;
  const nextCashRegister = cashRegisterSnapshot?.exists ? {
    ...snapshotData<CashRegister>(cashRegisterSnapshot),
    currentBalance: numberValue((cashRegisterSnapshot.data() as CashRegister).currentBalance) + paidAmount,
    updatedAt: now
  } : null;
  const changes: ServiceChange[] = [
    upsertChange("order", orderId, nextOrder),
    upsertChange("invoice", invoiceRef.id, invoice),
    ...(payment ? [upsertChange("payment", paymentRef.id, payment)] : []),
    ...(cashMovement ? [upsertChange("cashMovement", cashMovementRef.id, cashMovement)] : []),
    upsertChange("journalEntry", journalEntryRef.id, journalEntry),
    ...(nextTable && order.tableId ? [upsertChange("table", order.tableId, nextTable)] : []),
    ...(nextCashRegister && input.cashRegisterId ? [upsertChange("cashRegister", input.cashRegisterId, nextCashRegister)] : []),
    ...inventoryDeductions.changes
  ];

  return {
    response,
    serverVersion,
    changes,
    write: (writeTransaction) => {
      inventoryDeductions.write(writeTransaction);
      writeTransaction.set(invoiceRef, timestampForWrite(withoutId(invoice), ["createdAt", "updatedAt"]));
      if (payment) writeTransaction.set(paymentRef, timestampForWrite(withoutId(payment), ["createdAt"]));
      if (cashMovement) writeTransaction.set(cashMovementRef, timestampForWrite(withoutId(cashMovement), ["createdAt"]));
      if (cashRegisterRef && paidAmount > 0) {
        writeTransaction.update(cashRegisterRef, {
          currentBalance: FieldValue.increment(paidAmount),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      writeTransaction.set(journalEntryRef, timestampForWrite(withoutId(journalEntry), ["createdAt", "updatedAt"]));
      writeTransaction.update(orderRef, {
        status: "COMPLETED",
        paidAmount,
        paymentStatus,
        paymentMethod: input.paymentMethod,
        invoiceId: invoiceRef.id,
        paymentId: paidAmount > 0 ? paymentRef.id : "",
        inventoryDeductedAt: now,
        completedAt: now,
        closedById: createdById,
        version: serverVersion,
        updatedAt: FieldValue.serverTimestamp()
      });
      if (tableRef && nextTable) {
        writeTransaction.update(tableRef, {
          status: "AVAILABLE",
          currentOrderId: "",
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    }
  };
}

async function prepareCancelOrder(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  orderId: string,
  createdById: string,
  reason: string,
  baseVersion: number | undefined
): Promise<PreparedOrderOperation> {
  const now = new Date().toISOString();
  const orderRef = scopedDoc(restaurantId, "orders", orderId);
  const orderSnapshot = await transaction.get(orderRef);
  if (!orderSnapshot.exists) {
    throw new HttpError(404, "Order not found");
  }

  const order = snapshotData<Order>(orderSnapshot);
  const currentVersion = currentOrderVersion(order);
  assertOrderBaseVersion(orderId, baseVersion, currentVersion, order);
  const serverVersion = nextOrderVersion(currentVersion);
  if (order.status === "CANCELLED") {
    const changes = await existingOrderChanges(transaction, restaurantId, order);
    return { response: { ok: true }, serverVersion: currentVersion, changes, write: () => undefined };
  }

  const refundInvoiceRef = scopedDoc(restaurantId, "invoices", `refund_order_${orderId}`);
  const reverseJournalRef = scopedDoc(restaurantId, "journalEntries", `reverse_order_${orderId}`);
  const originalCashMovementRef = scopedDoc(restaurantId, "cashMovements", `order_${orderId}`);
  const reverseCashMovementRef = scopedDoc(restaurantId, "cashMovements", `cancel_order_${orderId}`);
  const invoiceRef = order.invoiceId ? scopedDoc(restaurantId, "invoices", order.invoiceId) : null;
  const [invoiceSnapshot, originalCashMovementSnapshot] = await Promise.all([
    invoiceRef ? transaction.get(invoiceRef) : Promise.resolve(null),
    transaction.get(originalCashMovementRef)
  ]);
  const originalCashMovement = originalCashMovementSnapshot.exists ? snapshotData<CashMovement>(originalCashMovementSnapshot) : null;
  const cashRegisterRef = originalCashMovement?.cashRegisterId ? scopedDoc(restaurantId, "cashRegisters", originalCashMovement.cashRegisterId) : null;
  const cashRegisterSnapshot = cashRegisterRef ? await transaction.get(cashRegisterRef) : null;
  const inventoryRestorations = order.inventoryDeductedAt
    ? await prepareInventoryRestorations(transaction, restaurantId, order, createdById, reason, now)
    : emptyInventoryMutation();
  const tableRef = order.tableId ? scopedDoc(restaurantId, "tables", order.tableId) : null;
  const tableSnapshot = tableRef ? await transaction.get(tableRef) : null;
  const nextOrder = {
    ...order,
    status: "CANCELLED" as const,
    cancelledAt: now,
    notes: appendNote(order.notes, `Cancelled: ${reason}`),
    version: serverVersion,
    updatedAt: now
  };
  const changes: ServiceChange[] = [upsertChange("order", orderId, nextOrder), ...inventoryRestorations.changes];
  const voidedInvoice = invoiceSnapshot?.exists ? {
    ...snapshotData<Invoice>(invoiceSnapshot),
    status: "VOID" as const,
    notes: appendNote(String((invoiceSnapshot.data() as Invoice).notes ?? ""), `Cancelled order: ${reason}`),
    updatedAt: now
  } : null;
  if (voidedInvoice && order.invoiceId) changes.push(upsertChange("invoice", order.invoiceId, voidedInvoice));

  const refundInvoice = order.invoiceId ? refundInvoiceData(refundInvoiceRef.id, restaurantId, order, reason, createdById, now) : null;
  if (refundInvoice) changes.push(upsertChange("invoice", refundInvoiceRef.id, refundInvoice));

  const reverseJournal = order.invoiceId
    ? reverseJournalData(reverseJournalRef.id, restaurantId, order, reason, createdById, now)
    : null;
  if (reverseJournal) changes.push(upsertChange("journalEntry", reverseJournalRef.id, reverseJournal));

  const reverseCashMovement = originalCashMovement && numberValue(originalCashMovement.amount) > 0
    ? reverseCashMovementData(reverseCashMovementRef.id, restaurantId, originalCashMovement, orderId, reason, createdById, now)
    : null;
  if (reverseCashMovement) changes.push(upsertChange("cashMovement", reverseCashMovementRef.id, reverseCashMovement));

  const nextCashRegister = originalCashMovement && cashRegisterSnapshot?.exists && numberValue(originalCashMovement.amount) > 0
    ? {
        ...snapshotData<CashRegister>(cashRegisterSnapshot),
        currentBalance: numberValue((cashRegisterSnapshot.data() as CashRegister).currentBalance) - numberValue(originalCashMovement.amount),
        updatedAt: now
      }
    : null;
  if (nextCashRegister && originalCashMovement?.cashRegisterId) {
    changes.push(upsertChange("cashRegister", originalCashMovement.cashRegisterId, nextCashRegister));
  }

  const nextTable = tableSnapshot?.exists ? {
    ...snapshotData<Table>(tableSnapshot),
    status: "AVAILABLE",
    currentOrderId: "",
    updatedAt: now
  } : null;
  if (nextTable && order.tableId) changes.push(upsertChange("table", order.tableId, nextTable));

  return {
    response: { ok: true },
    serverVersion,
    changes,
    write: (writeTransaction) => {
      inventoryRestorations.write(writeTransaction);
      if (invoiceRef && voidedInvoice) {
        writeTransaction.update(invoiceRef, {
          status: "VOID",
          notes: voidedInvoice.notes,
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      if (refundInvoice) writeTransaction.set(refundInvoiceRef, timestampForWrite(withoutId(refundInvoice), ["createdAt", "updatedAt"]));
      if (reverseJournal) writeTransaction.set(reverseJournalRef, timestampForWrite(withoutId(reverseJournal), ["createdAt", "updatedAt"]));
      if (reverseCashMovement) writeTransaction.set(reverseCashMovementRef, timestampForWrite(withoutId(reverseCashMovement), ["createdAt"]));
      if (cashRegisterRef && reverseCashMovement) {
        writeTransaction.update(cashRegisterRef, {
          currentBalance: FieldValue.increment(-numberValue(originalCashMovement?.amount)),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      writeTransaction.update(orderRef, {
        status: "CANCELLED",
        cancelledAt: now,
        notes: nextOrder.notes,
        version: serverVersion,
        updatedAt: FieldValue.serverTimestamp()
      });
      if (tableRef && nextTable) {
        writeTransaction.update(tableRef, {
          status: "AVAILABLE",
          currentOrderId: "",
          updatedAt: FieldValue.serverTimestamp()
        });
      }
    }
  };
}

async function applyTableOperation(restaurantId: string, user: AuthUser, deviceId: string, operation: SyncPushOperation): Promise<SyncPushResult> {
  const opRef = operationRef(restaurantId, operation.operationId);
  const tableRef = db.collection("restaurants").doc(restaurantId).collection("tables").doc(operation.entityId);
  const hash = payloadHash(operation);

  return db.runTransaction(async (transaction) => {
    const [operationSnapshot, tableSnapshot] = await Promise.all([
      transaction.get(opRef),
      transaction.get(tableRef)
    ]);

    if (operationSnapshot.exists) {
      const existing = operationSnapshot.data() ?? {};
      assertSamePayload(operation, existing.payloadHash);
      return duplicateResult(operation, existing);
    }

    const current = tableSnapshot.exists ? ({ id: tableSnapshot.id, ...tableSnapshot.data() } as Table & { version?: number; deletedAt?: string }) : null;
    if (operation.action === "delete") {
      if (!current) {
        return persistOperationResult(transaction, restaurantId, opRef, operation, hash, deviceId, user, {
          operationId: operation.operationId,
          status: "applied",
          entityType: operation.entityType,
          entityId: operation.entityId,
          serverVersion: 0,
          response: { ok: true }
        }, "delete");
      }
      if (current.currentOrderId) {
        return conflict(operation, "table_has_open_order", "Cannot delete a table with an open order");
      }
    }

    if ((operation.action === "update" || operation.action === "delete") && !current) {
      return conflict(operation, "missing_entity", "Table no longer exists on the server");
    }

    const serverVersion = Number(current?.version ?? 0);
    if (operation.baseVersion !== undefined && serverVersion > 0 && operation.baseVersion !== serverVersion) {
      return conflict(operation, "version_conflict", "Table changed on the server before this operation synced");
    }

    const nextVersion = Date.now();
    if (operation.action === "delete") {
      const result = await persistOperationResult(transaction, restaurantId, opRef, operation, hash, deviceId, user, {
        operationId: operation.operationId,
        status: "applied",
        entityType: operation.entityType,
        entityId: operation.entityId,
        serverVersion: nextVersion,
        response: { ok: true }
      }, "delete", nextVersion);

      transaction.set(tableRef, {
        restaurantId,
        deletedAt: new Date().toISOString(),
        version: nextVersion,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return result;
    }

    const payload = tableSyncPayloadSchema.parse(operation.payload);
    const tableData = {
      ...payload,
      restaurantId,
      deletedAt: "",
      version: nextVersion,
      updatedAt: FieldValue.serverTimestamp(),
      ...(operation.action === "create" || !current ? { createdAt: FieldValue.serverTimestamp() } : {})
    };
    const result = await persistOperationResult(transaction, restaurantId, opRef, operation, hash, deviceId, user, {
      operationId: operation.operationId,
      status: "applied",
      entityType: operation.entityType,
      entityId: operation.entityId,
      serverVersion: nextVersion,
      response: { id: operation.entityId, ok: true }
    }, "upsert", nextVersion, {
      id: operation.entityId,
      ...payload,
      restaurantId,
      deletedAt: "",
      version: nextVersion,
      updatedAt: new Date().toISOString(),
      createdAt: current?.createdAt ?? new Date().toISOString()
    });
    transaction.set(tableRef, tableData, { merge: true });

    return result;
  });
}

async function persistOperationResult(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  opRef: FirebaseFirestore.DocumentReference,
  operation: SyncPushOperation,
  hash: string,
  deviceId: string,
  user: AuthUser,
  result: SyncPushResult,
  changeAction: "upsert" | "delete",
  version = result.serverVersion ?? 0,
  data?: Record<string, unknown>
) {
  const cursor = await recordChange(transaction, restaurantId, {
    entityType: operation.entityType,
    entityId: operation.entityId,
    action: changeAction,
    version,
    data
  });
  const resultWithCursor = { ...result, serverCursor: cursor };

  transaction.set(opRef, {
    operationId: operation.operationId,
    payloadHash: hash,
    entityType: operation.entityType,
    entityId: operation.entityId,
    status: "applied",
    response: resultWithCursor.response ?? {},
    serverVersion: version,
    serverCursor: cursor,
    deviceId,
    userId: user.id ?? user.email,
    createdAt: FieldValue.serverTimestamp()
  });

  return resultWithCursor;
}

type OrderCreateInput = z.infer<typeof orderCreateSchema>;
type OrderPatchInput = z.infer<typeof orderPatchSchema>;
type CompleteOrderInput = z.infer<typeof completeOrderSchema>;

type ScopedCollectionName =
  | "tables"
  | "orders"
  | "items"
  | "inventoryItems"
  | "inventoryTransactions"
  | "recipeIngredients"
  | "invoices"
  | "payments"
  | "expenses"
  | "cashRegisters"
  | "cashMovements"
  | "journalEntries";

type PreparedOrderOperation = {
  response: Record<string, unknown>;
  serverVersion: number;
  changes: ServiceChange[];
  write: (transaction: FirebaseFirestore.Transaction) => void;
};

type ServiceChange = {
  entityType: SyncEntityType;
  entityId: string;
  action?: "upsert" | "delete";
  data?: Record<string, unknown>;
};

type InventoryMutation = {
  changes: ServiceChange[];
  write: (transaction: FirebaseFirestore.Transaction) => void;
};

function globalOperationRef(operationId: string) {
  return db.collection("syncOperations").doc(operationId);
}

function scopedCollection(restaurantId: string, collectionName: ScopedCollectionName) {
  return db.collection("restaurants").doc(restaurantId).collection(collectionName);
}

function scopedDoc(restaurantId: string, collectionName: ScopedCollectionName, id: string) {
  return scopedCollection(restaurantId, collectionName).doc(id);
}

function snapshotData<T extends Record<string, unknown>>(snapshot: FirebaseFirestore.DocumentSnapshot): T & { id: string } {
  return { id: snapshot.id, ...(snapshot.data() as T) };
}

function upsertChange(entityType: SyncEntityType, entityId: string, data: Record<string, unknown>): ServiceChange {
  return {
    entityType,
    entityId,
    data: { ...data, id: entityId }
  };
}

function assertOrderBaseVersion(orderId: string, baseVersion: number | undefined, currentVersion: number, order: Record<string, unknown>) {
  const conflictCode = orderVersionConflict(baseVersion, currentVersion);
  if (conflictCode === "missing_base_version") {
    throw new HttpError(409, "Order update is missing a base version", {
      code: "missing_base_version",
      response: conflictResponse(orderId, currentVersion, order)
    });
  }

  if (conflictCode === "version_conflict") {
    throw new HttpError(409, "Order changed on the server before this operation synced", {
      code: "version_conflict",
      response: conflictResponse(orderId, currentVersion, order)
    });
  }
}

function conflictResponse(orderId: string, serverVersion: number, order: Record<string, unknown>) {
  return {
    id: orderId,
    serverVersion,
    serverOrder: {
      ...order,
      id: orderId,
      version: serverVersion
    }
  };
}

async function existingOrderChanges(transaction: FirebaseFirestore.Transaction, restaurantId: string, order: Order) {
  const changes: ServiceChange[] = [upsertChange("order", order.id, order as unknown as Record<string, unknown>)];
  if (order.tableId) {
    const tableSnapshot = await transaction.get(scopedDoc(restaurantId, "tables", order.tableId));
    if (tableSnapshot.exists) changes.push(upsertChange("table", order.tableId, snapshotData<Table>(tableSnapshot)));
  }
  if (order.invoiceId) {
    const invoiceSnapshot = await transaction.get(scopedDoc(restaurantId, "invoices", order.invoiceId));
    if (invoiceSnapshot.exists) changes.push(upsertChange("invoice", order.invoiceId, snapshotData<Invoice>(invoiceSnapshot)));
  }
  if (order.paymentId) {
    const paymentSnapshot = await transaction.get(scopedDoc(restaurantId, "payments", order.paymentId));
    if (paymentSnapshot.exists) changes.push(upsertChange("payment", order.paymentId, snapshotData<OperationalPayment>(paymentSnapshot)));
  }
  const [cashMovementSnapshot, journalEntrySnapshot] = await Promise.all([
    transaction.get(scopedDoc(restaurantId, "cashMovements", `order_${order.id}`)),
    transaction.get(scopedDoc(restaurantId, "journalEntries", `order_${order.id}`))
  ]);
  if (cashMovementSnapshot.exists) changes.push(upsertChange("cashMovement", cashMovementSnapshot.id, snapshotData<CashMovement>(cashMovementSnapshot)));
  if (journalEntrySnapshot.exists) changes.push(upsertChange("journalEntry", journalEntrySnapshot.id, snapshotData<JournalEntry>(journalEntrySnapshot)));
  return changes;
}

async function hydrateOrderItems(transaction: FirebaseFirestore.Transaction, restaurantId: string, lines: OrderCreateInput["items"]) {
  const snapshots = await Promise.all(
    lines.map((line) => transaction.get(scopedDoc(restaurantId, "items", line.menuItemId)))
  );

  return lines.map((line, index): OrderLine => {
    const itemSnapshot = snapshots[index];
    if (!itemSnapshot.exists) {
      throw new HttpError(404, `Menu item not found: ${line.menuItemId}`);
    }

    const menuItem = itemSnapshot.data() as MenuItem;
    const quantity = numberValue(line.quantity);
    const unitPrice = numberValue(menuItem.price);
    return {
      menuItemId: line.menuItemId,
      name: menuItem.name,
      quantity,
      unitPrice,
      notes: line.notes,
      modifiers: line.modifiers,
      total: quantity * unitPrice
    };
  });
}

async function prepareInventoryDeductions(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  order: Order,
  createdById: string,
  now: string
): Promise<InventoryMutation> {
  if (order.inventoryDeductedAt) return emptyInventoryMutation();
  const deductions = await inventoryQuantitiesForOrder(transaction, restaurantId, order);
  const itemReads = await readInventoryItems(transaction, restaurantId, deductions);
  const changes: ServiceChange[] = [];
  const writes: Array<(transaction: FirebaseFirestore.Transaction) => void> = [];

  for (const { inventoryItemId, quantity, itemRef, item } of itemReads) {
    const balanceAfter = numberValue(item.currentQuantity) - quantity;
    const nextItem = {
      ...item,
      currentQuantity: balanceAfter,
      updatedAt: now
    };
    const inventoryTransaction = inventoryTransactionData(
      `order_${order.id}_${inventoryItemId}`,
      restaurantId,
      inventoryItemId,
      "OUT",
      quantity,
      balanceAfter,
      "ORDER",
      order.id,
      "Order completion",
      createdById,
      now
    );
    changes.push(
      upsertChange("inventoryItem", inventoryItemId, nextItem),
      upsertChange("inventoryTransaction", inventoryTransaction.id, inventoryTransaction)
    );
    writes.push((writeTransaction) => {
      writeTransaction.update(itemRef, {
        currentQuantity: balanceAfter,
        updatedAt: FieldValue.serverTimestamp()
      });
      writeTransaction.set(
        scopedDoc(restaurantId, "inventoryTransactions", inventoryTransaction.id),
        timestampForWrite(withoutId(inventoryTransaction), ["createdAt"])
      );
    });
  }

  return {
    changes,
    write: (writeTransaction) => writes.forEach((write) => write(writeTransaction))
  };
}

async function prepareInventoryRestorations(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  order: Order,
  createdById: string,
  reason: string,
  now: string
): Promise<InventoryMutation> {
  const restorations = await inventoryQuantitiesForOrder(transaction, restaurantId, order);
  const itemReads = await readInventoryItems(transaction, restaurantId, restorations, true);
  const changes: ServiceChange[] = [];
  const writes: Array<(transaction: FirebaseFirestore.Transaction) => void> = [];

  for (const { inventoryItemId, quantity, itemRef, item } of itemReads) {
    const balanceAfter = numberValue(item.currentQuantity) + quantity;
    const nextItem = {
      ...item,
      currentQuantity: balanceAfter,
      updatedAt: now
    };
    const inventoryTransaction = inventoryTransactionData(
      `cancel_${order.id}_${inventoryItemId}`,
      restaurantId,
      inventoryItemId,
      "REVERSE",
      quantity,
      balanceAfter,
      "ORDER_CANCEL",
      order.id,
      reason,
      createdById,
      now
    );
    changes.push(
      upsertChange("inventoryItem", inventoryItemId, nextItem),
      upsertChange("inventoryTransaction", inventoryTransaction.id, inventoryTransaction)
    );
    writes.push((writeTransaction) => {
      writeTransaction.update(itemRef, {
        currentQuantity: balanceAfter,
        updatedAt: FieldValue.serverTimestamp()
      });
      writeTransaction.set(
        scopedDoc(restaurantId, "inventoryTransactions", inventoryTransaction.id),
        timestampForWrite(withoutId(inventoryTransaction), ["createdAt"])
      );
    });
  }

  return {
    changes,
    write: (writeTransaction) => writes.forEach((write) => write(writeTransaction))
  };
}

function emptyInventoryMutation(): InventoryMutation {
  return { changes: [], write: () => undefined };
}

async function inventoryQuantitiesForOrder(transaction: FirebaseFirestore.Transaction, restaurantId: string, order: Order) {
  const recipeSnapshot = await transaction.get(scopedCollection(restaurantId, "recipeIngredients"));
  const recipeIngredients = recipeSnapshot.docs.map((doc) => doc.data() as RecipeIngredient);
  const quantities = new Map<string, number>();

  for (const line of order.items) {
    for (const ingredient of recipeIngredients.filter((item) => item.menuItemId === line.menuItemId)) {
      quantities.set(ingredient.inventoryItemId, (quantities.get(ingredient.inventoryItemId) ?? 0) + ingredient.quantity * line.quantity);
    }
  }

  return quantities;
}

async function readInventoryItems(
  transaction: FirebaseFirestore.Transaction,
  restaurantId: string,
  quantities: Map<string, number>,
  skipMissing = false
) {
  const reads = await Promise.all(
    [...quantities.entries()].map(async ([inventoryItemId, quantity]) => {
      const itemRef = scopedDoc(restaurantId, "inventoryItems", inventoryItemId);
      const itemSnapshot = await transaction.get(itemRef);
      return { inventoryItemId, quantity, itemRef, itemSnapshot };
    })
  );

  return reads.flatMap(({ inventoryItemId, quantity, itemRef, itemSnapshot }) => {
    if (!itemSnapshot.exists) {
      if (skipMissing) return [];
      throw new HttpError(404, `Inventory item not found: ${inventoryItemId}`);
    }
    return [{ inventoryItemId, quantity, itemRef, item: snapshotData<InventoryItem>(itemSnapshot) }];
  });
}

function orderInvoice(
  id: string,
  restaurantId: string,
  order: Order,
  input: CompleteOrderInput,
  paidAmount: number,
  remainingAmount: number,
  status: Invoice["status"],
  createdById: string,
  now: string
) {
  return {
    id,
    restaurantId,
    type: "SALE" as const,
    status,
    orderId: order.id,
    supplierId: "",
    items: order.items.map((item) => ({
      itemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total
    })),
    subTotal: order.subTotal,
    discount: order.discount,
    tax: order.tax,
    serviceCharge: order.serviceCharge,
    total: order.total,
    paidAmount,
    remainingAmount,
    paymentMethod: input.paymentMethod,
    dueDate: "",
    notes: input.note,
    createdById,
    createdAt: now,
    updatedAt: now
  };
}

function orderPayment(
  id: string,
  restaurantId: string,
  orderId: string,
  invoiceId: string,
  input: CompleteOrderInput,
  paidAmount: number,
  createdById: string,
  now: string
) {
  return {
    id,
    restaurantId,
    invoiceId,
    orderId,
    supplierId: "",
    type: "SALE" as const,
    amount: paidAmount,
    method: input.paymentMethod,
    note: input.note,
    createdById,
    paidAt: now,
    createdAt: now
  };
}

function orderCashMovement(
  id: string,
  restaurantId: string,
  paymentId: string,
  input: CompleteOrderInput,
  paidAmount: number,
  createdById: string,
  now: string
) {
  return {
    id,
    restaurantId,
    cashRegisterId: input.cashRegisterId ?? "",
    type: "IN" as const,
    amount: paidAmount,
    referenceType: "PAYMENT",
    referenceId: paymentId,
    note: input.note,
    createdById,
    createdAt: now
  };
}

function orderJournalEntry(
  id: string,
  restaurantId: string,
  orderId: string,
  paidAmount: number,
  remainingAmount: number,
  total: number,
  createdById: string,
  now: string
) {
  return {
    id,
    restaurantId,
    status: "POSTED" as const,
    referenceType: "ORDER",
    referenceId: orderId,
    lines: buildSaleJournalLines(paidAmount, remainingAmount, total),
    memo: `Order ${orderId}`,
    createdById,
    postedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function refundInvoiceData(id: string, restaurantId: string, order: Order, reason: string, createdById: string, now: string) {
  return {
    id,
    restaurantId,
    type: "REFUND" as const,
    status: "PAID" as const,
    orderId: order.id,
    supplierId: "",
    items: order.items.map((item) => ({
      itemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total
    })),
    subTotal: order.subTotal,
    discount: order.discount,
    tax: order.tax,
    serviceCharge: order.serviceCharge,
    total: order.total,
    paidAmount: order.paidAmount,
    remainingAmount: 0,
    paymentMethod: order.paymentMethod,
    dueDate: "",
    notes: reason,
    createdById,
    createdAt: now,
    updatedAt: now
  };
}

function reverseJournalData(id: string, restaurantId: string, order: Order, reason: string, createdById: string, now: string) {
  return {
    id,
    restaurantId,
    status: "POSTED" as const,
    referenceType: "ORDER_CANCEL",
    referenceId: order.id,
    lines: buildReverseSaleJournalLines(order.paidAmount, Math.max(order.total - order.paidAmount, 0), order.total),
    memo: `Cancel order ${order.id}: ${reason}`,
    createdById,
    postedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function reverseCashMovementData(
  id: string,
  restaurantId: string,
  originalCashMovement: CashMovement,
  orderId: string,
  reason: string,
  createdById: string,
  now: string
) {
  return {
    id,
    restaurantId,
    cashRegisterId: originalCashMovement.cashRegisterId,
    type: "OUT" as const,
    amount: numberValue(originalCashMovement.amount),
    referenceType: "ORDER_CANCEL",
    referenceId: orderId,
    note: reason,
    createdById,
    createdAt: now
  };
}

function inventoryTransactionData(
  id: string,
  restaurantId: string,
  inventoryItemId: string,
  type: InventoryTransaction["type"],
  quantity: number,
  balanceAfter: number,
  referenceType: string,
  referenceId: string,
  reason: string,
  createdById: string,
  now: string
) {
  return {
    id,
    restaurantId,
    inventoryItemId,
    type,
    quantity,
    balanceAfter,
    referenceType,
    referenceId,
    reason,
    createdById,
    createdAt: now
  };
}

function calculateOrderTotals(items: OrderLine[], discount: number, tax: number, serviceCharge: number) {
  const subTotal = items.reduce((sum, item) => sum + item.total, 0);
  if (discount > subTotal) {
    throw new HttpError(400, "Discount cannot exceed subtotal");
  }

  return {
    subTotal,
    discount,
    tax,
    serviceCharge,
    total: Math.max(subTotal - discount + tax + serviceCharge, 0)
  };
}

function buildSaleJournalLines(paidAmount: number, remainingAmount: number, total: number): JournalEntryLine[] {
  const lines: JournalEntryLine[] = [];
  if (paidAmount > 0) {
    lines.push({ accountId: "cash", debit: paidAmount, credit: 0, memo: "Payment received" });
  }
  if (remainingAmount > 0) {
    lines.push({ accountId: "accounts_receivable", debit: remainingAmount, credit: 0, memo: "Receivable" });
  }
  lines.push({ accountId: "sales", debit: 0, credit: total, memo: "Sales revenue" });
  assertBalancedJournal(lines);
  return lines;
}

function buildReverseSaleJournalLines(paidAmount: number, remainingAmount: number, total: number): JournalEntryLine[] {
  const lines: JournalEntryLine[] = [{ accountId: "sales", debit: total, credit: 0, memo: "Reverse sales revenue" }];
  if (paidAmount > 0) {
    lines.push({ accountId: "cash", debit: 0, credit: paidAmount, memo: "Reverse payment received" });
  }
  if (remainingAmount > 0) {
    lines.push({ accountId: "accounts_receivable", debit: 0, credit: remainingAmount, memo: "Reverse receivable" });
  }
  assertBalancedJournal(lines);
  return lines;
}

function assertBalancedJournal(lines: JournalEntryLine[]) {
  const totalDebit = lines.reduce((sum, line) => sum + numberValue(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + numberValue(line.credit), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    throw new HttpError(400, "Journal entry is not balanced");
  }
}

function timestampForWrite<T extends Record<string, unknown>>(data: T, fields: string[]) {
  const next = { ...data };
  for (const field of fields) {
    next[field as keyof T] = FieldValue.serverTimestamp() as T[keyof T];
  }
  return next;
}

function cleanUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function withoutId<T extends Record<string, unknown>>(input: T) {
  const { id: _id, ...rest } = input;
  return rest;
}

function defaultOrderName(tableName: string, orderedAt: string) {
  const parsed = new Date(orderedAt);
  const time = Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(11, 16)
    : `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
  return `${tableName || "طلب"} - ${time}`;
}

function appendNote(current: string | undefined, note: string) {
  return [current, note].filter(Boolean).join("\n");
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertOrderPermission(user: AuthUser, action: SyncPushOperation["action"]) {
  if (action === "create") {
    assertPermissionForSync(user, "orders.create");
    return;
  }
  if (action === "completeOrder") {
    assertPermissionForSync(user, "payments.create");
    return;
  }
  if (action === "cancelOrder") {
    assertPermissionForSync(user, "orders.cancel");
    return;
  }
  assertPermissionForSync(user, "orders.update");
}

function conflict(operation: SyncPushOperation, code: string, message: string): SyncPushResult {
  return {
    operationId: operation.operationId,
    status: "conflict",
    entityType: operation.entityType,
    entityId: operation.entityId,
    error: {
      code,
      message,
      retryable: false
    }
  };
}

function errorResult(operation: SyncPushOperation, error: unknown): SyncPushResult {
  if (error instanceof ZodError) {
    return {
      operationId: operation.operationId,
      status: "rejected",
      entityType: operation.entityType,
      entityId: operation.entityId,
      error: {
        code: "validation_error",
        message: error.issues[0]?.message ?? "Invalid sync payload",
        retryable: false
      }
    };
  }

  if (error instanceof HttpError) {
    const code = errorCodeFor(operation, error);
    const response = (error.details as { response?: Record<string, unknown> } | undefined)?.response;
    return {
      operationId: operation.operationId,
      status: error.status === 409 ? "conflict" : "rejected",
      entityType: operation.entityType,
      entityId: operation.entityId,
      ...(response ? { response } : {}),
      error: {
        code,
        message: error.message,
        retryable: error.status >= 500
      }
    };
  }

  if (isFirestoreTransactionOrderError(error)) {
    return {
      operationId: operation.operationId,
      status: "rejected",
      entityType: operation.entityType,
      entityId: operation.entityId,
      error: {
        code: "sync_transaction_order_error",
        message: "Sync transaction tried to read after writing change log data",
        retryable: false
      }
    };
  }

  return {
    operationId: operation.operationId,
    status: "rejected",
    entityType: operation.entityType,
    entityId: operation.entityId,
    error: {
      code: "unknown_error",
      message: error instanceof Error ? error.message : "Unknown sync error",
      retryable: false
    }
  };
}

function isFirestoreTransactionOrderError(error: unknown) {
  return error instanceof Error && /Firestore transactions require all reads to be executed before all writes/i.test(error.message);
}

function assertPermissionForSync(user: AuthUser, permission: Parameters<typeof hasPermission>[1]) {
  if (!hasPermission(user.role, permission, user.permissions ?? [])) {
    throw new HttpError(403, `Missing permission: ${permission}`, { code: "permission_denied" });
  }
}

function errorCodeFor(operation: SyncPushOperation, error: HttpError) {
  const explicitCode = (error.details as { code?: string } | undefined)?.code;
  if (explicitCode) return explicitCode;
  if (error.status === 403) return "permission_denied";
  if (operation.entityType === "order" && error.status === 404 && /Order not found/i.test(error.message)) return "missing_order_dependency";
  if (operation.entityType === "order" && error.status === 404 && /Cash register not found/i.test(error.message)) return "cash_register_missing";
  return `http_${error.status}`;
}
