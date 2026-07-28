import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  createCategory,
  createItem,
  createRestaurant,
  deleteCategory,
  deleteItem,
  deleteRestaurant,
  addRestaurantPayment,
  listCategories,
  listItems,
  listRestaurants,
  listSubscriptionRequests,
  updateCategory,
  updateItem,
  updateRestaurantDomain,
  updateRestaurant,
  updateRestaurantPlan,
  updateRestaurantSubscription
} from "../services/restaurants.js";
import { uploadImageToCloudinary } from "../services/uploads.js";
import { createUser, listUsers, updateUser } from "../services/users.js";
import { HttpError, sendJson } from "../utils/http.js";
import {
  categoryCreateSchema,
  categoryPatchSchema,
  domainPatchSchema,
  itemCreateSchema,
  itemPatchSchema,
  loginSchema,
  paymentCreateSchema,
  restaurantCreateSchema,
  restaurantPlanPatchSchema,
  restaurantPatchSchema,
  subscriptionPatchSchema,
  uploadImageSchema,
  userCreateSchema,
  userPatchSchema
} from "../validators.js";

export const adminRouter = Router();

adminRouter.post("/login", (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    if (input.email !== env.ADMIN_EMAIL || input.password !== env.ADMIN_PASSWORD) {
      throw new HttpError(401, "Invalid email or password");
    }

    const token = jwt.sign({ email: input.email, role: "superAdmin" }, env.JWT_SECRET, {
      expiresIn: "8h"
    });

    sendJson(res, { token, role: "superAdmin" });
  } catch (error) {
    next(error);
  }
});

adminRouter.use(requireAdmin);

adminRouter.get("/users", async (_req, res, next) => {
  try {
    sendJson(res, await listUsers());
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/users", async (req, res, next) => {
  try {
    const input = userCreateSchema.parse(req.body);
    const created = await createUser(input);
    if (input.role === "restaurantOwner" && input.restaurantId) {
      await updateRestaurant(input.restaurantId, { ownerUserId: created.id });
    }
    sendJson(res, created, 201);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:userId", async (req, res, next) => {
  try {
    const input = userPatchSchema.parse(req.body);
    await updateUser(req.params.userId, input);
    if (input.role === "restaurantOwner" && input.restaurantId) {
      await updateRestaurant(input.restaurantId, { ownerUserId: req.params.userId });
    }
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/restaurants", async (_req, res, next) => {
  try {
    sendJson(res, await listRestaurants());
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/subscription-requests", async (_req, res, next) => {
  try {
    sendJson(res, await listSubscriptionRequests());
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/uploads/image", async (req, res, next) => {
  try {
    const input = uploadImageSchema.parse(req.body);
    sendJson(res, await uploadImageToCloudinary(input), 201);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/restaurants", async (req, res, next) => {
  try {
    const input = restaurantCreateSchema.parse(req.body);
    sendJson(res, await createRestaurant(input), 201);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/restaurants/:restaurantId", async (req, res, next) => {
  try {
    const input = restaurantPatchSchema.parse(req.body);
    await updateRestaurant(req.params.restaurantId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/restaurants/:restaurantId/plan", async (req, res, next) => {
  try {
    const input = restaurantPlanPatchSchema.parse(req.body);
    await updateRestaurantPlan(req.params.restaurantId, input.plan, input.template);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/restaurants/:restaurantId/subscription", async (req, res, next) => {
  try {
    const input = subscriptionPatchSchema.parse(req.body);
    await updateRestaurantSubscription(req.params.restaurantId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/restaurants/:restaurantId/payments", async (req, res, next) => {
  try {
    const input = paymentCreateSchema.parse(req.body);
    sendJson(res, await addRestaurantPayment(req.params.restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/restaurants/:restaurantId/domain", async (req, res, next) => {
  try {
    const input = domainPatchSchema.parse(req.body);
    await updateRestaurantDomain(req.params.restaurantId, input.customDomain, input.customDomainStatus);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/restaurants/:restaurantId", async (req, res, next) => {
  try {
    await deleteRestaurant(req.params.restaurantId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/restaurants/:restaurantId/categories", async (req, res, next) => {
  try {
    sendJson(res, await listCategories(req.params.restaurantId));
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/restaurants/:restaurantId/categories", async (req, res, next) => {
  try {
    const input = categoryCreateSchema.parse(req.body);
    sendJson(res, await createCategory(req.params.restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/restaurants/:restaurantId/categories/:categoryId", async (req, res, next) => {
  try {
    const input = categoryPatchSchema.parse(req.body);
    await updateCategory(req.params.restaurantId, req.params.categoryId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/restaurants/:restaurantId/categories/:categoryId", async (req, res, next) => {
  try {
    await deleteCategory(req.params.restaurantId, req.params.categoryId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/restaurants/:restaurantId/items", async (req, res, next) => {
  try {
    sendJson(res, await listItems(req.params.restaurantId));
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/restaurants/:restaurantId/items", async (req, res, next) => {
  try {
    const input = itemCreateSchema.parse(req.body);
    sendJson(res, await createItem(req.params.restaurantId, input), 201);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/restaurants/:restaurantId/items/:itemId", async (req, res, next) => {
  try {
    const input = itemPatchSchema.parse(req.body);
    await updateItem(req.params.restaurantId, req.params.itemId, input);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/restaurants/:restaurantId/items/:itemId", async (req, res, next) => {
  try {
    await deleteItem(req.params.restaurantId, req.params.itemId);
    sendJson(res, { ok: true });
  } catch (error) {
    next(error);
  }
});
