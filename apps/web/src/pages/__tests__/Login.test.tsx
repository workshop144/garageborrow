// Login page: phone step, OTP step, resend cooldown and 429 handling, with
// the auth context replaced by a small controllable fake.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";

const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { status: "anonymous" as string };
  return {
    state,
    listeners,
    setStatus(s: string) {
      state.status = s;
      listeners.forEach((l) => l());
    },
    beginPhoneSignIn: vi.fn<(phone: string) => Promise<void>>(),
    submitOtp: vi.fn<(code: string) => Promise<void>>(),
    signOut: vi.fn<() => void>(),
  };
});

vi.mock("../../lib/auth/AuthContext", async () => {
  const React = await import("react");
  return {
    useAuth: () => {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => {
        auth.listeners.add(force);
        return () => {
          auth.listeners.delete(force);
        };
      }, []);
      return {
        status: auth.state.status,
        beginPhoneSignIn: auth.beginPhoneSignIn,
        submitOtp: auth.submitOtp,
        signOut: auth.signOut,
      };
    },
  };
});

import Login from "../Login";

const PHONE_TYPED = "3175551234";
const PHONE_E164 = "+13175551234";

function mount() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<div>onboarding page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.state.status = "anonymous";
  auth.listeners.clear();
  auth.beginPhoneSignIn.mockReset();
  auth.submitOtp.mockReset();
  auth.signOut.mockReset();
  auth.beginPhoneSignIn.mockImplementation(() => {
    auth.setStatus("challenge");
    return Promise.resolve();
  });
  auth.signOut.mockImplementation(() => auth.setStatus("anonymous"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function reachChallenge(user: ReturnType<typeof userEvent.setup>) {
  mount();
  await user.type(screen.getByPlaceholderText("(317) 555-1234"), PHONE_TYPED);
  await user.click(screen.getByRole("button", { name: "Text me a code" }));
  await screen.findByRole("button", { name: "Verify" });
}

describe("Login — phone step", () => {
  it("formats the number as typed and rejects an invalid one without calling auth", async () => {
    const user = userEvent.setup();
    mount();
    const input = screen.getByPlaceholderText("(317) 555-1234");
    await user.type(input, "317555");
    expect(input).toHaveValue("(317) 555");
    await user.click(screen.getByRole("button", { name: "Text me a code" }));
    expect(
      await screen.findByText("Enter a valid US phone number, like (317) 555-1234."),
    ).toBeInTheDocument();
    expect(auth.beginPhoneSignIn).not.toHaveBeenCalled();
  });

  it("sends the E.164 number and moves to the code step with a resend cooldown", async () => {
    const user = userEvent.setup();
    await reachChallenge(user);
    expect(auth.beginPhoneSignIn).toHaveBeenCalledWith(PHONE_E164);
    expect(screen.getByText("(317) 555-1234")).toBeInTheDocument();
    const resend = screen.getByRole("button", { name: "Resend in 60s" });
    expect(resend).toBeDisabled();
  });

  it("shows the error message when sending fails and stays on the phone step", async () => {
    const user = userEvent.setup();
    auth.beginPhoneSignIn.mockRejectedValueOnce(new Error("Too many attempts"));
    mount();
    await user.type(screen.getByPlaceholderText("(317) 555-1234"), PHONE_TYPED);
    await user.click(screen.getByRole("button", { name: "Text me a code" }));
    expect(await screen.findByText("Too many attempts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text me a code" })).toBeEnabled();
  });

  it("falls back to a generic message for non-Error rejections", async () => {
    const user = userEvent.setup();
    auth.beginPhoneSignIn.mockRejectedValueOnce("nope");
    mount();
    await user.type(screen.getByPlaceholderText("(317) 555-1234"), PHONE_TYPED);
    await user.click(screen.getByRole("button", { name: "Text me a code" }));
    expect(await screen.findByText("Couldn't send the code.")).toBeInTheDocument();
  });

  it("disables the button and shows progress while the request is in flight", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    auth.beginPhoneSignIn.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    mount();
    await user.type(screen.getByPlaceholderText("(317) 555-1234"), PHONE_TYPED);
    await user.click(screen.getByRole("button", { name: "Text me a code" }));
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "Text me a code" })).toBeEnabled();
  });
});

