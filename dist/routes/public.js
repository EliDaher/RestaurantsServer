import { Router } from "express";
import { findRestaurantByDomain, findRestaurantBySlug, listCategories, listItems } from "../services/restaurants.js";
import { HttpError, sendJson } from "../utils/http.js";
export const publicRouter = Router();
publicRouter.get("/restaurants/by-domain", async (req, res, next) => {
    try {
        const host = String(req.query.host ?? "").split(":")[0];
        if (!host) {
            throw new HttpError(400, "Host is required");
        }
        const restaurant = await findRestaurantByDomain(host, true);
        if (!restaurant) {
            throw new HttpError(404, "No active restaurant is linked to this domain");
        }
        const [categories, items] = await Promise.all([
            listCategories(restaurant.id, true),
            listItems(restaurant.id, true)
        ]);
        sendJson(res, { restaurant, menu: { restaurantId: restaurant.id, categories, items } });
    }
    catch (error) {
        next(error);
    }
});
publicRouter.get("/restaurants/:slug", async (req, res, next) => {
    try {
        const restaurant = await findRestaurantBySlug(req.params.slug, true);
        if (!restaurant) {
            throw new HttpError(404, "Menu is not available right now");
        }
        sendJson(res, restaurant);
    }
    catch (error) {
        next(error);
    }
});
publicRouter.get("/restaurants/:slug/menu", async (req, res, next) => {
    try {
        const restaurant = await findRestaurantBySlug(req.params.slug, true);
        if (!restaurant) {
            throw new HttpError(404, "Menu is not available right now");
        }
        const [categories, items] = await Promise.all([
            listCategories(restaurant.id, true),
            listItems(restaurant.id, true)
        ]);
        sendJson(res, { restaurantId: restaurant.id, categories, items });
    }
    catch (error) {
        next(error);
    }
});
