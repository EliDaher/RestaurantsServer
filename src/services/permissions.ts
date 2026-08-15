import type { Request } from "express";
import type { Permission, UserRole } from "../types.js";
import { HttpError } from "../utils/http.js";

const ownerPermissions: Permission[] = [
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.cancel",
  "pos.access",
  "payments.create",
  "expenses.create",
  "accounting.view",
  "accounting.manage",
  "inventory.view",
  "inventory.adjust",
  "purchasing.manage",
  "tables.manage",
  "reports.view",
  "staff.manage"
];

const rolePermissions: Record<UserRole, Permission[]> = {
  superAdmin: ownerPermissions,
  restaurantOwner: ownerPermissions,
  OWNER: ownerPermissions,
  ADMIN: ownerPermissions,
  MANAGER: ["orders.view", "orders.create", "orders.update", "pos.access", "payments.create", "inventory.view", "tables.manage", "reports.view"],
  CASHIER: ["orders.view", "orders.create", "orders.update", "pos.access", "payments.create"],
  WAITER: ["orders.view", "orders.create", "orders.update", "tables.manage"],
  KITCHEN: ["orders.view", "orders.update"],
  ACCOUNTANT: ["accounting.view", "accounting.manage", "payments.create", "expenses.create", "reports.view"],
  INVENTORY_MANAGER: ["inventory.view", "inventory.adjust", "purchasing.manage", "reports.view"]
};

export function hasPermission(role: UserRole, permission: Permission, explicit: Permission[] = []) {
  return explicit.includes(permission) || (rolePermissions[role] ?? []).includes(permission);
}

export function assertPermission(req: Request, permission: Permission) {
  const user = req.user;
  if (!user || !hasPermission(user.role, permission, user.permissions ?? [])) {
    throw new HttpError(403, `Missing permission: ${permission}`);
  }
}
