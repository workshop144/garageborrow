import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { captureError } from "../lib/sentry";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("App error boundary caught:", error, info);
    captureError(error, { componentStack: info.componentStack });
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6 bg-surface-light dark:bg-surface-dark text-workshop dark:text-surface-light">
          <div className="max-w-md text-center">
            <h1 className="font-heading text-4xl text-gold-bright">Well, something broke.</h1>
            <p className="mt-3 opacity-80">Let&apos;s try that again.</p>
            <button
              onClick={() => {
                this.reset();
                window.location.reload();
              }}
              className="mt-6 rounded-md bg-gold-bright px-5 py-2 font-semibold text-workshop"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
