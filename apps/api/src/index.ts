import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

import { env } from "./lib/env.js";
import { errorBoundary, onError } from "./middleware/error.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { donationRoutes } from "./routes/donations.js";
import { garageRoutes } from "./routes/garage.js";
import { itemRoutes } from "./routes/items.js";
import { loanRoutes } from "./routes/loans.js";
import { meRoutes } from "./routes/me.js";
import { openapiRoutes } from "./routes/openapi.js";
import { reservationRoutes } from "./routes/reservations.js";
import { uploadRoutes } from "./routes/uploads.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import type { AppEnv } from "./lib/types.js";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", errorBoundary());
  app.onError(onError);

  app.get("/v1/health", (c) =>
    c.json({
      status: "ok",
      service: "garageborrow-api",
      stage: env.stage(),
      timestamp: new Date().toISOString(),
      vapid_public_key: env.vapidPublicKey(),
    }),
  );

  app.route("/", openapiRoutes);
  app.route("/", authRoutes);
  app.route("/", meRoutes);
  app.route("/", garageRoutes);
  app.route("/", itemRoutes);
  app.route("/", loanRoutes);
  app.route("/", reservationRoutes);
  app.route("/", waitlistRoutes);
  app.route("/", donationRoutes);
  app.route("/", uploadRoutes);
  app.route("/", adminRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));

  return app;
}

export const app = createApp();
export const handler = handle(app);
