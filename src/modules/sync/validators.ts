import { z } from "zod";

const entityTypeSchema = z.enum([
  "table",
  "order",
  "inventoryItem",
  "inventoryTransaction",
  "recipeIngredient",
  "supplier",
  "invoice",
  "payment",
  "expense",
  "cashRegister",
  "cashMovement",
  "account",
  "journalEntry",
  "category",
  "menuItem"
]);

const actionSchema = z.enum(["create", "update", "delete", "completeOrder", "cancelOrder", "adjustInventory", "saveRecipe"]);

export const syncPushSchema = z.object({
  deviceId: z.string().trim().min(1),
  operations: z.array(
    z.object({
      operationId: z.string().trim().min(1),
      entityType: entityTypeSchema,
      entityId: z.string().trim().min(1),
      action: actionSchema,
      payload: z.record(z.unknown()).default({}),
      baseVersion: z.coerce.number().optional(),
      dependencyIds: z.array(z.string().trim()).default([]),
      clientCreatedAt: z.string().trim().default("")
    })
  ).max(50)
});

export const syncPullQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0)
});

export const tableSyncPayloadSchema = z.object({
  name: z.string().trim().min(1),
  area: z.string().trim().default("Main"),
  capacity: z.coerce.number().int().min(1).default(4),
  status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "DISABLED"]).default("AVAILABLE"),
  currentOrderId: z.string().trim().default(""),
  qrCode: z.string().trim().default("")
});
