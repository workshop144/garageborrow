import { useState, type JSX } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationPrefs as Prefs } from "@garageborrow/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  permission: "default" as "default" | "granted" | "denied" | "unsupported",
  ensure: vi.fn(),
}));
vi.mock("../../../lib/pushSubscription", () => ({
  getPermissionState: () => push.permission,
  ensurePushSubscription: () => push.ensure() as unknown,
}));

import { NotificationPrefs } from "../NotificationPrefs";

const BASE: Prefs = {
  sms_enabled: true,
  push_enabled: false,
  reminders: true,
  waitlist_updates: true,
  new_tools: false,
  promotion_celebrations: true,
  ai_ready_notify: false,
  quiet_hours_start: "21:00",
  quiet_hours_end: "08:00",
};

let changes: Prefs[];

function Harness({ initial, saving }: { initial: Prefs; saving?: boolean }): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <NotificationPrefs
      value={value}
      saving={saving ?? false}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

beforeEach(() => {
  changes = [];
  push.permission = "default";
  push.ensure.mockReset();
});
afterEach(cleanup);

const last = () => changes[changes.length - 1];

describe("NotificationPrefs", () => {
  it("reflects the current prefs and toggles a category", async () => {
    const user = userEvent.setup();
    render(<Harness initial={BASE} />);
    expect(screen.getByTestId("pref-reminders")).toBeChecked();
    expect(screen.getByTestId("pref-new_tools")).not.toBeChecked();
    expect(screen.getByText("Borrow returns, due dates, gentle nudges")).toBeInTheDocument();

    await user.click(screen.getByTestId("pref-new_tools"));
    expect(last()).toEqual({ ...BASE, new_tools: true });
    expect(screen.getByTestId("pref-new_tools")).toBeChecked();

    await user.click(screen.getByTestId("pref-sms"));
    expect(last()).toEqual({ ...BASE, new_tools: true, sms_enabled: false });
  });

  it("enables push after the browser grants permission", async () => {
    const user = userEvent.setup();
    push.ensure.mockImplementation(() => {
      push.permission = "granted";
      return Promise.resolve({ status: "granted-subscribed" });
    });
    render(<Harness initial={BASE} />);
    expect(screen.getByTestId("pref-push-status")).toHaveTextContent("Disabled");

    await user.click(screen.getByTestId("pref-push"));
    await waitFor(() => expect(last()?.push_enabled).toBe(true));
    expect(push.ensure).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/We just asked your browser for push permission/)).toBeInTheDocument();
    expect(screen.getByTestId("pref-push-status")).toHaveTextContent("Enabled");
  });

  it("keeps push off when the browser denies permission", async () => {
    const user = userEvent.setup();
    push.ensure.mockImplementation(() => {
      push.permission = "denied";
      return Promise.resolve({ status: "denied" });
    });
    render(<Harness initial={BASE} />);
    await user.click(screen.getByTestId("pref-push"));
    await waitFor(() =>
      expect(screen.getByTestId("pref-push-status")).toHaveTextContent(
        "Permission denied — open browser settings",
      ),
    );
    expect(last()?.push_enabled).toBe(false);
    expect(screen.getByTestId("pref-push")).not.toBeChecked();
  });

  it("turns push off without prompting", async () => {
    const user = userEvent.setup();
    push.permission = "granted";
    render(<Harness initial={{ ...BASE, push_enabled: true }} />);
    expect(screen.getByTestId("pref-push-status")).toHaveTextContent("Enabled");
    await user.click(screen.getByTestId("pref-push"));
    expect(push.ensure).not.toHaveBeenCalled();
    expect(last()?.push_enabled).toBe(false);
    expect(screen.getByTestId("pref-push-status")).toHaveTextContent("Disabled");
  });

  it("disables the push toggle when push is unsupported", () => {
    push.permission = "unsupported";
    render(<Harness initial={BASE} />);
    expect(screen.getByTestId("pref-push")).toBeDisabled();
    expect(screen.getByTestId("pref-push-status")).toHaveTextContent(
      "Not supported on this device",
    );
  });

  it("accepts valid quiet hours and keeps the old value for invalid ones", () => {
    render(<Harness initial={BASE} />);
    fireEvent.change(screen.getByTestId("quiet-start"), { target: { value: "22:30" } });
    expect(last()).toMatchObject({ quiet_hours_start: "22:30", quiet_hours_end: "08:00" });
    fireEvent.change(screen.getByTestId("quiet-end"), { target: { value: "" } });
    expect(last()).toMatchObject({ quiet_hours_start: "22:30", quiet_hours_end: "08:00" });
  });

  it("shows the saving indicator only while saving", () => {
    const { unmount } = render(<Harness initial={BASE} />);
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    unmount();
    render(<Harness initial={BASE} saving />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });
});
