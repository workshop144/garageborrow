import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { z } from "zod";

import { mustUser } from "../lib/ctx.js";
import { env } from "../lib/env.js";
import { newId } from "../lib/ids.js";
import { s3 } from "../lib/s3.js";
import type { AppEnv } from "../lib/types.js";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";

export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.use("/v1/uploads/sign", requireAuth(), idempotency());

// A phone photo is a few MB; this is generous. The exact size is signed into the
// URL (Content-Length), so S3 refuses any body of another size: without it a signed
// URL accepted up to S3's 5 GB single-PUT limit at the operator's expense.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const SignSchema = z.object({
  kind: z.enum(["tool_photo", "donation_photo", "wishlist_photo"]),
  content_type: z.string().regex(/^image\/(png|jpe?g|webp|heic|heif)$/i),
  content_length: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

uploadRoutes.post("/v1/uploads/sign", async (c) => {
  const user = mustUser(c);
  const body = SignSchema.parse(await c.req.json());
  const ext = body.content_type.split("/")[1] ?? "bin";
  const key = `uploads/${body.kind}/${user.phone.replace("+", "")}/${newId()}.${ext}`;
  const cmd = new PutObjectCommand({
    Bucket: env.imagesBucket(),
    Key: key,
    ContentType: body.content_type,
    ContentLength: body.content_length,
  });
  const url = await getSignedUrl(s3(), cmd, {
    expiresIn: 300,
    signableHeaders: new Set(["content-length", "content-type"]),
  });
  return c.json({ url, key, expires_in: 300 });
});
