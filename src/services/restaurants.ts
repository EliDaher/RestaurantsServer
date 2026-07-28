import { db, FieldValue } from "../config/firebase.js";
import type { BillingCycle, Category, MenuItem, Restaurant, RestaurantPlan, SubscriptionStatus } from "../types.js";
import { withId } from "../utils/firestore.js";
import { HttpError } from "../utils/http.js";
import {
  assertCategoryLimit,
  assertCustomDomainAllowed,
  assertItemLimit,
  assertTemplateAllowed,
  enforceItemPlanRules,
  normalizeRestaurantPlan,
  normalizeTemplateForPlan
} from "./plans.js";

const restaurants = db.collection("restaurants");
const payments = db.collection("payments");

export async function findRestaurantBySlug(slug: string, activeOnly = false) {
  const snapshot = await restaurants.where("slug", "==", slug).limit(1).get();
  const doc = snapshot.docs[0];
  if (!doc) return null;

  const restaurant = withId<Restaurant>(doc);
  return activeOnly && !isPubliclyAvailable(restaurant) ? null : restaurant;
}

export async function findRestaurantByDomain(host: string, activeOnly = false) {
  const snapshot = await restaurants.where("customDomain", "==", normalizeDomain(host)).limit(1).get();
  const doc = snapshot.docs[0];
  if (!doc) return null;

  const restaurant = withId<Restaurant>(doc);
  if (activeOnly && (!isPubliclyAvailable(restaurant) || restaurant.customDomainStatus !== "verified")) {
    return null;
  }

  return restaurant;
}

export async function assertRestaurantExists(restaurantId: string) {
  const doc = await restaurants.doc(restaurantId).get();
  if (!doc.exists) {
    throw new HttpError(404, "Restaurant not found");
  }
  return doc;
}

export async function getRestaurantById(restaurantId: string) {
  const doc = await assertRestaurantExists(restaurantId);
  return withId<Restaurant>(doc);
}

export async function listRestaurants() {
  const snapshot = await restaurants.orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => withId<Restaurant>(doc));
}

