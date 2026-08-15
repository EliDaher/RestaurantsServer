import type { Request } from "express";
import type { RestaurantModule } from "../types.js";
import { HttpError } from "../utils/http.js";
import { getRestaurantById } from "./restaurants.js";
import { assertFeature } from "./plans.js";

export function getRequiredTenantId(req: Request) {
  const restaurantId = req.user?.restaurantId;
  if (!restaurantId) {
    throw new HttpError(403, "This account is not linked to a restaurant");
  }

  return restaurantId;
}

export async function getTenantContext(req: Request, feature?: RestaurantModule) {
  const restaurantId = getRequiredTenantId(req);
  const restaurant = await getRestaurantById(restaurantId);

  if (feature) {
    assertFeature(restaurant, feature);
  }

  return { restaurantId, restaurant };
}
