import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionCacheReset } from "../SessionCacheReset";

let status = "authenticated";
vi.mock("../AuthContext", () => ({ useAuth: () => ({ status }) }));

describe("SessionCacheReset", () => {
  const deleteCache = vi.fn(() => Promise.resolve(true));
  beforeEach(() => {
    deleteCache.mockClear();
    vi.stubGlobal("caches", { delete: deleteCache });
  });

  function mount(client: QueryClient) {
    const tree = () => (
      <QueryClientProvider client={client}>
        <SessionCacheReset />
      </QueryClientProvider>
    );
    const r = render(tree());
    return () => r.rerender(tree());
  }

  it("clears the previous user's cached data when they sign out", () => {
    const client = new QueryClient();
    client.setQueryData(["me"], { phone: "+15555550100" });
    status = "authenticated";
    const rerender = mount(client);
    expect(client.getQueryData(["me"])).toBeDefined();
    status = "anonymous";
    rerender();
    expect(client.getQueryData(["me"])).toBeUndefined();
    expect(deleteCache).toHaveBeenCalledWith("api");
  });

  it("does nothing for a visitor who was never signed in", () => {
    const client = new QueryClient();
    client.setQueryData(["public"], 1);
    status = "anonymous";
    mount(client);
    expect(client.getQueryData(["public"])).toBe(1);
    expect(deleteCache).not.toHaveBeenCalled();
  });
});
