export function isResourceExhausted(error) {
    if (!error || typeof error !== "object")
        return false;
    const code = String(error.code ?? "").toLowerCase().replaceAll("_", "-");
    return ["8", "resource-exhausted", "firestore/resource-exhausted"].includes(code);
}
export const quotaError = {
    code: "firestore_resource_exhausted",
    message: "خدمة البيانات مشغولة مؤقتاً. حُفظت العمليات المعلقة وستتم إعادة المحاولة.",
    retryable: true
};
export function isTransientFirestoreError(error) {
    if (!error || typeof error !== "object")
        return false;
    const code = String(error.code ?? "").toLowerCase().replaceAll("_", "-").replace(/^firestore\//, "");
    return ["4", "10", "13", "14", "deadline-exceeded", "aborted", "internal", "unavailable", "econnreset", "etimedout", "eai-again"].includes(code);
}
