import { randomUUID } from "node:crypto";
import { db, FieldValue } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import { withId } from "../../utils/firestore.js";
export async function listTables(restaurantId) {
    const tables = await listScoped(restaurantId, "tables");
    return tables.filter((table) => !table.deletedAt);
}
export function getTable(restaurantId, tableId) {
    return getScoped(restaurantId, "tables", tableId);
}
export function createTable(restaurantId, input) {
    return createScoped(restaurantId, "tables", input);
}
export function updateTable(restaurantId, tableId, input) {
    return updateScoped(restaurantId, "tables", tableId, input);
}
export function deleteTable(restaurantId, tableId) {
    return deleteScoped(restaurantId, "tables", tableId);
}
export function listInventoryItems(restaurantId) {
    return listScoped(restaurantId, "inventoryItems");
}
export function getInventoryItem(restaurantId, itemId) {
    return getScoped(restaurantId, "inventoryItems", itemId);
}
export function createInventoryItem(restaurantId, input) {
    return createScoped(restaurantId, "inventoryItems", input);
}
export function updateInventoryItem(restaurantId, itemId, input) {
    return updateScoped(restaurantId, "inventoryItems", itemId, input);
}
export function deleteInventoryItem(restaurantId, itemId) {
    return deleteScoped(restaurantId, "inventoryItems", itemId);
}
export function listInventoryTransactions(restaurantId) {
    return listScoped(restaurantId, "inventoryTransactions");
}
export async function adjustInventory(restaurantId, input, createdById) {
    const itemRef = scopedDoc(restaurantId, "inventoryItems", input.inventoryItemId);
    const transactionRef = scopedCollection(restaurantId, "inventoryTransactions").doc();
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(itemRef);
        if (!snapshot.exists) {
            throw new HttpError(404, "Inventory item not found");
        }
        const item = snapshot.data();
        const currentQuantity = numberValue(item.currentQuantity);
        const delta = inventoryDelta(input.type, input.quantity);
        const balanceAfter = currentQuantity + delta;
        transaction.update(itemRef, {
            currentQuantity: balanceAfter,
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.set(transactionRef, {
            restaurantId,
            inventoryItemId: input.inventoryItemId,
            type: input.type,
            quantity: Math.abs(input.quantity),
            balanceAfter,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            reason: input.reason,
            createdById,
            createdAt: FieldValue.serverTimestamp()
        });
    });
    return { id: transactionRef.id };
}
export function listRecipeIngredients(restaurantId) {
    return listScoped(restaurantId, "recipeIngredients");
}
export function createRecipeIngredient(restaurantId, input) {
    return createScoped(restaurantId, "recipeIngredients", input);
}
export async function saveMenuItemRecipe(restaurantId, menuItemId, ingredients) {
    const menuItemRef = db.collection("restaurants").doc(restaurantId).collection("items").doc(menuItemId);
    const existingRecipeQuery = scopedCollection(restaurantId, "recipeIngredients").where("menuItemId", "==", menuItemId);
    const uniqueInventoryIds = [...new Set(ingredients.map((ingredient) => ingredient.inventoryItemId))];
    await db.runTransaction(async (transaction) => {
        const menuItemSnapshot = await transaction.get(menuItemRef);
        if (!menuItemSnapshot.exists) {
            throw new HttpError(404, "Menu item not found");
        }
        const existingRecipeSnapshot = await transaction.get(existingRecipeQuery);
        const inventorySnapshots = await Promise.all(uniqueInventoryIds.map(async (inventoryItemId) => {
            const itemRef = scopedDoc(restaurantId, "inventoryItems", inventoryItemId);
            const itemSnapshot = await transaction.get(itemRef);
            return { inventoryItemId, itemSnapshot };
        }));
        for (const { inventoryItemId, itemSnapshot } of inventorySnapshots) {
            if (!itemSnapshot.exists) {
                throw new HttpError(404, `Inventory item not found: ${inventoryItemId}`);
            }
        }
        for (const doc of existingRecipeSnapshot.docs) {
            transaction.delete(doc.ref);
        }
        for (const ingredient of ingredients) {
            const recipeRef = scopedCollection(restaurantId, "recipeIngredients").doc();
            transaction.set(recipeRef, {
                restaurantId,
                menuItemId,
                inventoryItemId: ingredient.inventoryItemId,
                quantity: numberValue(ingredient.quantity),
                unit: ingredient.unit,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        }
    });
    return { ok: true };
}
export function deleteRecipeIngredient(restaurantId, recipeIngredientId) {
    return deleteScoped(restaurantId, "recipeIngredients", recipeIngredientId);
}
export function listSuppliers(restaurantId) {
    return listScoped(restaurantId, "suppliers");
}
export function getSupplier(restaurantId, supplierId) {
    return getScoped(restaurantId, "suppliers", supplierId);
}
export function createSupplier(restaurantId, input) {
    return createScoped(restaurantId, "suppliers", input);
}
export function updateSupplier(restaurantId, supplierId, input) {
    return updateScoped(restaurantId, "suppliers", supplierId, input);
}
export function deleteSupplier(restaurantId, supplierId) {
    return deleteScoped(restaurantId, "suppliers", supplierId);
}
export function listOrders(restaurantId) {
    return listScoped(restaurantId, "orders");
}
export function getOrder(restaurantId, orderId) {
    return getScoped(restaurantId, "orders", orderId);
}
export async function createOrder(restaurantId, input, createdById, restaurant, options = {}) {
    const items = await hydrateOrderItems(restaurantId, input.items);
    const totals = calculateOrderTotals(items, input.discount, input.tax, input.serviceCharge);
    const orderedAt = input.orderedAt || new Date().toISOString();
    const ref = options.orderId ? scopedCollection(restaurantId, "orders").doc(options.orderId) : scopedCollection(restaurantId, "orders").doc();
    const version = Date.now();
    await db.runTransaction(async (transaction) => {
        const existingOrder = await transaction.get(ref);
        if (existingOrder.exists)
            return;
        let tableName = "";
        if (input.tableId) {
            const tableRef = scopedDoc(restaurantId, "tables", input.tableId);
            const table = await transaction.get(tableRef);
            if (!table.exists) {
                throw new HttpError(404, "Table not found");
            }
            const tableData = table.data();
            if (tableData.status === "DISABLED") {
                throw new HttpError(400, "Cannot start an order on a disabled table");
            }
            if (tableData.currentOrderId && tableData.currentOrderId !== ref.id) {
                throw new HttpError(409, "Table already has an open order", { code: "table_occupied" });
            }
            tableName = String(tableData.name ?? "");
            transaction.update(tableRef, {
                status: "OCCUPIED",
                currentOrderId: ref.id,
                updatedAt: FieldValue.serverTimestamp()
            });
        }
        transaction.set(ref, {
            restaurantId,
            name: input.name || defaultOrderName(tableName, orderedAt),
            tableId: input.tableId,
            type: input.type,
            source: input.source,
            status: input.status,
            items,
            ...totals,
            paidAmount: 0,
            paymentStatus: "UNPAID",
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
            version,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
    });
    return { id: ref.id };
}
export async function updateOrder(restaurantId, orderId, input) {
    if (input.status === "COMPLETED") {
        throw new HttpError(400, "Use the complete endpoint to complete orders");
    }
    if (input.status === "CANCELLED") {
        throw new HttpError(400, "Use the cancel endpoint to cancel orders");
    }
    const orderRef = scopedDoc(restaurantId, "orders", orderId);
    const hasFinancialChanges = input.items !== undefined ||
        input.discount !== undefined ||
        input.tax !== undefined ||
        input.serviceCharge !== undefined ||
        input.paymentMethod !== undefined;
    const items = input.items ? await hydrateOrderItems(restaurantId, input.items) : null;
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists) {
            throw new HttpError(404, "Order not found");
        }
        const order = { id: snapshot.id, ...snapshot.data() };
        const nextVersion = nextOrderVersion(order);
        const orderIsClosed = ["COMPLETED", "CANCELLED"].includes(order.status);
        const orderHasFinancialLink = Boolean(order.invoiceId || order.paymentId);
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
        const nextItems = items ?? order.items;
        const discount = input.discount ?? numberValue(order.discount);
        const tax = input.tax ?? numberValue(order.tax);
        const serviceCharge = input.serviceCharge ?? numberValue(order.serviceCharge);
        const totals = hasFinancialChanges ? calculateOrderTotals(nextItems, discount, tax, serviceCharge) : {};
        const nextTableId = input.tableId ?? order.tableId ?? "";
        if (tableIsChanging) {
            const previousTableRef = order.tableId ? scopedDoc(restaurantId, "tables", order.tableId) : null;
            const nextTableRef = nextTableId ? scopedDoc(restaurantId, "tables", nextTableId) : null;
            const [previousTable, nextTable] = await Promise.all([
                previousTableRef ? transaction.get(previousTableRef) : Promise.resolve(null),
                nextTableRef ? transaction.get(nextTableRef) : Promise.resolve(null)
            ]);
            if (nextTableRef && !nextTable?.exists) {
                throw new HttpError(404, "Table not found");
            }
            if (nextTable?.exists) {
                const targetTable = nextTable.data();
                if (targetTable.status === "DISABLED") {
                    throw new HttpError(400, "Cannot move an order to a disabled table");
                }
                if (targetTable.currentOrderId && targetTable.currentOrderId !== orderId) {
                    throw new HttpError(409, "Target table already has an open order", { code: "table_occupied" });
                }
            }
            if (previousTableRef && previousTable?.exists && previousTable.data().currentOrderId === orderId) {
                transaction.update(previousTableRef, {
                    status: "AVAILABLE",
                    currentOrderId: "",
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
            if (nextTableRef) {
                transaction.update(nextTableRef, {
                    status: "OCCUPIED",
                    currentOrderId: orderId,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        }
        transaction.update(orderRef, {
            ...input,
            ...(items ? { items } : {}),
            ...totals,
            restaurantId,
            version: nextVersion,
            updatedAt: FieldValue.serverTimestamp()
        });
    });
}
export async function cancelOrder(restaurantId, orderId, createdById, reason) {
    const orderRef = scopedDoc(restaurantId, "orders", orderId);
    const refundInvoiceRef = scopedDoc(restaurantId, "invoices", `refund_order_${orderId}`);
    const reverseJournalRef = scopedDoc(restaurantId, "journalEntries", `reverse_order_${orderId}`);
    const originalCashMovementRef = scopedDoc(restaurantId, "cashMovements", `order_${orderId}`);
    const reverseCashMovementRef = scopedDoc(restaurantId, "cashMovements", `cancel_order_${orderId}`);
    await db.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);
        if (!orderSnapshot.exists) {
            throw new HttpError(404, "Order not found");
        }
        const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
        const nextVersion = nextOrderVersion(order);
        if (order.status === "CANCELLED")
            return;
        const invoiceRef = order.invoiceId ? scopedDoc(restaurantId, "invoices", order.invoiceId) : null;
        const invoiceSnapshot = invoiceRef ? await transaction.get(invoiceRef) : null;
        const originalCashMovementSnapshot = await transaction.get(originalCashMovementRef);
        const originalCashMovement = originalCashMovementSnapshot.exists ? originalCashMovementSnapshot.data() : null;
        const cashRegisterRef = originalCashMovement?.cashRegisterId ? scopedDoc(restaurantId, "cashRegisters", originalCashMovement.cashRegisterId) : null;
        const cashRegisterSnapshot = cashRegisterRef ? await transaction.get(cashRegisterRef) : null;
        if (order.inventoryDeductedAt) {
            await restoreRecipeInventory(transaction, restaurantId, order, createdById, reason);
        }
        if (order.invoiceId) {
            if (invoiceRef && invoiceSnapshot?.exists) {
                transaction.update(invoiceRef, {
                    status: "VOID",
                    notes: appendNote(String(invoiceSnapshot.data().notes ?? ""), `Cancelled order: ${reason}`),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
            transaction.set(refundInvoiceRef, {
                restaurantId,
                type: "REFUND",
                status: "PAID",
                orderId,
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
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            transaction.set(reverseJournalRef, {
                restaurantId,
                status: "POSTED",
                referenceType: "ORDER_CANCEL",
                referenceId: orderId,
                lines: buildReverseSaleJournalLines(order.paidAmount, Math.max(order.total - order.paidAmount, 0), order.total),
                memo: `Cancel order ${orderId}: ${reason}`,
                createdById,
                postedAt: new Date().toISOString(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            if (originalCashMovement && cashRegisterRef && cashRegisterSnapshot?.exists && numberValue(originalCashMovement.amount) > 0) {
                transaction.set(reverseCashMovementRef, {
                    restaurantId,
                    cashRegisterId: originalCashMovement.cashRegisterId,
                    type: "OUT",
                    amount: numberValue(originalCashMovement.amount),
                    referenceType: "ORDER_CANCEL",
                    referenceId: orderId,
                    note: reason,
                    createdById,
                    createdAt: FieldValue.serverTimestamp()
                });
                transaction.update(cashRegisterRef, {
                    currentBalance: FieldValue.increment(-numberValue(originalCashMovement.amount)),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        }
        transaction.update(orderRef, {
            status: "CANCELLED",
            cancelledAt: new Date().toISOString(),
            notes: appendNote(order.notes, `Cancelled: ${reason}`),
            version: nextVersion,
            updatedAt: FieldValue.serverTimestamp()
        });
        if (order.tableId) {
            transaction.update(scopedDoc(restaurantId, "tables", order.tableId), {
                status: "AVAILABLE",
                currentOrderId: "",
                updatedAt: FieldValue.serverTimestamp()
            });
        }
    });
    return { ok: true };
}
export async function completeOrder(restaurantId, orderId, input, createdById) {
    const orderRef = scopedDoc(restaurantId, "orders", orderId);
    const invoiceRef = scopedDoc(restaurantId, "invoices", `order_${orderId}`);
    const paymentRef = scopedDoc(restaurantId, "payments", `order_${orderId}`);
    const cashMovementRef = scopedDoc(restaurantId, "cashMovements", `order_${orderId}`);
    const journalEntryRef = scopedDoc(restaurantId, "journalEntries", `order_${orderId}`);
    await db.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);
        if (!orderSnapshot.exists) {
            throw new HttpError(404, "Order not found");
        }
        const order = { id: orderSnapshot.id, ...orderSnapshot.data() };
        const nextVersion = nextOrderVersion(order);
        if (order.status === "CANCELLED") {
            throw new HttpError(400, "Cancelled orders cannot be completed");
        }
        if (order.invoiceId) {
            return;
        }
        if (input.paymentMethod === "SPLIT" && (input.paidAmount === undefined || input.paidAmount <= 0)) {
            throw new HttpError(400, "Split payments require a paid amount");
        }
        const paidAmount = input.paymentMethod === "DEBT" ? 0 : input.paidAmount ?? order.total;
        if (paidAmount > order.total) {
            throw new HttpError(400, "Paid amount cannot exceed order total");
        }
        const remainingAmount = Math.max(order.total - paidAmount, 0);
        const invoiceStatus = remainingAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";
        const paymentStatus = remainingAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID";
        const cashRegisterRef = input.cashRegisterId && paidAmount > 0 ? scopedDoc(restaurantId, "cashRegisters", input.cashRegisterId) : null;
        const cashRegisterSnapshot = cashRegisterRef ? await transaction.get(cashRegisterRef) : null;
        if (cashRegisterRef && !cashRegisterSnapshot?.exists) {
            throw new HttpError(404, "Cash register not found", { code: "cash_register_missing" });
        }
        await deductRecipeInventory(transaction, restaurantId, order, createdById);
        transaction.set(invoiceRef, {
            restaurantId,
            type: "SALE",
            status: invoiceStatus,
            orderId,
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
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
        if (paidAmount > 0) {
            transaction.set(paymentRef, {
                restaurantId,
                invoiceId: invoiceRef.id,
                orderId,
                supplierId: "",
                type: "SALE",
                amount: paidAmount,
                method: input.paymentMethod,
                note: input.note,
                createdById,
                paidAt: new Date().toISOString(),
                createdAt: FieldValue.serverTimestamp()
            });
            transaction.set(cashMovementRef, {
                restaurantId,
                cashRegisterId: input.cashRegisterId ?? "",
                type: "IN",
                amount: paidAmount,
                referenceType: "PAYMENT",
                referenceId: paymentRef.id,
                note: input.note,
                createdById,
                createdAt: FieldValue.serverTimestamp()
            });
            if (cashRegisterRef) {
                transaction.update(cashRegisterRef, {
                    currentBalance: FieldValue.increment(paidAmount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        }
        transaction.set(journalEntryRef, {
            restaurantId,
            status: "POSTED",
            referenceType: "ORDER",
            referenceId: orderId,
            lines: buildSaleJournalLines(paidAmount, remainingAmount, order.total),
            memo: `Order ${orderId}`,
            createdById,
            postedAt: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.update(orderRef, {
            status: "COMPLETED",
            paidAmount,
            paymentStatus,
            paymentMethod: input.paymentMethod,
            invoiceId: invoiceRef.id,
            paymentId: paidAmount > 0 ? paymentRef.id : "",
            inventoryDeductedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            closedById: createdById,
            version: nextVersion,
            updatedAt: FieldValue.serverTimestamp()
        });
        if (order.tableId) {
            transaction.update(scopedDoc(restaurantId, "tables", order.tableId), {
                status: "AVAILABLE",
                currentOrderId: "",
                updatedAt: FieldValue.serverTimestamp()
            });
        }
    });
    return {
        orderId,
        invoiceId: invoiceRef.id,
        paymentId: paymentRef.id
    };
}
export function listInvoices(restaurantId) {
    return listScoped(restaurantId, "invoices");
}
export function getInvoice(restaurantId, invoiceId) {
    return getScoped(restaurantId, "invoices", invoiceId);
}
export function createInvoice(restaurantId, input, createdById) {
    const items = input.items.map((item) => ({ ...item, total: item.total || item.quantity * item.unitPrice }));
    const subTotal = items.reduce((sum, item) => sum + item.total, 0);
    const total = Math.max(subTotal - input.discount + input.tax + input.serviceCharge, 0);
    const remainingAmount = Math.max(total - input.paidAmount, 0);
    return createScoped(restaurantId, "invoices", {
        ...input,
        items,
        subTotal,
        total,
        remainingAmount,
        status: remainingAmount === 0 ? "PAID" : input.paidAmount > 0 ? "PARTIAL" : input.status,
        createdById
    });
}
export async function updateInvoice(restaurantId, invoiceId, input) {
    const current = await getInvoice(restaurantId, invoiceId);
    const items = input.items ? input.items.map((item) => ({ ...item, total: item.total || item.quantity * item.unitPrice })) : current.items;
    const subTotal = items.reduce((sum, item) => sum + numberValue(item.total), 0);
    const discount = input.discount ?? current.discount;
    const tax = input.tax ?? current.tax;
    const serviceCharge = input.serviceCharge ?? current.serviceCharge;
    const paidAmount = input.paidAmount ?? current.paidAmount;
    const total = Math.max(subTotal - discount + tax + serviceCharge, 0);
    const remainingAmount = Math.max(total - paidAmount, 0);
    return updateScoped(restaurantId, "invoices", invoiceId, {
        ...input,
        items,
        subTotal,
        discount,
        tax,
        serviceCharge,
        total,
        paidAmount,
        remainingAmount,
        status: input.status ?? (remainingAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID")
    });
}
export function deleteInvoice(restaurantId, invoiceId) {
    return deleteScoped(restaurantId, "invoices", invoiceId);
}
export function listPayments(restaurantId) {
    return listScoped(restaurantId, "payments");
}
export function getPayment(restaurantId, paymentId) {
    return getScoped(restaurantId, "payments", paymentId);
}
export function createPayment(restaurantId, input, createdById) {
    return createScoped(restaurantId, "payments", {
        ...input,
        paidAt: input.paidAt ?? new Date().toISOString(),
        createdById
    });
}
export function deletePayment(restaurantId, paymentId) {
    return deleteScoped(restaurantId, "payments", paymentId);
}
export function listExpenses(restaurantId) {
    return listScoped(restaurantId, "expenses");
}
export function getExpense(restaurantId, expenseId) {
    return getScoped(restaurantId, "expenses", expenseId);
}
export function createExpense(restaurantId, input, createdById) {
    return createScoped(restaurantId, "expenses", {
        ...input,
        paidAt: input.paidAt ?? new Date().toISOString(),
        createdById
    });
}
export function updateExpense(restaurantId, expenseId, input) {
    return updateScoped(restaurantId, "expenses", expenseId, input);
}
export function deleteExpense(restaurantId, expenseId) {
    return deleteScoped(restaurantId, "expenses", expenseId);
}
export function listCashRegisters(restaurantId) {
    return listScoped(restaurantId, "cashRegisters");
}
export function getCashRegister(restaurantId, cashRegisterId) {
    return getScoped(restaurantId, "cashRegisters", cashRegisterId);
}
export function createCashRegister(restaurantId, input, createdById) {
    return createScoped(restaurantId, "cashRegisters", {
        name: input.name,
        openingBalance: input.openingBalance,
        currentBalance: input.openingBalance,
        isOpen: true,
        openedById: createdById,
        closedById: "",
        openedAt: new Date().toISOString(),
        closedAt: ""
    });
}
export function listCashMovements(restaurantId) {
    return listScoped(restaurantId, "cashMovements");
}
export function getCashMovement(restaurantId, cashMovementId) {
    return getScoped(restaurantId, "cashMovements", cashMovementId);
}
export function createCashMovement(restaurantId, input, createdById) {
    return createScoped(restaurantId, "cashMovements", {
        ...input,
        createdById
    });
}
export function listAccounts(restaurantId) {
    return listScoped(restaurantId, "accounts");
}
export function getAccount(restaurantId, accountId) {
    return getScoped(restaurantId, "accounts", accountId);
}
export function createAccount(restaurantId, input) {
    return createScoped(restaurantId, "accounts", input);
}
export function updateAccount(restaurantId, accountId, input) {
    return updateScoped(restaurantId, "accounts", accountId, input);
}
export function deleteAccount(restaurantId, accountId) {
    return deleteScoped(restaurantId, "accounts", accountId);
}
export function listJournalEntries(restaurantId) {
    return listScoped(restaurantId, "journalEntries");
}
export function getJournalEntry(restaurantId, journalEntryId) {
    return getScoped(restaurantId, "journalEntries", journalEntryId);
}
export function createJournalEntry(restaurantId, input, createdById) {
    assertBalancedJournal(input.lines);
    return createScoped(restaurantId, "journalEntries", {
        ...input,
        postedAt: input.postedAt ?? new Date().toISOString(),
        createdById
    });
}
export async function getReportsSummary(restaurantId, from, to) {
    const [orders, payments, expenses, inventoryItems, invoices] = await Promise.all([
        listOrders(restaurantId),
        listPayments(restaurantId),
        listExpenses(restaurantId),
        listInventoryItems(restaurantId),
        listInvoices(restaurantId)
    ]);
    const filterFrom = from ?? new Date().toISOString().slice(0, 10);
    const filterTo = to ?? filterFrom;
    const rangedPayments = payments.filter((payment) => isWithinDateRange(payment.paidAt, filterFrom, filterTo));
    const rangedExpenses = expenses.filter((expense) => isWithinDateRange(expense.paidAt, filterFrom, filterTo));
    const sales = rangedPayments.filter((payment) => payment.type === "SALE").reduce((sum, payment) => sum + numberValue(payment.amount), 0);
    const purchases = invoices.filter((invoice) => invoice.type === "PURCHASE").reduce((sum, invoice) => sum + numberValue(invoice.total), 0);
    const expenseTotal = rangedExpenses.reduce((sum, expense) => sum + numberValue(expense.amount), 0);
    const lowStockItems = inventoryItems.filter((item) => numberValue(item.currentQuantity) <= numberValue(item.minimumQuantity));
    return {
        range: { from: filterFrom, to: filterTo },
        totals: {
            sales,
            purchases,
            expenses: expenseTotal,
            net: sales - purchases - expenseTotal
        },
        orders: {
            total: orders.length,
            open: orders.filter((order) => !["COMPLETED", "CANCELLED"].includes(order.status)).length,
            completed: orders.filter((order) => order.status === "COMPLETED").length,
            cancelled: orders.filter((order) => order.status === "CANCELLED").length
        },
        inventory: {
            totalItems: inventoryItems.length,
            lowStockCount: lowStockItems.length,
            lowStockItems: lowStockItems.slice(0, 10)
        },
        paymentsByMethod: groupAmounts(rangedPayments, "method")
    };
}
async function hydrateOrderItems(restaurantId, lines) {
    const items = [];
    for (const line of lines) {
        const itemSnapshot = await db.collection("restaurants").doc(restaurantId).collection("items").doc(line.menuItemId).get();
        if (!itemSnapshot.exists) {
            throw new HttpError(404, `Menu item not found: ${line.menuItemId}`);
        }
        const menuItem = itemSnapshot.data();
        const quantity = numberValue(line.quantity);
        const unitPrice = numberValue(menuItem.price);
        items.push({
            menuItemId: line.menuItemId,
            name: menuItem.name,
            quantity,
            unitPrice,
            notes: line.notes,
            modifiers: line.modifiers,
            total: quantity * unitPrice
        });
    }
    return items;
}
async function deductRecipeInventory(transaction, restaurantId, order, createdById) {
    if (order.inventoryDeductedAt)
        return;
    const recipeSnapshot = await transaction.get(scopedCollection(restaurantId, "recipeIngredients"));
    const recipeIngredients = recipeSnapshot.docs.map((doc) => doc.data());
    const deductions = new Map();
    for (const line of order.items) {
        for (const ingredient of recipeIngredients.filter((item) => item.menuItemId === line.menuItemId)) {
            deductions.set(ingredient.inventoryItemId, (deductions.get(ingredient.inventoryItemId) ?? 0) + ingredient.quantity * line.quantity);
        }
    }
    const inventoryReads = await Promise.all([...deductions.entries()].map(async ([inventoryItemId, quantity]) => {
        const itemRef = scopedDoc(restaurantId, "inventoryItems", inventoryItemId);
        const itemSnapshot = await transaction.get(itemRef);
        return { inventoryItemId, quantity, itemRef, itemSnapshot };
    }));
    for (const { inventoryItemId, quantity, itemRef, itemSnapshot } of inventoryReads) {
        if (!itemSnapshot.exists) {
            throw new HttpError(404, `Inventory item not found: ${inventoryItemId}`);
        }
        const item = itemSnapshot.data();
        const balanceAfter = numberValue(item.currentQuantity) - quantity;
        transaction.update(itemRef, {
            currentQuantity: balanceAfter,
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.set(scopedDoc(restaurantId, "inventoryTransactions", `order_${order.id}_${inventoryItemId}`), {
            restaurantId,
            inventoryItemId,
            type: "OUT",
            quantity,
            balanceAfter,
            referenceType: "ORDER",
            referenceId: order.id,
            reason: "Order completion",
            createdById,
            createdAt: FieldValue.serverTimestamp()
        });
    }
}
function buildSaleJournalLines(paidAmount, remainingAmount, total) {
    const lines = [];
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
function buildReverseSaleJournalLines(paidAmount, remainingAmount, total) {
    const lines = [{ accountId: "sales", debit: total, credit: 0, memo: "Reverse sales revenue" }];
    if (paidAmount > 0) {
        lines.push({ accountId: "cash", debit: 0, credit: paidAmount, memo: "Reverse payment received" });
    }
    if (remainingAmount > 0) {
        lines.push({ accountId: "accounts_receivable", debit: 0, credit: remainingAmount, memo: "Reverse receivable" });
    }
    assertBalancedJournal(lines);
    return lines;
}
async function restoreRecipeInventory(transaction, restaurantId, order, createdById, reason) {
    const recipeSnapshot = await transaction.get(scopedCollection(restaurantId, "recipeIngredients"));
    const recipeIngredients = recipeSnapshot.docs.map((doc) => doc.data());
    const restorations = new Map();
    for (const line of order.items) {
        for (const ingredient of recipeIngredients.filter((item) => item.menuItemId === line.menuItemId)) {
            restorations.set(ingredient.inventoryItemId, (restorations.get(ingredient.inventoryItemId) ?? 0) + ingredient.quantity * line.quantity);
        }
    }
    const inventoryReads = await Promise.all([...restorations.entries()].map(async ([inventoryItemId, quantity]) => {
        const itemRef = scopedDoc(restaurantId, "inventoryItems", inventoryItemId);
        const itemSnapshot = await transaction.get(itemRef);
        return { inventoryItemId, quantity, itemRef, itemSnapshot };
    }));
    for (const { inventoryItemId, quantity, itemRef, itemSnapshot } of inventoryReads) {
        if (!itemSnapshot.exists)
            continue;
        const item = itemSnapshot.data();
        const balanceAfter = numberValue(item.currentQuantity) + quantity;
        transaction.update(itemRef, {
            currentQuantity: balanceAfter,
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.set(scopedDoc(restaurantId, "inventoryTransactions", `cancel_${order.id}_${inventoryItemId}`), {
            restaurantId,
            inventoryItemId,
            type: "REVERSE",
            quantity,
            balanceAfter,
            referenceType: "ORDER_CANCEL",
            referenceId: order.id,
            reason,
            createdById,
            createdAt: FieldValue.serverTimestamp()
        });
    }
}
function assertBalancedJournal(lines) {
    const totalDebit = lines.reduce((sum, line) => sum + numberValue(line.debit), 0);
    const totalCredit = lines.reduce((sum, line) => sum + numberValue(line.credit), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
        throw new HttpError(400, "Journal entry is not balanced");
    }
}
function appendNote(current, note) {
    return [current, note].filter(Boolean).join("\n");
}
function calculateOrderTotals(items, discount, tax, serviceCharge) {
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
function defaultOrderName(tableName, orderedAt) {
    const parsed = new Date(orderedAt);
    const time = Number.isNaN(parsed.getTime())
        ? new Date().toISOString().slice(11, 16)
        : `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
    return `${tableName || "طلب"} - ${time}`;
}
function inventoryDelta(type, quantity) {
    if (type === "OUT")
        return -Math.abs(quantity);
    if (type === "IN")
        return Math.abs(quantity);
    return quantity;
}
async function listScoped(restaurantId, collectionName) {
    const snapshot = await scopedCollection(restaurantId, collectionName).get();
    return snapshot.docs
        .map((doc) => withId(doc))
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}
async function getScoped(restaurantId, collectionName, id) {
    const doc = await scopedDoc(restaurantId, collectionName, id).get();
    if (!doc.exists) {
        throw new HttpError(404, "Record not found");
    }
    return withId(doc);
}
async function createScoped(restaurantId, collectionName, input) {
    const ref = scopedCollection(restaurantId, collectionName).doc(randomUUID());
    await ref.set({
        ...input,
        restaurantId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    });
    return { id: ref.id };
}
async function updateScoped(restaurantId, collectionName, id, input) {
    const ref = scopedDoc(restaurantId, collectionName, id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
        throw new HttpError(404, "Record not found");
    }
    await ref.update({
        ...input,
        restaurantId,
        updatedAt: FieldValue.serverTimestamp()
    });
}
async function deleteScoped(restaurantId, collectionName, id) {
    const ref = scopedDoc(restaurantId, collectionName, id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
        throw new HttpError(404, "Record not found");
    }
    await ref.delete();
}
function scopedCollection(restaurantId, collectionName) {
    return db.collection("restaurants").doc(restaurantId).collection(collectionName);
}
function scopedDoc(restaurantId, collectionName, id) {
    return scopedCollection(restaurantId, collectionName).doc(id);
}
function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function currentOrderVersion(order) {
    const explicitVersion = Number(order.version);
    if (Number.isFinite(explicitVersion) && explicitVersion > 0)
        return explicitVersion;
    return timestampVersion(order.updatedAt) || timestampVersion(order.createdAt) || 0;
}
function nextOrderVersion(order) {
    const currentVersion = currentOrderVersion(order);
    return Math.max(Date.now(), currentVersion + 1);
}
function timestampVersion(value) {
    if (!value)
        return 0;
    if (typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
        const millis = value.toMillis();
        return Number.isFinite(millis) ? millis : 0;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}
function isWithinDateRange(value, from, to) {
    if (!value)
        return false;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return false;
    const date = parsed.toISOString().slice(0, 10);
    return date >= from && date <= to;
}
function groupAmounts(items, key) {
    return items.reduce((result, item) => {
        const groupKey = String(item[key] ?? "UNKNOWN");
        result[groupKey] = (result[groupKey] ?? 0) + numberValue(item.amount);
        return result;
    }, {});
}
