import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("api error parsing", () => {
  it("turns a non-JSON error page into an ApiError with the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("<html><body>502 Bad Gateway</body></html>", {
            status: 502,
            statusText: "Bad Gateway",
          }),
        ),
      ),
    );
    const err = await api.get("/health").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code).toBe("HTTP_502");
  });

  it("uses the API error message when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "nope", message: "Not allowed" } }), {
            status: 403,
            statusText: "Forbidden",
          }),
        ),
      ),
    );
    const err = (await api.get("/x").catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("nope");
    expect(err.message).toBe("Not allowed");
  });

  it("falls back to statusText, then a generic message, when either is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 502, statusText: "Bad Gateway" }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: "" } }), {
            status: 404,
            statusText: "",
          }),
        ),
    );
    const first = (await api.get("/a").catch((e: unknown) => e)) as ApiError;
    expect(first.message).toBe("Bad Gateway");
    const second = (await api.get("/b").catch((e: unknown) => e)) as ApiError;
    expect(second.message).toBe("Request failed");
    expect(second.code).toBe("HTTP_404");
  });
});
