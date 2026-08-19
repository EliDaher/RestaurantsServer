import { Router } from "express";
import type { Request } from "express";
import { requireOwner } from "../middleware/auth.js";
import { restaurantOpsRouter } from "../modules/restaurant-ops/routes.js";
import { syncRouter } from "../modules/sync/routes.js";
import {
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  getRestaurantById,
  listCategories,
  listItems,
  updateCategory,
  updateItem,
  updateRestaurant
} from "../services/restaurants.js";
import { planLimits } from "../services/plans.js";
import { sendReceiptCutCommand } from "../services/receipt-printer.js";
import { uploadImageToCloudinary } from "../services/uploads.js";
import { HttpError, sendJson } from "../utils/http.js";
import {
  categoryCreateSchema,
  categoryPatchSchema,
  itemCreateSchema,
  itemPatchSchema,
  ownerRestaurantPatchSchema,
  ownerThemePatchSchema,
  uploadImageSchema
} from "../validators.js";

export const ownerRouter = Router();

ownerRouter.use(requireOwner);
ownerRouter.use("/ops", restaurantOpsRouter);
ownerRouter.use("/sync", syncRouter);

ownerRouter.get("/restaurant", async (req, res, next) => {
  try {
    sendJson(res, await getOwnerRestaurantId(req));
  } catch (error) {
    next(error);
  }
});

ownerRouter.patch("/restaurant", async (req, res, next) => {
  try {
    const restaurantId = getRequiredRestaurantId(req);
    const input = ownerRestaurantPatchSchema.parse(req.body);
    await updateRestaurant(restaurantId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

ownerRouter.patch("/restaurant/theme", async (req, res, next) => {
  try {
    const restaurantId = getRequiredRestaurantId(req);
    const input = ownerThemePatchSchema.parse(req.body);
    await updateRestaurant(restaurantId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

ownerRouter.post("/receipt-printer/cut", async (req, res, next) => {
  try {
    const restaurant = await getRestaurantById(getRequiredRestaurantId(req));
    await sendReceiptCutCommand({
      host: restaurant.receiptPrinterIp,
      port: restaurant.receiptPrinterPort
    });
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

ownerRouter.get("/subscription", async (req, res, next) => {
  try {
    const restaurantId = getRequiredRestaurantId(req);
    const [restaurant, categories, items] = await Promise.all([
      getRestaurantById(restaurantId),
      listCategories(restaurantId),
      listItems(restaurantId)
    ]);
    const limits = planLimits[restaurant.plan ?? "basic"];

    sendJson(res, {
      plan: restaurant.plan,
      status: restaurant.subscriptionStatus ?? "active",
      billingCycle: restaurant.billingCycle ?? "monthly",
      endsAt: restaurant.subscriptionEndsAt ?? "",
      lastPaymentAt: restaurant.lastPaymentAt ?? "",
      limits,
      usage: {
        categories: categories.length,
        items: items.length
      },
      customDomain: restaurant.customDomain ?? "",
      customDomainStatus: restaurant.customDomainStatus ?? "none"
    });
  } catch (error) {
    next(error);
  }
});

ownerRouter.post("/uploads/image", async (req, res, next) => {
  try {
    const input = uploadImageSchema.parse(req.body);
    sendJson(res, await uploadImageToCloudinary(input), 201);
  } catch (error) {
    next(error);
  }
});

ownerRouter.get("/categories", async (req, res, next) => {
  try {
    sendJson(res, await listCategories(getRequiredRestaurantId(req)));
  } catch (error) {
    next(error);
  }
});

ownerRouter.post("/categories", async (req, res, next) => {
  try {
    const input = categoryCreateSchema.parse(req.body);
    sendJson(res, await createCategory(getRequiredRestaurantId(req), input), 201);
  } catch (error) {
    next(error);
  }
});

ownerRouter.patch("/categories/:categoryId", async (req, res, next) => {
  try {
    const input = categoryPatchSchema.parse(req.body);
    await updateCategory(getRequiredRestaurantId(req), req.params.categoryId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

ownerRouter.delete("/categories/:categoryId", async (req, res, next) => {
  try {
    await deleteCategory(getRequiredRestaurantId(req), req.params.categoryId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

ownerRouter.get("/items", async (req, res, next) => {
  try {
    sendJson(res, await listItems(getRequiredRestaurantId(req)));
  } catch (error) {
    next(error);
  }
});

ownerRouter.post("/items", async (req, res, next) => {
  try {
    const input = itemCreateSchema.parse(req.body);
    sendJson(res, await createItem(getRequiredRestaurantId(req), input), 201);
  } catch (error) {
    next(error);
  }
});

ownerRouter.patch("/items/:itemId", async (req, res, next) => {
  try {
    const input = itemPatchSchema.parse(req.body);
    await updateItem(getRequiredRestaurantId(req), req.params.itemId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

ownerRouter.delete("/items/:itemId", async (req, res, next) => {
  try {
    await deleteItem(getRequiredRestaurantId(req), req.params.itemId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

function getRequiredRestaurantId(req: Request) {
  const restaurantId = req.user?.restaurantId;
  if (!restaurantId) {
    throw new HttpError(403, "This owner account is not linked to a restaurant");
  }

  return restaurantId;
}

async function getOwnerRestaurantId(req: Request) {
  return getRestaurantById(getRequiredRestaurantId(req));
}