describe("Login — code step", () => {
  it("strips non-digits and rejects a short code locally", async () => {
    const user = userEvent.setup();
    await reachChallenge(user);
    const codeInput = screen.getByLabelText("6-digit code");
    await user.type(codeInput, "12a3");
    expect(codeInput).toHaveValue("123");
    // No native `pattern` on the input: Verify reaches the component's own guard.
    expect(codeInput).not.toHaveAttribute("pattern");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(
      await screen.findByText("Enter the 6-digit code we just texted you."),
    ).toBeInTheDocument();
    expect(auth.submitOtp).not.toHaveBeenCalled();
  });

  it("submits a 6-digit code and navigates to onboarding", async () => {
    const user = userEvent.setup();
    auth.submitOtp.mockResolvedValueOnce();
    await reachChallenge(user);
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("onboarding page")).toBeInTheDocument();
    expect(auth.submitOtp).toHaveBeenCalledWith("123456");
  });

  it("shows the verify error and stays on the code step", async () => {
    const user = userEvent.setup();
    auth.submitOtp.mockRejectedValueOnce(new Error("Wrong code"));
    await reachChallenge(user);
    await user.type(screen.getByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Wrong code")).toBeInTheDocument();
    expect(screen.queryByText("onboarding page")).not.toBeInTheDocument();
  });

  it("uses a generic verify message for non-Error rejections", async () => {
    const user = userEvent.setup();
    auth.submitOtp.mockRejectedValueOnce(42);
    await reachChallenge(user);
    await user.type(screen.getByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("That code didn't work.")).toBeInTheDocument();
  });

  it("'Use a different number' signs out and returns to the phone step", async () => {
    const user = userEvent.setup();
    await reachChallenge(user);
    await user.click(screen.getByRole("button", { name: "Use a different number" }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Text me a code" })).toBeInTheDocument();
  });
});

describe("Login — resend", () => {
  // Fake timers drive the 60s cooldown; fireEvent avoids user-event's own
  // timer use so nothing waits on real time.
  async function reachChallengeWithFakeTimers() {
    vi.useFakeTimers();
    mount();
    fireEvent.change(screen.getByPlaceholderText("(317) 555-1234"), {
      target: { value: PHONE_TYPED },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Text me a code" }));
    });
    expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled();
  }

  it("counts the cooldown down and re-enables resend at zero", async () => {
    await reachChallengeWithFakeTimers();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: "Resend in 59s" })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("re-requests a code, clears the typed code and restarts the cooldown", async () => {
    await reachChallengeWithFakeTimers();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "111" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    });
    expect(auth.beginPhoneSignIn).toHaveBeenCalledTimes(2);
    expect(auth.beginPhoneSignIn).toHaveBeenLastCalledWith(PHONE_E164);
    expect(screen.getByLabelText("6-digit code")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled();
  });

  it("on 429 uses the server's retry_after_seconds as the cooldown", async () => {
    await reachChallengeWithFakeTimers();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    auth.beginPhoneSignIn.mockRejectedValueOnce(
      new ApiError({
        code: "rate_limited",
        message: "slow down",
        status: 429,
        details: { retry_after_seconds: 17 },
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    });
    expect(screen.getByText("Hold on — try again in 17s.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend in 17s" })).toBeDisabled();
  });

  it("on 429 without details falls back to the default cooldown", async () => {
    await reachChallengeWithFakeTimers();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    auth.beginPhoneSignIn.mockRejectedValueOnce(
      new ApiError({ code: "rate_limited", message: "slow down", status: 429 }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    });
    expect(screen.getByText("Hold on — try again in 60s.")).toBeInTheDocument();
  });

  it("shows other resend errors verbatim, or a generic one for non-Errors", async () => {
    await reachChallengeWithFakeTimers();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    auth.beginPhoneSignIn.mockRejectedValueOnce(new Error("Network down"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    });
    expect(screen.getByText("Network down")).toBeInTheDocument();

    auth.beginPhoneSignIn.mockRejectedValueOnce(null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    });
    expect(screen.getByText("Couldn't resend the code.")).toBeInTheDocument();
  });
});

describe("Login — challenge without a phone number", () => {
  it("asks to start over when resending with no number on file", async () => {
    auth.state.status = "challenge";
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText("Phone number missing — start over.")).toBeInTheDocument();
    expect(auth.beginPhoneSignIn).not.toHaveBeenCalled();
  });
});
