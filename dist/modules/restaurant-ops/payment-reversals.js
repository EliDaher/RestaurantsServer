import { db } from "../../config/firebase.js";
export async function preparePaymentReversals(tx, restaurantId, orderId, userId, reason, now) {
    const scoped = (name) => db.collection("restaurants").doc(restaurantId).collection(name);
    const snapshot = await tx.get(scoped("payments").where("orderId", "==", orderId));
    const payments = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.type === "SALE");
    const records = [];
    const registers = new Map();
    for (const [index, payment] of payments.entries()) {
        const movementSnapshot = await tx.get(scoped("cashMovements").doc(payment.id));
        const movement = movementSnapshot.data();
        const row = { amount: payment.amount, method: payment.method, ...(payment.currency ? { currency: payment.currency, originalAmount: payment.originalAmount, exchangeRate: payment.exchangeRate } : {}) };
        const id = index === 0 ? `cancel_order_${orderId}` : `cancel_order_${orderId}_${index}`;
        records.push({ entityType: "cashMovement", collection: "cashMovements", id, data: { ...row, restaurantId, cashRegisterId: movement?.cashRegisterId ?? "", type: "OUT", referenceType: "ORDER_CANCEL", referenceId: orderId, note: reason, createdById: userId, createdAt: now } });
        records.push({ entityType: "payment", collection: "payments", id, data: { ...row, restaurantId, orderId, invoiceId: `refund_order_${orderId}`, supplierId: "", type: "REFUND", note: reason, paidAt: now, createdById: userId, createdAt: now } });
        if (movement?.cashRegisterId) {
            const registerId = String(movement.cashRegisterId);
            let register = registers.get(registerId);
            if (!register) {
                const snap = await tx.get(scoped("cashRegisters").doc(registerId));
                if (!snap.exists)
                    continue;
                register = { ...snap.data(), id: snap.id };
            }
            registers.set(registerId, { ...register, currentBalance: register.currentBalance - payment.amount, updatedAt: now });
        }
    }
    registers.forEach((register, id) => records.push({ entityType: "cashRegister", collection: "cashRegisters", id, data: register }));
    return records;
}
