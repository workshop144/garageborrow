// ThemeProvider: stored preference, system media query tracking, the
// html.dark class, persistence and the outside-provider guard.

import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "../ThemeContext";

const STORAGE_KEY = "garageborrow.theme";

type Listener = (e: MediaQueryListEvent) => void;
let systemDark: boolean;
let listeners: Set<Listener>;

function installMatchMedia() {
  listeners = new Set();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: systemDark,
      media: query,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    })),
  );
}

function emitSystemChange(dark: boolean) {
  systemDark = dark;
  act(() => {
    listeners.forEach((l) => l({ matches: dark } as MediaQueryListEvent));
  });
}

function Probe() {
  const t = useTheme();
  return (
    <div>
      <span data-testid="pref">{t.preference}</span>
      <span data-testid="resolved">{t.resolved}</span>
      <button onClick={() => t.setPreference("dark")}>dark</button>
      <button onClick={() => t.setPreference("light")}>light</button>
      <button onClick={() => t.setPreference("system")}>system</button>
    </div>
  );
}

function mount() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  systemDark = false;
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  installMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ThemeProvider", () => {
  it("defaults to system and follows a light OS setting", () => {
    mount();
    expect(screen.getByTestId("pref").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("follows a dark OS setting and live media-query changes", () => {
    systemDark = true;
    mount();
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    emitSystemChange(false);
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("reads a stored preference and ignores the OS when it is explicit", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    mount();
    expect(screen.getByTestId("pref").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    emitSystemChange(false);
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("treats an unknown stored value as system", () => {
    localStorage.setItem(STORAGE_KEY, "sepia");
    mount();
    expect(screen.getByTestId("pref").textContent).toBe("system");
  });

  it("setPreference updates the class and persists the choice", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    await user.click(screen.getByRole("button", { name: "light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("still switches theme when localStorage writes throw", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    mount();
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("removes its media-query listener on unmount", () => {
    const { unmount } = mount();
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});

describe("useTheme", () => {
  it("throws outside a ThemeProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(
      "useTheme must be used inside <ThemeProvider>",
    );
  });
});
