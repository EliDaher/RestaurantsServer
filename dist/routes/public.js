import { Router } from "express";
import { getPublicMenu, getPublicRestaurant } from "../services/public-menu.js";
import { HttpError, sendJson } from "../utils/http.js";
export const publicRouter = Router();
// No browser/CDN cache: the server owns the entire 15-second freshness budget.
publicRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
publicRouter.get("/restaurants/by-domain", async (req, res, next) => {
    try {
        const host = String(req.query.host ?? "").split(":")[0];
        if (!host)
            throw new HttpError(400, "Host is required");
        sendJson(res, await getPublicMenu(host, true));
    }
    catch (error) {
        next(error);
    }
});
publicRouter.get("/restaurants/:slug/bundle", async (req, res, next) => {
    try {
        sendJson(res, await getPublicMenu(req.params.slug));
    }
    catch (error) {
        next(error);
    }
});
publicRouter.get("/restaurants/:slug/menu", async (req, res, next) => {
    try {
        sendJson(res, (await getPublicMenu(req.params.slug)).menu);
    }
    catch (error) {
        next(error);
    }
});
publicRouter.get("/restaurants/:slug", async (req, res, next) => {
    try {
        sendJson(res, await getPublicRestaurant(req.params.slug));
    }
    catch (error) {
        next(error);
    }
});
