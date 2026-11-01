import { describe, expect, it } from "vitest";

import { createApp } from "../index.js";

describe("GET /v1/openapi.json", () => {
  it("serves a JSON Schema component for every shared model", async () => {
    const res = await createApp().request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      components: { schemas: Record<string, { type?: string; properties?: object }> };
    };
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.components.schemas)).toContain("Item");
    for (const schema of Object.values(spec.components.schemas)) {
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
    }
    expect(spec.components.schemas["User"]?.properties).toHaveProperty("phone");
  });
});
