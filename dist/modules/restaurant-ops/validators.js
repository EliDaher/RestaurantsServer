import { z } from "zod";
const tableStatusSchema = z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "DISABLED"]);
const orderTypeSchema = z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "QR"]);
const orderStatusSchema = z.enum(["DRAFT", "PENDING", "CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"]);
const paymentMethodSchema = z.enum(["CASH", "CARD", "BANK_TRANSFER", "WALLET", "SPLIT", "DEBT"]);
const invoiceTypeSchema = z.enum(["SALE", "PURCHASE", "REFUND"]);
const invoiceStatusSchema = z.enum(["UNPAID", "PARTIAL", "PAID", "VOID"]);
const inventoryTransactionTypeSchema = z.enum(["IN", "OUT", "ADJUST", "REVERSE"]);
const cashMovementTypeSchema = z.enum(["IN", "OUT"]);
const accountTypeSchema = z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
const journalStatusSchema = z.enum(["DRAFT", "POSTED", "REVERSED"]);
const optionalIdSchema = z.string().trim().default("");
export const tableCreateSchema = z.object({
    name: z.string().trim().min(1),
    area: z.string().trim().default("Main"),
    capacity: z.coerce.number().int().min(1).default(4),
    status: tableStatusSchema.default("AVAILABLE"),
    currentOrderId: optionalIdSchema,
    qrCode: z.string().trim().default("")
});
export const tablePatchSchema = tableCreateSchema.partial();
export const orderLineInputSchema = z.object({
    menuItemId: z.string().trim().min(1),
    quantity: z.coerce.number().positive(),
    notes: z.string().trim().default(""),
    modifiers: z.array(z.string().trim()).default([])
});
export const orderCreateSchema = z.object({
    name: z.string().trim().default(""),
    tableId: optionalIdSchema,
    type: orderTypeSchema.default("DINE_IN"),
    source: z.enum(["QR", "WAITER", "POS"]).default("POS"),
    status: orderStatusSchema.default("PENDING"),
    orderedAt: z.string().trim().optional(),
    items: z.array(orderLineInputSchema).min(1),
    discount: z.coerce.number().min(0).default(0),
    tax: z.coerce.number().min(0).default(0),
    serviceCharge: z.coerce.number().min(0).default(0),
    paymentMethod: paymentMethodSchema.default("CASH"),
    notes: z.string().trim().default("")
});
export const orderPatchSchema = z.object({
    name: z.string().trim().optional(),
    tableId: optionalIdSchema.optional(),
    type: orderTypeSchema.optional(),
    status: orderStatusSchema.optional(),
    orderedAt: z.string().trim().optional(),
    items: z.array(orderLineInputSchema).min(1).optional(),
    discount: z.coerce.number().min(0).optional(),
    tax: z.coerce.number().min(0).optional(),
    serviceCharge: z.coerce.number().min(0).optional(),
    paymentMethod: paymentMethodSchema.optional(),
    notes: z.string().trim().optional()
});
export const cancelOrderSchema = z.object({
    reason: z.string().trim().min(1).default("Cancelled by user")
});
export const completeOrderSchema = z.object({
    paymentMethod: paymentMethodSchema.default("CASH"),
    paidAmount: z.coerce.number().min(0).optional(),
    cashRegisterId: optionalIdSchema.optional(),
    note: z.string().trim().default("")
});
export const inventoryItemCreateSchema = z.object({
    name: z.string().trim().min(1),
    category: z.string().trim().default("Uncategorized"),
    unit: z.string().trim().min(1),
    currentQuantity: z.coerce.number().default(0),
    minimumQuantity: z.coerce.number().min(0).default(0),
    averageCost: z.coerce.number().min(0).default(0),
    sellPrice: z.coerce.number().min(0).default(0),
    isActive: z.boolean().default(true)
});
export const inventoryItemPatchSchema = inventoryItemCreateSchema.partial();
export const inventoryAdjustmentSchema = z.object({
    inventoryItemId: z.string().trim().min(1),
    type: inventoryTransactionTypeSchema,
    quantity: z.coerce.number(),
    referenceType: z.string().trim().default("MANUAL"),
    referenceId: z.string().trim().default("manual"),
    reason: z.string().trim().default("")
});
export const recipeIngredientCreateSchema = z.object({
    menuItemId: z.string().trim().min(1),
    inventoryItemId: z.string().trim().min(1),
    quantity: z.coerce.number().positive(),
    unit: z.string().trim().default("")
});
export const menuItemRecipeSaveSchema = z.object({
    ingredients: z.array(z.object({
        inventoryItemId: z.string().trim().min(1),
        quantity: z.coerce.number().positive(),
        unit: z.string().trim().default("")
    })).default([])
});
export const supplierCreateSchema = z.object({
    name: z.string().trim().min(1),
    phone: z.string().trim().default(""),
    balance: z.coerce.number().default(0),
    notes: z.string().trim().default(""),
    isActive: z.boolean().default(true)
});
export const supplierPatchSchema = supplierCreateSchema.partial();
export const invoiceItemSchema = z.object({
    itemId: z.string().trim().default(""),
    name: z.string().trim().min(1),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    total: z.coerce.number().min(0).optional()
});
export const invoiceCreateSchema = z.object({
    type: invoiceTypeSchema,
    status: invoiceStatusSchema.default("UNPAID"),
    orderId: optionalIdSchema,
    supplierId: optionalIdSchema,
    items: z.array(invoiceItemSchema).min(1),
    discount: z.coerce.number().min(0).default(0),
    tax: z.coerce.number().min(0).default(0),
    serviceCharge: z.coerce.number().min(0).default(0),
    paidAmount: z.coerce.number().min(0).default(0),
    paymentMethod: paymentMethodSchema.default("CASH"),
    dueDate: z.string().trim().default(""),
    notes: z.string().trim().default("")
});
export const invoicePatchSchema = invoiceCreateSchema.partial();
export const paymentCreateSchema = z.object({
    invoiceId: optionalIdSchema,
    orderId: optionalIdSchema,
    supplierId: optionalIdSchema,
    type: invoiceTypeSchema.default("SALE"),
    amount: z.coerce.number().positive(),
    method: paymentMethodSchema.default("CASH"),
    note: z.string().trim().default(""),
    paidAt: z.string().trim().optional()
});
export const expenseCreateSchema = z.object({
    category: z.string().trim().min(1),
    amount: z.coerce.number().positive(),
    paymentMethod: paymentMethodSchema.default("CASH"),
    paidAt: z.string().trim().optional(),
    notes: z.string().trim().default("")
});
export const expensePatchSchema = expenseCreateSchema.partial();
export const cashRegisterCreateSchema = z.object({
    name: z.string().trim().min(1),
    openingBalance: z.coerce.number().min(0).default(0)
});
export const cashMovementCreateSchema = z.object({
    cashRegisterId: optionalIdSchema,
    type: cashMovementTypeSchema,
    amount: z.coerce.number().positive(),
    referenceType: z.string().trim().default("MANUAL"),
    referenceId: z.string().trim().default("manual"),
    note: z.string().trim().default("")
});
export const accountCreateSchema = z.object({
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    type: accountTypeSchema,
    isActive: z.boolean().default(true)
});
export const accountPatchSchema = accountCreateSchema.partial();
export const journalEntryLineSchema = z.object({
    accountId: z.string().trim().min(1),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    memo: z.string().trim().default("")
});
export const journalEntryCreateSchema = z.object({
    status: journalStatusSchema.default("POSTED"),
    referenceType: z.string().trim().default("MANUAL"),
    referenceId: z.string().trim().default("manual"),
    lines: z.array(journalEntryLineSchema).min(2),
    memo: z.string().trim().default("")
});
export const reportQuerySchema = z.object({
    from: z.string().trim().optional(),
    to: z.string().trim().optional()
});
