import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { ownerRouter } from "./routes/owner.js";
import { publicRouter } from "./routes/public.js";
import { errorHandler, notFound } from "./middleware/error.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", publicRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/owner", ownerRouter);
  app.use("/api/admin", adminRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
