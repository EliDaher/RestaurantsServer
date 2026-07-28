import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";
export function requireAuth(req, _res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
        return next(new HttpError(401, "Missing bearer token"));
    }
    try {
        req.user = jwt.verify(token, env.JWT_SECRET);
        return next();
    }
    catch {
        return next(new HttpError(401, "Invalid or expired token"));
    }
}
export function requireRole(...roles) {
    return (req, res, next) => {
        requireAuth(req, res, (error) => {
            if (error) {
                return next(error);
            }
            if (!req.user || !roles.includes(req.user.role)) {
                return next(new HttpError(403, "You do not have permission to access this route"));
            }
            return next();
        });
    };
}
export const requireAdmin = requireRole("superAdmin");
export const requireOwner = requireRole("restaurantOwner");
