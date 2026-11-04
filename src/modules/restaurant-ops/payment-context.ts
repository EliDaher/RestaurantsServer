import { db } from "../../config/firebase.js";
import { HttpError } from "../../utils/http.js";
import type { PaymentPart, MoneyInput } from "../../utils/payments.js";
import type { Restaurant } from "../../types.js";
export async function assertPaymentContext(tx: FirebaseFirestore.Transaction, restaurantId: string, input: { payments?: PaymentPart[] } & Partial<MoneyInput>, sourceCurrency?: string) {
  if (!input.payments && !input.currency) return;
  const snapshot = await tx.get(db.collection("restaurants").doc(restaurantId));
  const restaurant = snapshot.data() as Restaurant | undefined;
  if (!restaurant) throw new HttpError(404, "المطعم غير موجود.");
  if ((sourceCurrency ?? restaurant.currency) !== "SYP") throw new HttpError(400, "التعاملات الجديدة بالعملتين تتطلب حساباً بالليرة السورية.");
  if ((input.currency === "USD" || input.payments?.some(row => row.currency === "USD")) && !restaurant.usdExchangeRate) throw new HttpError(400, "احفظ سعر صرف موجباً أولاً.");
}
