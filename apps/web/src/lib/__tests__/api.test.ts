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
});
