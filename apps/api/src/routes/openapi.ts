import { Hono } from "hono";
import {
  DonationOfferSchema,
  GarageMembershipSchema,
  GarageSchema,
  IncidentReportSchema,
  InstanceSchema,
  ItemSchema,
  LoanSchema,
  NotificationSchema,
  PushSubscriptionSchema,
  ReservationSchema,
  UserSchema,
  WaitlistEntrySchema,
} from "@garageborrow/shared";
import type { ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { env } from "../lib/env.js";
import type { AppEnv } from "../lib/types.js";

export const openapiRoutes = new Hono<AppEnv>();

const SCHEMAS: Record<string, ZodSchema<unknown>> = {
  User: UserSchema,
  Garage: GarageSchema,
  GarageMembership: GarageMembershipSchema,
  Item: ItemSchema,
  Instance: InstanceSchema,
  Loan: LoanSchema,
  Reservation: ReservationSchema,
  WaitlistEntry: WaitlistEntrySchema,
  DonationOffer: DonationOfferSchema,
  IncidentReport: IncidentReportSchema,
  Notification: NotificationSchema,
  PushSubscription: PushSubscriptionSchema,
};

interface OpenApiPathItem {
  summary: string;
  tags: string[];
  security?: Array<Record<string, string[]>>;
}

const PATHS: Record<string, Record<string, OpenApiPathItem>> = {
  "/v1/health": {
    get: { summary: "Liveness + VAPID public key", tags: ["public"] },
  },
  "/v1/me": {
    get: { summary: "Current user + memberships", tags: ["me"] },
    patch: { summary: "Update user profile", tags: ["me"] },
  },
  "/v1/me/delete-request": {
    post: { summary: "Schedule account deletion", tags: ["me"] },
  },
  "/v1/me/data-export": {
    get: { summary: "Email a JSON data export", tags: ["me"] },
  },
  "/v1/me/push-subscription": {
    post: { summary: "Register a web-push subscription", tags: ["me"] },
  },
  "/v1/me/notifications": {
    get: { summary: "List notifications (last 30 days, paginated)", tags: ["me"] },
  },
  "/v1/me/notifications/{id}/read": {
    post: { summary: "Mark a notification as read", tags: ["me"] },
  },
  "/v1/me/notifications/read-all": {
    post: { summary: "Mark all notifications as read", tags: ["me"] },
  },
  "/v1/auth/resend-otp": {
    post: { summary: "Resend SMS OTP for unconfirmed signup (public)", tags: ["public"] },
  },
  "/v1/g/{garage}": { get: { summary: "Garage profile", tags: ["garage"] } },
  "/v1/g/{garage}/items": {
    get: { summary: "List items (tier-filtered)", tags: ["items"] },
    post: { summary: "Create item (owner only)", tags: ["items"] },
  },
  "/v1/g/{garage}/items/{id}": {
    get: { summary: "Item detail", tags: ["items"] },
    patch: { summary: "Update item (owner only)", tags: ["items"] },
  },
  "/v1/g/{garage}/items/{id}/instances": {
    post: { summary: "Add instance (owner only)", tags: ["items"] },
  },
  "/v1/g/{garage}/items/{id}/instances/{iid}": {
    patch: { summary: "Update instance (owner only)", tags: ["items"] },
  },
  "/v1/g/{garage}/items/{id}/retire": {
    post: { summary: "Retire item (owner only)", tags: ["items"] },
  },
  "/v1/g/{garage}/items/{id}/waitlist": {
    post: { summary: "Join waitlist", tags: ["items"] },
  },
  "/v1/g/{garage}/members": {
    get: { summary: "Public visible-member directory", tags: ["garage"] },
  },
  "/v1/g/{garage}/loans": {
    post: { summary: "Borrow an item", tags: ["loans"] },
  },
  "/v1/g/{garage}/loans/{id}/extend": {
    post: { summary: "Extend a loan", tags: ["loans"] },
  },
  "/v1/g/{garage}/loans/{id}/return": {
    post: { summary: "Mark loan returned", tags: ["loans"] },
  },
  "/v1/g/{garage}/loans/{id}/dispute": {
    post: { summary: "Dispute return claim (owner only)", tags: ["loans"] },
  },
  "/v1/g/{garage}/reservations": {
    post: { summary: "Create reservation", tags: ["reservations"] },
  },
  "/v1/g/{garage}/waitlist/{id}": {
    delete: { summary: "Leave waitlist", tags: ["waitlist"] },
  },
  "/v1/g/{garage}/donations": {
    post: { summary: "Submit a donation offer", tags: ["donations"] },
  },
  "/v1/g/{garage}/donations/mine": {
    get: { summary: "My donation offers", tags: ["donations"] },
  },
  "/v1/g/{garage}/admin/donations": {
    get: { summary: "All donation offers (owner only)", tags: ["admin"] },
  },
  "/v1/g/{garage}/admin/donations/{id}/decide": {
    post: { summary: "Decide on a donation offer (owner only)", tags: ["admin"] },
  },
  "/v1/g/{garage}/admin/members": {
    get: { summary: "List members with stats (owner only)", tags: ["admin"] },
  },
  "/v1/g/{garage}/admin/members/{phone}": {
    patch: { summary: "Update member tier/notes (owner only)", tags: ["admin"] },
  },
  "/v1/g/{garage}/admin/promotion-suggestions": {
    get: { summary: "Promotion suggestions (owner only)", tags: ["admin"] },
  },
  "/v1/g/{garage}/admin/settings": {
    patch: { summary: "Update garage settings (owner only)", tags: ["admin"] },
  },
  "/v1/g/{garage}/incidents": {
    post: { summary: "Log an incident (owner only)", tags: ["admin"] },
  },
  "/v1/uploads/sign": {
    post: { summary: "Presigned PUT for image upload", tags: ["uploads"] },
  },
};

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  components: {
    schemas: Record<string, ReturnType<typeof zodToJsonSchema>>;
    securitySchemes: Record<string, unknown>;
  };
  security: Array<Record<string, string[]>>;
  paths: typeof PATHS;
}

function buildSpec(): OpenApiDoc {
  const components: Record<string, ReturnType<typeof zodToJsonSchema>> = {};
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    components[name] = zodToJsonSchema(schema, { name, target: "openApi3" });
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Garage Borrow API",
      version: "1.0.0",
      description: "Neighborhood gear-lending HTTP API. Phone-only auth via Cognito.",
    },
    servers: [{ url: "/", description: "current host" }],
    components: {
      schemas: components,
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: PATHS,
  };
}

let cachedSpec: OpenApiDoc | undefined;

openapiRoutes.get("/v1/openapi.json", (c) => {
  if (!cachedSpec) cachedSpec = buildSpec();
  return c.json(cachedSpec);
});

openapiRoutes.get("/v1/docs", (c) => {
  // Embeds Scalar's standalone bundle from CDN, pointing at /v1/openapi.json.
  // Lightweight — no dep, no SSR; the JS is fetched from the public Scalar CDN.
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Garage Borrow API — ${env.stage()}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/v1/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
  return c.html(html);
});
