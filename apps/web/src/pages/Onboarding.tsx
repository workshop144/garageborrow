import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";

const screens = [
  {
    title: "Tap to borrow.",
    body: "That's it. Pick a tool, hit borrow, walk to the garage.",
  },
  {
    title: "Bring it back when you can.",
    body: "No big deal. Life happens. We'll nudge you if it's been a while.",
  },
  {
    title: "If something goes sideways,",
    body: "just text Dad. Broken, lost, used it for something weird — whatever. We'll figure it out.",
  },
];

export default function Onboarding(): JSX.Element {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const finish = useMutation({
    mutationFn: () => api.patch<void>("/me", { onboardingSeen: true }),
    onSettled: () => navigate("/", { replace: true }),
  });

  const onNext = () => {
    if (step < screens.length - 1) {
      setStep(step + 1);
    } else {
      finish.mutate();
    }
  };
  const onSkip = () => finish.mutate();

  const screen = screens[step]!;
  return (
    <div className="min-h-screen flex flex-col px-6 py-10 bg-wood">
      <div className="flex justify-end">
        <button onClick={onSkip} className="text-sm opacity-70 hover:opacity-100 underline">
          Skip
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-md text-center">
          <h1 className="font-heading text-4xl sm:text-5xl text-gold-bright">{screen.title}</h1>
          <p className="mt-4 text-lg">{screen.body}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {screens.map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i === step ? "bg-gold-bright" : "bg-workshop/30 dark:bg-surface-light/30"}`}
            />
          ))}
        </div>
        <button
          onClick={onNext}
          disabled={finish.isPending}
          className="rounded-md bg-gold-bright px-5 py-2 font-semibold text-workshop disabled:opacity-50"
        >
          {step < screens.length - 1 ? "Next" : "Let's go"}
        </button>
      </div>
    </div>
  );
}
