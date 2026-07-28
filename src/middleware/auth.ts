import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";
import type { AuthUser, UserRole } from "../types.js";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    return next(new HttpError(401, "Missing bearer token"));
  }

  try {
    req.user = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    return next();
  } catch {
    return next(new HttpError(401, "Invalid or expired token"));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, (error?: unknown) => {
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
