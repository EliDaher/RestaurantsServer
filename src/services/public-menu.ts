import { db } from "../config/firebase.js";
import type { Category, MenuItem, Restaurant } from "../types.js";
import { withId } from "../utils/firestore.js";
import { HttpError } from "../utils/http.js";
import { ReadCache } from "../utils/read-cache.js";
import { publicInvalidation } from "./public-invalidation.js";
import { findRestaurantByDomain, findRestaurantBySlug } from "./restaurants.js";

export const publicLookups = new ReadCache<Restaurant | null>();
export const publicMenus = new ReadCache<{ restaurantId: string; categories: Category[]; items: MenuItem[] }>(86_400_000);
publicInvalidation.on("changed", () => publicLookups.clear());

export async function getPublicRestaurant(identifier: string, domain = false) {
  const key = `${domain ? "domain" : "slug"}:${identifier.toLowerCase()}`;
  const restaurant = await publicLookups.get(key, () => domain ? findRestaurantByDomain(identifier, true) : findRestaurantBySlug(identifier, true));
  if (!restaurant) throw new HttpError(404, "Menu is not available right now");
  return restaurant;
}
export async function getPublicMenu(identifier: string, domain = false) {
  const restaurant = await getPublicRestaurant(identifier, domain);
  const version = (restaurant as Restaurant & { publicMenuVersion?: string }).publicMenuVersion ?? "legacy";
  const menu = await publicMenus.get(`${restaurant.id}:${version}`, async () => {
    const parent = db.collection("restaurants").doc(restaurant.id);
    const [categories, items] = await Promise.all([
      parent.collection("categories").orderBy("order", "asc").get(),
      parent.collection("items").orderBy("order", "asc").get()
    ]);
    return {
      restaurantId: restaurant.id,
      categories: categories.docs.map(d => withId<Category>(d)).filter(c => c.isActive),
      items: items.docs.map(d => withId<MenuItem>(d)).filter(i => i.isAvailable)
    };
  });
  return { restaurant, menu };
}
