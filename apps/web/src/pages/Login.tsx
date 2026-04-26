import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { api, ApiError } from "../lib/api";
import { formatAsYouType, toE164 } from "../lib/phone";

const RESEND_COOLDOWN_SECONDS = 60;

export default function Login(): JSX.Element {
  const { beginPhoneSignIn, submitOtp, status, signOut } = useAuth();
  const navigate = useNavigate();
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (resendCooldown > 0 && !tickRef.current) {
      tickRef.current = setInterval(() => {
        setResendCooldown((s) => {
          if (s <= 1 && tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
          }
          return Math.max(0, s - 1);
        });
      }, 1000);
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [resendCooldown]);

  function startCooldown(seconds: number) {
    setResendCooldown(seconds);
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const e164 = toE164(phoneInput);
    if (!e164) {
      setError("Enter a valid US phone number, like (317) 555-1234.");
      return;
    }
    setBusy(true);
    try {
      await beginPhoneSignIn(e164);
      startCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code we just texted you.");
      return;
    }
    setBusy(true);
    try {
      await submitOtp(code);
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null);
    const e164 = toE164(phoneInput);
    if (!e164) {
      setError("Phone number missing — start over.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ status: string; retry_after_seconds: number }>(
        "/auth/resend-otp",
        { phone: e164 },
      );
      startCooldown(res.retry_after_seconds || RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const detail = err.details as { retry_after_seconds?: number } | undefined;
        const retry = detail?.retry_after_seconds ?? RESEND_COOLDOWN_SECONDS;
        startCooldown(retry);
        setError(`Hold on — try again in ${retry}s.`);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't resend the code.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-workshop/10 dark:border-surface-light/10 bg-surface-light dark:bg-surface-dark p-6 shadow-sm">
        <h1 className="font-heading text-3xl text-gold-bright">Howdy.</h1>
        <p className="mt-1 text-sm opacity-70">Phone number first, code second.</p>

        {status !== "challenge" ? (
          <form onSubmit={onSendCode} className="mt-6 space-y-3">
            <label className="block text-sm font-medium">
              Phone
              <input
                inputMode="tel"
                autoComplete="tel"
                placeholder="(317) 555-1234"
                value={phoneInput}
                onChange={(e) => setPhoneInput(formatAsYouType(e.target.value))}
                className="mt-1 w-full rounded-md border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gold-bright"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-gold-bright px-4 py-2 font-semibold text-workshop disabled:opacity-50"
            >
              {busy ? "Sending…" : "Text me a code"}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="mt-6 space-y-3">
            <p className="text-sm">
              Code sent to <span className="font-mono">{phoneInput}</span>.
            </p>
            <label className="block text-sm font-medium">
              6-digit code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="mt-1 w-full rounded-md border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2 text-lg tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-gold-bright"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-gold-bright px-4 py-2 font-semibold text-workshop disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={onResend}
              disabled={busy || resendCooldown > 0}
              className="w-full text-sm opacity-80 hover:opacity-100 disabled:opacity-50"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
            <button
              type="button"
              onClick={() => {
                signOut();
                setCode("");
                startCooldown(0);
              }}
              className="w-full text-sm opacity-70 hover:opacity-100"
            >
              Use a different number
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-status-overdue">{error}</p>}

        <p className="mt-6 text-xs opacity-60">
          By signing in you agree to the{" "}
          <a href="/legal/terms" className="underline">
            terms
          </a>{" "}
          and{" "}
          <a href="/legal/privacy" className="underline">
            privacy policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
