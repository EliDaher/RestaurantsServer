import { Router } from "express";
import { assertPermission } from "../../services/permissions.js";
import { getTenantContext } from "../../services/tenant.js";
import { sendJson } from "../../utils/http.js";
import {
  accountCreateSchema,
  accountPatchSchema,
  cashMovementCreateSchema,
  cashRegisterCreateSchema,
  cancelOrderSchema,
  completeOrderSchema,
  expenseCreateSchema,
  expensePatchSchema,
  inventoryAdjustmentSchema,
  inventoryItemCreateSchema,
  inventoryItemPatchSchema,
  invoiceCreateSchema,
  invoicePatchSchema,
  journalEntryCreateSchema,
  menuItemRecipeSaveSchema,
  orderCreateSchema,
  orderPatchSchema,
  paymentCreateSchema,
  recipeIngredientCreateSchema,
  reportQuerySchema,
  supplierCreateSchema,
  supplierPatchSchema,
  tableCreateSchema,
  tablePatchSchema
} from "./validators.js";
import {
  adjustInventory,
  cancelOrder,
  completeOrder,
  createAccount,
  createCashMovement,
  createCashRegister,
  createExpense,
  createInventoryItem,
  createInvoice,
  createJournalEntry,
  createOrder,
  createPayment,
  createRecipeIngredient,
  createSupplier,
  createTable,
  deleteAccount,
  deleteExpense,
  deleteInventoryItem,
  deleteInvoice,
  deletePayment,
  deleteRecipeIngredient,
  deleteSupplier,
  deleteTable,
  getAccount,
  getCashMovement,
  getCashRegister,
  getExpense,
  getInventoryItem,
  getInvoice,
  getJournalEntry,
  getOrder,
  getPayment,
  getReportsSummary,
  getSupplier,
  getTable,
  listAccounts,
  listCashMovements,
  listCashRegisters,
  listExpenses,
  listInventoryItems,
  listInventoryTransactions,
  listInvoices,
  listJournalEntries,
  listOrders,
  listPayments,
  listRecipeIngredients,
  listSuppliers,
  listTables,
  saveMenuItemRecipe,
  updateInventoryItem,
  updateAccount,
  updateExpense,
  updateInvoice,
  updateOrder,
  updateSupplier,
  updateTable
} from "./service.js";

export const restaurantOpsRouter = Router();

