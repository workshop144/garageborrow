import { useMemo, useState } from "react";

import { useAuth } from "../../lib/auth/AuthContext";
import { confirmOtp, startSignIn } from "../../lib/auth/cognito";
import { useCancelDelete, useDeleteAccount } from "../../hooks/useDeleteAccount";

type Step = "idle" | "confirm" | "otp" | "submitting" | "scheduled";

type Props = {
  deletedAt?: string | undefined;
};

const HARD_DELETE_DAYS = 30;

export function daysUntilHardDelete(deletedAt: string, now: Date = new Date()): number {
  const ms = new Date(deletedAt).getTime() + HARD_DELETE_DAYS * 86_400_000 - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function DeleteAccountFlow({ deletedAt }: Props): JSX.Element {
  const { username } = useAuth();
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remove = useDeleteAccount();
  const cancel = useCancelDelete();

  const daysLeft = useMemo(() => (deletedAt ? daysUntilHardDelete(deletedAt) : 0), [deletedAt]);

  if (deletedAt) {
    return (
      <div
        role="status"
        data-testid="deletion-banner"
        className="rounded-2xl border border-status-overdue/40 bg-status-overdue/10 p-4 text-sm"
      >
        <p>
          Account scheduled for deletion in <span className="font-semibold">{daysLeft}</span>{" "}
          {daysLeft === 1 ? "day" : "days"}.
        </p>
        <button
          type="button"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          className="mt-2 rounded-xl border border-workshop/20 dark:border-surface-light/20 px-3 py-1.5 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
        >
          {cancel.isPending ? "Cancelling…" : "Cancel deletion"}
        </button>
      </div>
    );
  }

  async function startOtp(): Promise<void> {
    if (!username) {
      setError("Sign in again before deleting your account.");
      return;
    }
    setError(null);
    try {
      await startSignIn(username);
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a code.");
      setStep("confirm");
    }
  }

  async function submitOtp(): Promise<void> {
    if (!username) {
      setError("Sign in again before deleting your account.");
      return;
    }
    setError(null);
    setStep("submitting");
    try {
      await confirmOtp(username, code.trim());
      remove.mutate(undefined, {
        onSuccess: () => setStep("scheduled"),
        onError: (err) => {
          setError(err.message ?? "Couldn't schedule deletion.");
          setStep("otp");
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't match.");
      setStep("otp");
    }
  }

  if (step === "scheduled") {
    return (
      <p className="text-sm" role="status">
        Got it — your account is scheduled for deletion. You&apos;ll see a banner up top with a way
        to undo.
      </p>
    );
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("confirm")}
        data-testid="delete-account-start"
        className="rounded-xl border border-status-overdue/40 px-4 py-2 text-sm text-status-overdue hover:bg-status-overdue/10"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div
      data-testid="delete-account-flow"
      className="rounded-2xl border border-status-overdue/40 bg-status-overdue/10 p-4 text-sm space-y-3"
    >
      {step === "confirm" ? (
        <>
          <p>
            We&apos;ll keep your loan/wishlist/donation history but anonymize anything tied to you.
            You can cancel for the first 30 days.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void startOtp()}
              data-testid="delete-confirm-start-otp"
              className="rounded-xl bg-status-overdue px-4 py-2 text-sm font-semibold text-surface-light"
            >
              Send me a code
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm"
            >
              Never mind
            </button>
          </div>
        </>
      ) : null}

      {step === "otp" || step === "submitting" ? (
        <>
          <p>Enter the code we just texted to {username ?? "your phone"} to confirm.</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="delete-otp-input"
            className="w-full rounded-xl border border-workshop/20 dark:border-surface-light/20 bg-transparent px-3 py-2 tracking-widest text-center"
            placeholder="123456"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submitOtp()}
              disabled={code.trim().length < 4 || step === "submitting"}
              data-testid="delete-otp-submit"
              className="rounded-xl bg-status-overdue px-4 py-2 text-sm font-semibold text-surface-light disabled:opacity-60"
            >
              {step === "submitting" ? "Confirming…" : "Confirm delete"}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="text-xs text-status-overdue" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
