import { assertPaymentContext } from "./payment-context.js";
import { db } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import { normalizeSettlement } from "../../utils/payments.js";
export async function prepareExpenseArtifacts(tx, restaurantId, id, input, userId, now) {
    await assertPaymentContext(tx, restaurantId, input);
    const settlement = input.payments !== undefined ? normalizeSettlement(input.amount, input.settlementMode ?? "FULL", input.payments) : null;
    const rows = settlement?.payments ?? [{ amount: input.amount, method: input.paymentMethod, cashRegisterId: input.cashRegisterId ?? "", ...(input.currency ? { currency: input.currency, originalAmount: input.originalAmount, exchangeRate: input.exchangeRate } : {}) }];
    const records = [];
    const registers = new Map();
    for (const [index, row] of rows.entries()) {
        if (row.cashRegisterId) {
            let register = registers.get(row.cashRegisterId);
            if (!register) {
                const snap = await tx.get(db.collection("restaurants").doc(restaurantId).collection("cashRegisters").doc(row.cashRegisterId));
                if (!snap.exists)
                    throw new HttpError(404, "الصندوق غير موجود.");
                register = { ...snap.data(), id: snap.id };
            }
            registers.set(row.cashRegisterId, { ...register, currentBalance: register.currentBalance - row.amount });
        }
        records.push({ entityType: "cashMovement", collection: "cashMovements", id: `expense_${id}_${index}`, data: { ...row, restaurantId, type: "OUT", referenceType: "EXPENSE", referenceId: id, note: input.notes, createdById: userId, createdAt: now } });
    }
    registers.forEach((register, id) => records.push({ entityType: "cashRegister", collection: "cashRegisters", id, data: { ...register, updatedAt: now } }));
    const paidAmount = settlement?.paidAmount ?? input.amount;
    const remainingAmount = input.amount - paidAmount;
    records.push({ entityType: "journalEntry", collection: "journalEntries", id: `expense_${id}`, data: { restaurantId, status: "POSTED", referenceType: "EXPENSE", referenceId: id, lines: [{ accountId: "expenses", debit: input.amount, credit: 0, memo: input.notes }, ...(paidAmount ? [{ accountId: "cash", debit: 0, credit: paidAmount, memo: input.notes }] : []), ...(remainingAmount ? [{ accountId: "accounts_payable", debit: 0, credit: remainingAmount, memo: input.notes }] : [])], memo: input.notes, createdById: userId, postedAt: now, createdAt: now, updatedAt: now } });
    return { records, metadata: settlement ? { payments: settlement.payments, settlementMode: input.settlementMode ?? "FULL", paidAmount, remainingAmount } : {} };
}
