import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "./config/env.js";
import { getUserById } from "./services/users.js";
import { committedChanges } from "./services/realtime.js";
import type { AuthUser } from "./types.js";

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, { cors: { origin: env.CORS_ORIGIN, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const claims = jwt.verify(token, env.JWT_SECRET) as AuthUser & { exp: number };
      const user = claims.id ? await getUserById(claims.id) : null;
      if (!user?.isActive || !user.restaurantId || user.restaurantId !== claims.restaurantId || user.role !== claims.role) throw new Error("Unauthorized");
      if (user.role === "superAdmin") throw new Error("Unauthorized");
      socket.data.tenant = user.restaurantId;
      socket.data.role = user.role;
      socket.data.exp = claims.exp;
      next();
    } catch { next(new Error("Unauthorized")); }
  });
  io.on("connection", socket => {
    void socket.join(`restaurant:${socket.data.tenant}${socket.data.role === "WAITER" ? ":waiter" : ""}`);
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.exp * 1000 - Date.now()));
    socket.on("disconnect", () => clearTimeout(expiry));
  });
  const publish = (event: { tenantId: string; changes: Array<{ entityType: string }>; cursor: number }) => {
    io.to(`restaurant:${event.tenantId}`).emit("sync:changed", event);
    const changes = event.changes.filter(change => ["order", "table"].includes(change.entityType));
    if (changes.length) io.to(`restaurant:${event.tenantId}:waiter`).emit("sync:changed", { ...event, changes });
  };
  committedChanges.on("committed", publish);
  io.on("close", () => committedChanges.off("committed", publish));
  return io;
}
