import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { createRestaurant, findRestaurantBySlug, updateRestaurant } from "../services/restaurants.js";
import { authenticateUser, createUser, findUserByEmail, toAuthUser, updateUser } from "../services/users.js";
import { HttpError, sendJson } from "../utils/http.js";
import { loginSchema, signupSchema } from "../validators.js";
export const authRouter = Router();
authRouter.post("/login", async (req, res, next) => {
    try {
        const input = loginSchema.parse(req.body);
        const envAdmin = input.email === env.ADMIN_EMAIL && input.password === env.ADMIN_PASSWORD;
        const authUser = envAdmin
            ? { email: input.email, role: "superAdmin", name: "Super Admin" }
            : toAuthUser(await authenticateUser(input.email, input.password));
        const token = jwt.sign(authUser, env.JWT_SECRET, { expiresIn: "8h" });
        sendJson(res, { token, user: authUser });
    }
    catch (error) {
        next(error);
    }
});
authRouter.post("/signup", async (req, res, next) => {
    try {
        const input = signupSchema.parse(req.body);
        const [existingUser, existingRestaurant] = await Promise.all([
            findUserByEmail(input.email),
            findRestaurantBySlug(input.slug)
        ]);
        if (existingUser) {
            throw new HttpError(409, "User email already exists");
        }
        if (existingRestaurant) {
            throw new HttpError(409, "Restaurant slug already exists");
        }
        const restaurant = await createRestaurant({
            slug: input.slug,
            name: input.restaurantName,
            logo: "",
            coverImage: "",
            description: "",
            phone: input.phone,
            address: input.address,
            currency: "SYP",
            isActive: false,
            plan: input.plan,
            template: input.plan === "premium" ? "premium" : input.plan === "standard" ? "classic" : "minimal",
            theme: {
                primaryColor: "#b45309",
                secondaryColor: "#f59e0b",
                backgroundColor: "#fffaf0",
                textColor: "#1f2937",
                fontStyle: "cairo",
                cardStyle: "soft"
            },
            subscriptionStatus: "pendingApproval",
            billingCycle: input.billingCycle,
            subscriptionStartsAt: "",
            subscriptionEndsAt: "",
            customDomainStatus: "none"
        });
        const user = await createUser({
            name: input.ownerName,
            email: input.email,
            password: input.password,
            role: "restaurantOwner",
            restaurantId: restaurant.id,
            isActive: true
        });
        await Promise.all([
            updateRestaurant(restaurant.id, { ownerUserId: user.id }),
            updateUser(user.id, { restaurantId: restaurant.id })
        ]);
        const authUser = {
            id: user.id,
            email: input.email.toLowerCase(),
            name: input.ownerName,
            role: "restaurantOwner",
            restaurantId: restaurant.id
        };
        const token = jwt.sign(authUser, env.JWT_SECRET, { expiresIn: "8h" });
        sendJson(res, {
            token,
            user: authUser,
            restaurantId: restaurant.id,
            subscriptionStatus: "pendingApproval"
        }, 201);
    }
    catch (error) {
        next(error);
    }
});
authRouter.get("/me", requireAuth, (_req, res) => {
    sendJson(res, _req.user);
});
