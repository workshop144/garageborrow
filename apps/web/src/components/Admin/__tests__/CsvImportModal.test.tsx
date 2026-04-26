import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as React from "react";

import { CsvImportModal, parseCsv } from "../Inventory/CsvImportModal";

vi.mock("framer-motion", async () => {
  const ReactInner = await import("react");
  const Passthrough = ReactInner.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, ...rest }, ref) => ReactInner.createElement("div", { ref, ...rest }, children),
  );
  Passthrough.displayName = "MotionPassthrough";
  return {
    motion: new Proxy(
      {},
      {
        get: () => Passthrough,
      },
    ),
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      ReactInner.createElement(ReactInner.Fragment, null, children),
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function wrap(child: ReactNode): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{child}</QueryClientProvider>;
}

describe("parseCsv", () => {
  it("splits headers and quoted cells", () => {
    const text = `name,category,description\nDrill,power-tools,"18V cordless"\nSaw,hand-tools,Sharp`;
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(["name", "category", "description"]);
    expect(rows.length).toBe(2);
    expect(rows[0]?.["description"]).toBe("18V cordless");
    expect(rows[1]?.["name"]).toBe("Saw");
  });
});

describe("CsvImportModal", () => {
  it("previews rows before submitting", async () => {
    const user = userEvent.setup();
    render(wrap(<CsvImportModal open={true} onClose={() => undefined} />));

    const textarea = screen.getByTestId("csv-import-textarea") as HTMLTextAreaElement;
    await user.click(textarea);
    await user.paste(`name,category\nDrill,power-tools\nSaw,hand-tools`);
    expect(screen.getByTestId("csv-import-preview")).toBeInTheDocument();
    expect(screen.getByText(/2 row\(s\) detected/i)).toBeInTheDocument();
  });

  it("submits parsed rows and shows the result summary", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total: 2,
          created: 2,
          errors: 0,
          results: [
            { index: 0, status: "ok", item: { id: "a" } },
            { index: 1, status: "ok", item: { id: "b" } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(wrap(<CsvImportModal open={true} onClose={() => undefined} />));
    await user.click(screen.getByTestId("csv-import-textarea"));
    await user.paste(`name,category\nDrill,power-tools\nSaw,hand-tools`);
    await user.click(screen.getByTestId("csv-import-submit"));

    await waitFor(() => expect(screen.getByTestId("csv-import-result")).toBeInTheDocument());
    expect(screen.getByTestId("csv-import-result")).toHaveTextContent(/Imported 2 of 2/i);
  });
});

// Silence "React" lint when only used in JSX above:
void React;
