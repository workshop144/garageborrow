import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { DonateForm } from "../DonateForm";
import type { DonateDraftPhoto } from "../../../hooks/useDonate";

// Cropper is heavy and DOM-rect-dependent; replace it with a tiny stub that
// just renders the source image and lets the test hand back a fake crop.
vi.mock("react-easy-crop", () => ({
  default: ({ image }: { image: string }) => <img data-testid="cropper-stub" src={image} alt="" />,
}));

// Stub uploadPhoto so submit doesn't need a real S3.
vi.mock("../../../lib/uploadPhoto", () => ({
  uploadPhoto: vi.fn().mockResolvedValue({ key: "uploads/test/p.jpg" }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrap(child: ReactNode): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{child}</MemoryRouter>
    </QueryClientProvider>
  );
}

// useDonate.draft.photos exposes a setField hook indirectly. To avoid wiring
// up the full crop UI in tests, the StepPhotos component uses photos via
// onChange; we drive it through the public DOM, but we need a way to add
// photos without going through the cropper. We'll use a small helper that
// directly manipulates the photos slot via the StepPhotos remove button —
// instead, we test photo *limits* via the StepPhotos.test.tsx unit, and here
// we focus on the state machine. For the full submit test we seed with a
// custom DonateForm wrapper.
function preloadedPhotos(): DonateDraftPhoto[] {
  const blob = new Blob(["x"], { type: "image/jpeg" });
  return [{ previewUrl: "blob:test/photo-1", blob }];
}

describe("DonateForm state machine", () => {
  it("blocks Next on the first step until a name is entered", async () => {
    const user = userEvent.setup();
    render(wrap(<DonateForm />));

    const next = screen.getByTestId("donate-next");
    expect(next).toBeDisabled();

    await user.type(screen.getByTestId("donate-name-input"), "Old Saw");
    expect(next).toBeEnabled();
  });

  it("preserves entered data when navigating back and forward", async () => {
    const user = userEvent.setup();
    render(wrap(<DonateForm />));

    await user.type(screen.getByTestId("donate-name-input"), "Old Saw");
    await user.type(screen.getByTestId("donate-description-input"), "Works fine.");
    await user.click(screen.getByTestId("donate-next"));

    // On the photos step now — go back and verify name still there.
    expect(screen.getByTestId("donate-step-photos")).toBeInTheDocument();
    await user.click(screen.getByTestId("donate-back"));

    expect((screen.getByTestId("donate-name-input") as HTMLInputElement).value).toBe("Old Saw");
    expect((screen.getByTestId("donate-description-input") as HTMLTextAreaElement).value).toBe(
      "Works fine.",
    );
  });
});

// To test submit, exercise the public flow but inject photos directly via the
// hook by rendering a thin harness — keeps tests independent of the cropper.
import { DONATE_STEP_ORDER, useDonate } from "../../../hooks/useDonate";
import { StepConfirm } from "../StepConfirm";

function HarnessWithPhotos(): JSX.Element {
  const d = useDonate();
  // Seed minimum draft so we can submit.
  if (d.draft.itemName === "" && !d.submittedDonation) {
    // Direct setField mutations only run once because canAdvance recomputes
    // — but we want to short-circuit straight to confirm.
    d.setField("itemName", "Old Saw");
    d.setField("photos", preloadedPhotos());
    d.setField("condition", "good");
  }
  if (d.submittedDonation) {
    return <p data-testid="harness-success">{d.submittedDonation.id}</p>;
  }
  return (
    <div>
      <StepConfirm draft={d.draft} />
      <button type="button" data-testid="harness-submit" onClick={d.submit}>
        Submit
      </button>
    </div>
  );
}

describe("DonateForm submit", () => {
  it("POSTs the donation with an Idempotency-Key after a successful upload", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        donation: {
          id: "don-1",
          garage_id: "demo-garage",
          donor_phone: "+15555550100",
          item_name: "Old Saw",
          description: "",
          photo_keys: ["uploads/test/p.jpg"],
          condition: "good",
          status: "pending",
          created_at: "2026-04-26T15:00:00Z",
        },
      }),
    );

    render(wrap(<HarnessWithPhotos />));
    await user.click(screen.getByTestId("harness-submit"));
    await waitFor(() => expect(screen.getByTestId("harness-success")).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toMatch(/\/g\/demo-garage\/donations$/);
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(init.body as string)).toMatchObject({
      item_name: "Old Saw",
      condition: "good",
      photo_keys: ["uploads/test/p.jpg"],
    });
  });
});

// Sanity-check that the step order matches the spec (UI relies on this).
describe("DONATE_STEP_ORDER", () => {
  it("walks name → photos → condition → notes → category → confirm", () => {
    expect(DONATE_STEP_ORDER).toEqual([
      "name",
      "photos",
      "condition",
      "notes",
      "category",
      "confirm",
    ]);
  });
});
