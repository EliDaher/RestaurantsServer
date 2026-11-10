export function isResourceExhausted(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "").toLowerCase().replaceAll("_", "-");
  return ["8", "resource-exhausted", "firestore/resource-exhausted"].includes(code);
}
export const quotaError = {
  code: "firestore_resource_exhausted",
  message: "خدمة البيانات مشغولة مؤقتاً. حُفظت العمليات المعلقة وستتم إعادة المحاولة.",
  retryable: true
};
