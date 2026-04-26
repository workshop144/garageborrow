import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

const app = new Hono();

app.get("/v1/health", (c) =>
  c.json({
    status: "ok",
    service: "garageborrow-api",
    timestamp: new Date().toISOString(),
  }),
);

app.notFound((c) =>
  c.json({ error: { code: "not_found", message: "Route not found" } }, 404),
);

app.onError((err, c) => {
  console.error(err);
  return c.json(
    { error: { code: "internal_error", message: "Something broke." } },
    500,
  );
});

export const handler = handle(app);
export { app };
