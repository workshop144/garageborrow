import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { LegalDocument } from "../LegalDocument";
import { expectNoAxeViolations } from "../../../test/axe";

const SAMPLE = `# Demo Garage — Terms

**Last updated: April 25, 2026**

## Section one

Body paragraph with a [link](/legal/privacy) and **bold** text.

- bullet one
- bullet two
`;

function renderWithProviders(): HTMLElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LegalDocument source={SAMPLE} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return container;
}

describe("LegalDocument", () => {
  it("hoists the H1 title and the 'Last updated' badge above the markdown", () => {
    renderWithProviders();
    expect(
      screen.getByRole("heading", { level: 1, name: /Demo Garage — Terms/ }),
    ).toBeInTheDocument();
    const badge = screen.getByTestId("last-updated-badge");
    expect(badge).toHaveTextContent(/April 25, 2026/);
  });

  it("renders the rest of the markdown body", () => {
    renderWithProviders();
    expect(screen.getByRole("heading", { level: 2, name: "Section one" })).toBeInTheDocument();
    expect(screen.getByText(/bullet one/)).toBeInTheDocument();
  });

  it("has no axe-detectable accessibility violations", async () => {
    const container = renderWithProviders();
    await expectNoAxeViolations(container);
  });
});