restaurantOpsRouter.get("/modules", async (req, res, next) => {
  try {
    const { restaurant } = await getTenantContext(req);
    sendJson(res, {
      plan: restaurant.plan,
      modules: restaurant.modules ?? {}
    });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/tables", async (req, res, next) => {
  try {
    assertPermission(req, "tables.manage");
    const { restaurantId } = await getTenantContext(req, "tables");
    sendJson(res, await listTables(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/tables/:tableId", async (req, res, next) => {
  try {
    assertPermission(req, "tables.manage");
    const { restaurantId } = await getTenantContext(req, "tables");
    sendJson(res, await getTable(restaurantId, req.params.tableId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/tables", async (req, res, next) => {
  try {
    assertPermission(req, "tables.manage");
    const { restaurantId } = await getTenantContext(req, "tables");
    const input = tableCreateSchema.parse(req.body);
    sendJson(res, await createTable(restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.patch("/tables/:tableId", async (req, res, next) => {
  try {
    assertPermission(req, "tables.manage");
    const { restaurantId } = await getTenantContext(req, "tables");
    const input = tablePatchSchema.parse(req.body);
    await updateTable(restaurantId, req.params.tableId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/tables/:tableId", async (req, res, next) => {
  try {
    assertPermission(req, "tables.manage");
    const { restaurantId } = await getTenantContext(req, "tables");
    await deleteTable(restaurantId, req.params.tableId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/orders", async (req, res, next) => {
  try {
    assertPermission(req, "orders.view");
    const { restaurantId } = await getTenantContext(req, "orders");
    sendJson(res, await listOrders(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/orders/:orderId", async (req, res, next) => {
  try {
    assertPermission(req, "orders.view");
    const { restaurantId } = await getTenantContext(req, "orders");
    sendJson(res, await getOrder(restaurantId, req.params.orderId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/orders", async (req, res, next) => {
  try {
    assertPermission(req, "orders.create");
    const { restaurantId, restaurant } = await getTenantContext(req, "orders");
    const input = orderCreateSchema.parse(req.body);
    sendJson(res, await createOrder(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner", restaurant), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.patch("/orders/:orderId", async (req, res, next) => {
  try {
    assertPermission(req, "orders.update");
    const { restaurantId } = await getTenantContext(req, "orders");
    const input = orderPatchSchema.parse(req.body);
    await updateOrder(restaurantId, req.params.orderId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/orders/:orderId/complete", async (req, res, next) => {
  try {
    assertPermission(req, "payments.create");
    const { restaurantId } = await getTenantContext(req, "payments");
    const input = completeOrderSchema.parse(req.body);
    sendJson(res, await completeOrder(restaurantId, req.params.orderId, input, req.user?.id ?? req.user?.email ?? "owner"));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/orders/:orderId/cancel", async (req, res, next) => {
  try {
    assertPermission(req, "orders.cancel");
    const { restaurantId } = await getTenantContext(req, "orders");
    const input = cancelOrderSchema.parse(req.body);
    sendJson(res, await cancelOrder(restaurantId, req.params.orderId, req.user?.id ?? req.user?.email ?? "owner", input.reason));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/inventory/items", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.view");
    const { restaurantId } = await getTenantContext(req, "inventory");
    sendJson(res, await listInventoryItems(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/inventory/items/:itemId", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.view");
    const { restaurantId } = await getTenantContext(req, "inventory");
    sendJson(res, await getInventoryItem(restaurantId, req.params.itemId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/inventory/items", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.adjust");
    const { restaurantId } = await getTenantContext(req, "inventory");
    const input = inventoryItemCreateSchema.parse(req.body);
    sendJson(res, await createInventoryItem(restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.patch("/inventory/items/:itemId", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.adjust");
    const { restaurantId } = await getTenantContext(req, "inventory");
    const input = inventoryItemPatchSchema.parse(req.body);
    await updateInventoryItem(restaurantId, req.params.itemId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/inventory/items/:itemId", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.adjust");
    const { restaurantId } = await getTenantContext(req, "inventory");
    await deleteInventoryItem(restaurantId, req.params.itemId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/inventory/transactions", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.view");
    const { restaurantId } = await getTenantContext(req, "inventory");
    sendJson(res, await listInventoryTransactions(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/inventory/transactions", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.adjust");
    const { restaurantId } = await getTenantContext(req, "inventory");
    const input = inventoryAdjustmentSchema.parse(req.body);
    sendJson(res, await adjustInventory(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner"), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/recipes", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.view");
    const { restaurantId } = await getTenantContext(req, "inventory");
    sendJson(res, await listRecipeIngredients(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/recipes", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.adjust");
    const { restaurantId } = await getTenantContext(req, "inventory");
    const input = recipeIngredientCreateSchema.parse(req.body);
    sendJson(res, await createRecipeIngredient(restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.put("/recipes/menu-items/:menuItemId", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.adjust");
    const { restaurantId } = await getTenantContext(req, "inventory");
    const input = menuItemRecipeSaveSchema.parse(req.body);
    sendJson(res, await saveMenuItemRecipe(restaurantId, req.params.menuItemId, input.ingredients));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/recipes/:recipeIngredientId", async (req, res, next) => {
  try {
    assertPermission(req, "inventory.adjust");
    const { restaurantId } = await getTenantContext(req, "inventory");
    await deleteRecipeIngredient(restaurantId, req.params.recipeIngredientId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/suppliers", async (req, res, next) => {
  try {
    assertPermission(req, "purchasing.manage");
    const { restaurantId } = await getTenantContext(req, "purchasing");
    sendJson(res, await listSuppliers(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/suppliers/:supplierId", async (req, res, next) => {
  try {
    assertPermission(req, "purchasing.manage");
    const { restaurantId } = await getTenantContext(req, "purchasing");
    sendJson(res, await getSupplier(restaurantId, req.params.supplierId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/suppliers", async (req, res, next) => {
  try {
    assertPermission(req, "purchasing.manage");
    const { restaurantId } = await getTenantContext(req, "purchasing");
    const input = supplierCreateSchema.parse(req.body);
    sendJson(res, await createSupplier(restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.patch("/suppliers/:supplierId", async (req, res, next) => {
  try {
    assertPermission(req, "purchasing.manage");
    const { restaurantId } = await getTenantContext(req, "purchasing");
    const input = supplierPatchSchema.parse(req.body);
    await updateSupplier(restaurantId, req.params.supplierId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/suppliers/:supplierId", async (req, res, next) => {
  try {
    assertPermission(req, "purchasing.manage");
    const { restaurantId } = await getTenantContext(req, "purchasing");
    await deleteSupplier(restaurantId, req.params.supplierId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/invoices", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await listInvoices(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/invoices/:invoiceId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await getInvoice(restaurantId, req.params.invoiceId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/invoices", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    const input = invoiceCreateSchema.parse(req.body);
    sendJson(res, await createInvoice(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner"), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.patch("/invoices/:invoiceId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    const input = invoicePatchSchema.parse(req.body);
    await updateInvoice(restaurantId, req.params.invoiceId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/invoices/:invoiceId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    await deleteInvoice(restaurantId, req.params.invoiceId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/payments", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "payments");
    sendJson(res, await listPayments(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/payments/:paymentId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "payments");
    sendJson(res, await getPayment(restaurantId, req.params.paymentId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/payments", async (req, res, next) => {
  try {
    assertPermission(req, "payments.create");
    const { restaurantId } = await getTenantContext(req, "payments");
    const input = paymentCreateSchema.parse(req.body);
    sendJson(res, await createPayment(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner"), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/payments/:paymentId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "payments");
    await deletePayment(restaurantId, req.params.paymentId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/expenses", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "expenses");
    sendJson(res, await listExpenses(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/expenses/:expenseId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "expenses");
    sendJson(res, await getExpense(restaurantId, req.params.expenseId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/expenses", async (req, res, next) => {
  try {
    assertPermission(req, "expenses.create");
    const { restaurantId } = await getTenantContext(req, "expenses");
    const input = expenseCreateSchema.parse(req.body);
    sendJson(res, await createExpense(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner"), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.patch("/expenses/:expenseId", async (req, res, next) => {
  try {
    assertPermission(req, "expenses.create");
    const { restaurantId } = await getTenantContext(req, "expenses");
    const input = expensePatchSchema.parse(req.body);
    await updateExpense(restaurantId, req.params.expenseId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/expenses/:expenseId", async (req, res, next) => {
  try {
    assertPermission(req, "expenses.create");
    const { restaurantId } = await getTenantContext(req, "expenses");
    await deleteExpense(restaurantId, req.params.expenseId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/cash/registers", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await listCashRegisters(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/cash/registers/:cashRegisterId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await getCashRegister(restaurantId, req.params.cashRegisterId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/cash/registers", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    const input = cashRegisterCreateSchema.parse(req.body);
    sendJson(res, await createCashRegister(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner"), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/cash/movements", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await listCashMovements(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/cash/movements/:cashMovementId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await getCashMovement(restaurantId, req.params.cashMovementId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/cash/movements", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    const input = cashMovementCreateSchema.parse(req.body);
    sendJson(res, await createCashMovement(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner"), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/accounts", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await listAccounts(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/accounts/:accountId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await getAccount(restaurantId, req.params.accountId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/accounts", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    const input = accountCreateSchema.parse(req.body);
    sendJson(res, await createAccount(restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.patch("/accounts/:accountId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    const input = accountPatchSchema.parse(req.body);
    await updateAccount(restaurantId, req.params.accountId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.delete("/accounts/:accountId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    await deleteAccount(restaurantId, req.params.accountId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/journal-entries", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await listJournalEntries(restaurantId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/journal-entries/:journalEntryId", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.view");
    const { restaurantId } = await getTenantContext(req, "accounting");
    sendJson(res, await getJournalEntry(restaurantId, req.params.journalEntryId));
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.post("/journal-entries", async (req, res, next) => {
  try {
    assertPermission(req, "accounting.manage");
    const { restaurantId } = await getTenantContext(req, "accounting");
    const input = journalEntryCreateSchema.parse(req.body);
    sendJson(res, await createJournalEntry(restaurantId, input, req.user?.id ?? req.user?.email ?? "owner"), 201);
  } catch (error) {
    next(error);
  }
});

restaurantOpsRouter.get("/reports/summary", async (req, res, next) => {
  try {
    assertPermission(req, "reports.view");
    const { restaurantId } = await getTenantContext(req, "reports");
    const input = reportQuerySchema.parse(req.query);
    sendJson(res, await getReportsSummary(restaurantId, input.from, input.to));
  } catch (error) {
    next(error);
  }
});
