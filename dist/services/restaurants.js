import { oncePerRequest } from "../utils/request-context.js";
import { runLoggedTransaction } from "../modules/sync/logged-transaction.js";
import { db, FieldValue } from "../config/firebase.js";
import { withId } from "../utils/firestore.js";
import { HttpError } from "../utils/http.js";
import { assertCategoryLimit, assertCustomDomainAllowed, assertItemLimit, assertTemplateAllowed, enforceItemPlanRules, normalizeModules, normalizeRestaurantPlan, normalizeTemplateForPlan } from "./plans.js";
const restaurants = db.collection("restaurants");
const payments = db.collection("payments");
export async function findRestaurantBySlug(slug, activeOnly = false) {
    const snapshot = await restaurants.where("slug", "==", slug).limit(1).get();
    const doc = snapshot.docs[0];
    if (!doc)
        return null;
    const restaurant = withId(doc);
    return activeOnly && !isPubliclyAvailable(restaurant) ? null : restaurant;
}
export async function findRestaurantByDomain(host, activeOnly = false) {
    const snapshot = await restaurants.where("customDomain", "==", normalizeDomain(host)).limit(1).get();
    const doc = snapshot.docs[0];
    if (!doc)
        return null;
    const restaurant = withId(doc);
    if (activeOnly && (!isPubliclyAvailable(restaurant) || restaurant.customDomainStatus !== "verified")) {
        return null;
    }
    return restaurant;
}
export async function assertRestaurantExists(restaurantId) {
    const doc = await oncePerRequest(`restaurant:${restaurantId}`, () => restaurants.doc(restaurantId).get());
    if (!doc.exists) {
        throw new HttpError(404, "Restaurant not found");
    }
    return doc;
}
export async function getRestaurantById(restaurantId) {
    const doc = await assertRestaurantExists(restaurantId);
    return withId(doc);
}
export async function listRestaurants() {
    const snapshot = await restaurants.orderBy("createdAt", "desc").get();
    return snapshot.docs.map((doc) => withId(doc));
}
export async function createRestaurant(input) {
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
export async function updateRestaurant(restaurantId, input) {
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
        modules: input.modules ? normalizeModules(nextPlan, input.modules) : current.modules,
        updatedAt: FieldValue.serverTimestamp()
    });
    if (input.customDomain !== undefined) {
        updateData.customDomain = input.customDomain ? normalizeDomain(input.customDomain) : input.customDomain;
    }
    await runLoggedTransaction(db, async (tx) => { tx.update(restaurants.doc(restaurantId), updateData); });
}
export async function updateRestaurantPlan(restaurantId, plan, template) {
    const current = await getRestaurantById(restaurantId);
    await runLoggedTransaction(db, async (tx) => {
        tx.update(restaurants.doc(restaurantId), {
            plan,
            template: normalizeTemplateForPlan(plan, template ?? current.template),
            modules: normalizeModules(plan, current.modules),
            updatedAt: FieldValue.serverTimestamp()
        });
    });
}
export async function updateRestaurantSubscription(restaurantId, input) {
    const current = await getRestaurantById(restaurantId);
    const nextPlan = input.plan ?? current.plan ?? "basic";
    await runLoggedTransaction(db, async (tx) => {
        tx.update(restaurants.doc(restaurantId), {
            plan: nextPlan,
            template: normalizeTemplateForPlan(nextPlan, current.template),
            modules: normalizeModules(nextPlan, current.modules),
            isActive: input.status === "active",
            subscriptionStatus: input.status,
            billingCycle: input.billingCycle ?? current.billingCycle ?? "monthly",
            subscriptionStartsAt: input.startsAt ?? current.subscriptionStartsAt ?? new Date().toISOString(),
            subscriptionEndsAt: input.endsAt ?? current.subscriptionEndsAt ?? "",
            subscriptionNotes: input.notes ?? "",
            updatedAt: FieldValue.serverTimestamp()
        });
    });
}
export async function addRestaurantPayment(restaurantId, input) {
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
    await runLoggedTransaction(db, async (tx) => {
        tx.update(restaurants.doc(restaurantId), {
            lastPaymentAt: paidAt,
            updatedAt: FieldValue.serverTimestamp()
        });
    });
    return { id: ref.id, endsAt };
}
export async function updateRestaurantDomain(restaurantId, customDomain, customDomainStatus) {
    const restaurant = await getRestaurantById(restaurantId);
    if (customDomain || customDomainStatus === "verified") {
        assertCustomDomainAllowed(restaurant.plan ?? "basic");
    }
    await runLoggedTransaction(db, async (tx) => {
        tx.update(restaurants.doc(restaurantId), {
            customDomain: customDomain ? normalizeDomain(customDomain) : "",
            customDomainStatus: customDomainStatus ?? "none",
            customDomainVerifiedAt: customDomainStatus === "verified" ? new Date().toISOString() : "",
            updatedAt: FieldValue.serverTimestamp()
        });
    });
}
export async function listSubscriptionRequests() {
    const snapshot = await restaurants.where("subscriptionStatus", "in", ["pendingApproval", "pastDue", "suspended"]).get();
    return snapshot.docs.map((doc) => withId(doc));
}
export async function deleteRestaurant(restaurantId) {
    await assertRestaurantExists(restaurantId);
    await runLoggedTransaction(db, async (tx) => { tx.delete(restaurants.doc(restaurantId)); });
}
export async function listCategories(restaurantId, activeOnly = false) {
    await assertRestaurantExists(restaurantId);
    const snapshot = await restaurants.doc(restaurantId).collection("categories").orderBy("order", "asc").get();
    const categories = snapshot.docs.map((doc) => withId(doc));
    return activeOnly ? categories.filter((category) => category.isActive) : categories;
}
export async function createCategory(restaurantId, input) {
    return createCountedMenuRecord(restaurantId, "categories", input);
}
export async function updateCategory(restaurantId, categoryId, input) {
    await assertRestaurantExists(restaurantId);
    await runLoggedTransaction(db, async (tx) => { tx.update(restaurants.doc(restaurantId).collection("categories").doc(categoryId), input); });
}
export async function deleteCategory(restaurantId, categoryId) {
    await deleteCountedMenuRecord(restaurantId, "categories", categoryId);
}
export async function listItems(restaurantId, availableOnly = false) {
    await assertRestaurantExists(restaurantId);
    const snapshot = await restaurants.doc(restaurantId).collection("items").orderBy("order", "asc").get();
    const items = snapshot.docs.map((doc) => withId(doc));
    return availableOnly ? items.filter((item) => item.isAvailable) : items;
}
export async function createItem(restaurantId, input) {
    const restaurant = await getRestaurantById(restaurantId);
    return createCountedMenuRecord(restaurantId, "items", enforceItemPlanRules(restaurant.plan ?? "basic", input, true));
}
export async function updateItem(restaurantId, itemId, input) {
    const restaurant = await getRestaurantById(restaurantId);
    const normalized = enforceItemPlanRules(restaurant.plan ?? "basic", input, true);
    await runLoggedTransaction(db, async (tx) => { tx.update(restaurants.doc(restaurantId).collection("items").doc(itemId), { ...normalized, updatedAt: FieldValue.serverTimestamp() }); });
}
export async function deleteItem(restaurantId, itemId) {
    await deleteCountedMenuRecord(restaurantId, "items", itemId);
}
// Initialized in the same transaction as the first mutation. All writers use it.
async function menuCount(tx, restaurantId, collection) {
    const parent = restaurants.doc(restaurantId);
    const ref = parent.collection("usageMeta").doc(collection);
    const counter = await tx.get(ref);
    if (counter.exists && counter.data()?.schemaVersion === 1)
        return { ref, count: Number(counter.data().count), initialized: true };
    const snapshot = await tx.get(parent.collection(collection));
    return { ref, count: snapshot.size, initialized: false };
}
async function createCountedMenuRecord(restaurantId, collection, input) {
    const parent = restaurants.doc(restaurantId);
    const ref = parent.collection(collection).doc();
    await runLoggedTransaction(db, async (tx) => {
        const restaurant = (await tx.get(parent)).data();
        if (!restaurant)
            throw new HttpError(404, "Restaurant not found");
        const counter = await menuCount(tx, restaurantId, collection);
        if (collection === "items")
            assertItemLimit(restaurant.plan ?? "basic", counter.count);
        else
            assertCategoryLimit(restaurant.plan ?? "basic", counter.count);
        const data = collection === "items" ? enforceItemPlanRules(restaurant.plan ?? "basic", input, true) : input;
        tx.set(ref, { ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        tx.set(counter.ref, { count: counter.count + 1, schemaVersion: 1 });
    });
    return { id: ref.id };
}
async function deleteCountedMenuRecord(restaurantId, collection, id) {
    const ref = restaurants.doc(restaurantId).collection(collection).doc(id);
    await runLoggedTransaction(db, async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists)
            return;
        const counter = await menuCount(tx, restaurantId, collection);
        tx.delete(ref);
        tx.set(counter.ref, { count: Math.max(0, counter.count - 1), schemaVersion: 1 });
    });
}
function isPubliclyAvailable(restaurant) {
    return restaurant.isActive && (restaurant.subscriptionStatus ?? "active") === "active";
}
function normalizeDomain(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "");
}
function omitUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined));
}
export async function getMenuUsage(restaurantId) {
    return db.runTransaction(async (tx) => {
        const [categories, items] = await Promise.all([menuCount(tx, restaurantId, "categories"), menuCount(tx, restaurantId, "items")]);
        if (!categories.initialized)
            tx.set(categories.ref, { count: categories.count, schemaVersion: 1 });
        if (!items.initialized)
            tx.set(items.ref, { count: items.count, schemaVersion: 1 });
        return { categories: categories.count, items: items.count };
    });
}
