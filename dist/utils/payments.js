export class PaymentValidationError extends Error {
}
export function normalizePayment(part) {
    if (!["CASH", "SHAM_CASH"].includes(part.method))
        throw new PaymentValidationError("اختر نقداً أو شام كاش.");
    if (!["SYP", "USD"].includes(part.currency))
        throw new PaymentValidationError("العملة غير مدعومة.");
    if (!Number.isFinite(part.originalAmount) || part.originalAmount <= 0)
        throw new PaymentValidationError("أدخل مبلغاً موجباً للدفعة.");
    const precision = part.currency === "USD" ? 100 : 1;
    if (Math.abs(part.originalAmount * precision - Math.round(part.originalAmount * precision)) > 0.000001)
        throw new PaymentValidationError("تحقق من دقة مبلغ الدفعة.");
    const exchangeRate = part.currency === "SYP" ? 1 : part.exchangeRate;
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0)
        throw new PaymentValidationError("احفظ سعر صرف موجباً قبل الدفع بالدولار.");
    const amount = Math.round(part.originalAmount * exchangeRate);
    if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new PaymentValidationError("قيمة الدفعة غير صالحة.");
    return { ...part, exchangeRate, amount };
}
export function normalizeSettlement(total, mode, parts) {
    if (!Number.isFinite(total) || total < 0 || total > Number.MAX_SAFE_INTEGER)
        throw new PaymentValidationError("إجمالي المستحق غير صالح.");
    if (!["FULL", "DEBT", "PARTIAL"].includes(mode))
        throw new PaymentValidationError("اختر حالة السداد.");
    if (parts.length > 30)
        throw new PaymentValidationError("الحد الأقصى 30 دفعة.");
    const payments = parts.map(normalizePayment);
    const paidAmount = payments.reduce((sum, part) => sum + part.amount, 0);
    if (paidAmount > total)
        throw new PaymentValidationError("المبلغ المدفوع أكبر من المستحق.");
    if (mode === "DEBT" && payments.length)
        throw new PaymentValidationError("الدين لا يتضمن دفعات.");
    if (mode === "FULL" && paidAmount !== total)
        throw new PaymentValidationError("السداد الكامل يتطلب تغطية الإجمالي.");
    if (mode === "PARTIAL" && (paidAmount <= 0 || paidAmount >= total))
        throw new PaymentValidationError("السداد الجزئي يجب أن يكون أكبر من صفر وأقل من المستحق.");
    return { payments, paidAmount, remainingAmount: total - paidAmount };
}
export function normalizeMoney(input) {
    if (!Number.isFinite(input.amount) || input.amount <= 0)
        throw new PaymentValidationError("أدخل مبلغاً موجباً وصالحاً.");
    if (!input.currency)
        return input;
    const payment = normalizePayment({ method: "CASH", cashRegisterId: "", currency: input.currency, originalAmount: input.originalAmount ?? input.amount, exchangeRate: input.exchangeRate ?? 0 });
    return { ...input, currency: payment.currency, originalAmount: payment.originalAmount, exchangeRate: payment.exchangeRate, amount: payment.amount };
}