export async function createRestaurant(input: Omit<Restaurant, "id" | "createdAt" | "updatedAt">) {
  const existing = await findRestaurantBySlug(input.slug);
  if (existing) {
    throw new HttpError(409, "Restaurant slug already exists");
  }

  const normalized = normalizeRestaurantPlan(input);
  const ref = await restaurants.add({
    ...normalized,
    subscriptionStatus: normalized.subscriptionStatus ?? "active",
    customDomainStatus: normalized.customDomainStatus ?? "none",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return { id: ref.id };
}

export async function updateRestaurant(restaurantId: string, input: Partial<Restaurant>) {
  const current = await getRestaurantById(restaurantId);

  if (input.slug) {
    const existing = await findRestaurantBySlug(input.slug);
    if (existing && existing.id !== restaurantId) {
      throw new HttpError(409, "Restaurant slug already exists");
    }
  }

  const nextPlan = input.plan ?? current.plan ?? "basic";
  assertTemplateAllowed(nextPlan, input.template);
  if (input.customDomain || input.customDomainStatus === "verified") {
    assertCustomDomainAllowed(nextPlan);
  }

  const updateData = omitUndefined({
    ...input,
    plan: nextPlan,
    template: normalizeTemplateForPlan(nextPlan, input.template ?? current.template),
    updatedAt: FieldValue.serverTimestamp()
  });

  if (input.customDomain !== undefined) {
    updateData.customDomain = input.customDomain ? normalizeDomain(input.customDomain) : input.customDomain;
  }

  await restaurants.doc(restaurantId).update(updateData);
}

export async function updateRestaurantPlan(restaurantId: string, plan: Restaurant["plan"], template?: Restaurant["template"]) {
  const current = await getRestaurantById(restaurantId);
  await restaurants.doc(restaurantId).update({
    plan,
    template: normalizeTemplateForPlan(plan, template ?? current.template),
    updatedAt: FieldValue.serverTimestamp()
  });
}

export async function updateRestaurantSubscription(
  restaurantId: string,
  input: {
    plan?: RestaurantPlan;
    status: SubscriptionStatus;
    billingCycle?: BillingCycle;
    startsAt?: string;
    endsAt?: string;
    notes?: string;
  }
) {
  const current = await getRestaurantById(restaurantId);
  const nextPlan = input.plan ?? current.plan ?? "basic";
  await restaurants.doc(restaurantId).update({
    plan: nextPlan,
    template: normalizeTemplateForPlan(nextPlan, current.template),
    isActive: input.status === "active",
    subscriptionStatus: input.status,
    billingCycle: input.billingCycle ?? current.billingCycle ?? "monthly",
    subscriptionStartsAt: input.startsAt ?? current.subscriptionStartsAt ?? new Date().toISOString(),
    subscriptionEndsAt: input.endsAt ?? current.subscriptionEndsAt ?? "",
    subscriptionNotes: input.notes ?? "",
    updatedAt: FieldValue.serverTimestamp()
  });
}

export async function addRestaurantPayment(
  restaurantId: string,
  input: {
    amount: number;
    currency: string;
    billingCycle: BillingCycle;
    paidAt?: string;
    extendMonths: number;
    notes: string;
  }
) {
  const restaurant = await getRestaurantById(restaurantId);
  const paidAt = input.paidAt ?? new Date().toISOString();
  const baseDate = restaurant.subscriptionEndsAt ? new Date(restaurant.subscriptionEndsAt) : new Date();
  const extensionBase = Number.isNaN(baseDate.getTime()) || baseDate < new Date() ? new Date() : baseDate;
  extensionBase.setMonth(extensionBase.getMonth() + input.extendMonths);
  const endsAt = extensionBase.toISOString();

  const ref = await payments.add({
    restaurantId,
    amount: input.amount,
    currency: input.currency,
    billingCycle: input.billingCycle,
    paidAt,
    notes: input.notes,
    createdAt: FieldValue.serverTimestamp()
  });

  await updateRestaurantSubscription(restaurantId, {
    status: "active",
    plan: restaurant.plan,
    billingCycle: input.billingCycle,
    startsAt: restaurant.subscriptionStartsAt ?? paidAt,
    endsAt,
    notes: restaurant.subscriptionNotes ?? ""
  });

  await restaurants.doc(restaurantId).update({
    lastPaymentAt: paidAt,
    updatedAt: FieldValue.serverTimestamp()
  });

  return { id: ref.id, endsAt };
}

export async function updateRestaurantDomain(restaurantId: string, customDomain: string | undefined, customDomainStatus: Restaurant["customDomainStatus"]) {
  const restaurant = await getRestaurantById(restaurantId);
  if (customDomain || customDomainStatus === "verified") {
    assertCustomDomainAllowed(restaurant.plan ?? "basic");
  }

  await restaurants.doc(restaurantId).update({
    customDomain: customDomain ? normalizeDomain(customDomain) : "",
    customDomainStatus: customDomainStatus ?? "none",
    customDomainVerifiedAt: customDomainStatus === "verified" ? new Date().toISOString() : "",
    updatedAt: FieldValue.serverTimestamp()
  });
}

export async function listSubscriptionRequests() {
  const snapshot = await restaurants.where("subscriptionStatus", "in", ["pendingApproval", "pastDue", "suspended"]).get();
  return snapshot.docs.map((doc) => withId<Restaurant>(doc));
}

export async function deleteRestaurant(restaurantId: string) {
  await assertRestaurantExists(restaurantId);
  await restaurants.doc(restaurantId).delete();
}

export async function listCategories(restaurantId: string, activeOnly = false) {
  await assertRestaurantExists(restaurantId);
  const snapshot = await restaurants.doc(restaurantId).collection("categories").orderBy("order", "asc").get();
  const categories = snapshot.docs.map((doc) => withId<Category>(doc));
  return activeOnly ? categories.filter((category) => category.isActive) : categories;
}

export async function createCategory(restaurantId: string, input: Omit<Category, "id">) {
  const restaurant = await getRestaurantById(restaurantId);
  const snapshot = await restaurants.doc(restaurantId).collection("categories").get();
  assertCategoryLimit(restaurant.plan ?? "basic", snapshot.size);
  const ref = await restaurants.doc(restaurantId).collection("categories").add(input);
  return { id: ref.id };
}

export async function updateCategory(restaurantId: string, categoryId: string, input: Partial<Category>) {
  await assertRestaurantExists(restaurantId);
  await restaurants.doc(restaurantId).collection("categories").doc(categoryId).update(input);
}

export async function deleteCategory(restaurantId: string, categoryId: string) {
  await assertRestaurantExists(restaurantId);
  await restaurants.doc(restaurantId).collection("categories").doc(categoryId).delete();
}

export async function listItems(restaurantId: string, availableOnly = false) {
  await assertRestaurantExists(restaurantId);
  const snapshot = await restaurants.doc(restaurantId).collection("items").orderBy("order", "asc").get();
  const items = snapshot.docs.map((doc) => withId<MenuItem>(doc));
  return availableOnly ? items.filter((item) => item.isAvailable) : items;
}

export async function createItem(restaurantId: string, input: Omit<MenuItem, "id" | "createdAt" | "updatedAt">) {
  const restaurant = await getRestaurantById(restaurantId);
  const snapshot = await restaurants.doc(restaurantId).collection("items").get();
  assertItemLimit(restaurant.plan ?? "basic", snapshot.size);
  const normalized = enforceItemPlanRules(restaurant.plan ?? "basic", input, true);
  const ref = await restaurants.doc(restaurantId).collection("items").add({
    ...normalized,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { id: ref.id };
}

export async function updateItem(restaurantId: string, itemId: string, input: Partial<MenuItem>) {
  const restaurant = await getRestaurantById(restaurantId);
  const normalized = enforceItemPlanRules(restaurant.plan ?? "basic", input, true);
  await restaurants.doc(restaurantId).collection("items").doc(itemId).update({
    ...normalized,
    updatedAt: FieldValue.serverTimestamp()
  });
}

export async function deleteItem(restaurantId: string, itemId: string) {
  await assertRestaurantExists(restaurantId);
  await restaurants.doc(restaurantId).collection("items").doc(itemId).delete();
}

function isPubliclyAvailable(restaurant: Restaurant) {
  return restaurant.isActive && (restaurant.subscriptionStatus ?? "active") === "active";
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Partial<T>;
}

