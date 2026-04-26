import { useDataExport } from "../../hooks/useDataExport";

export function DataExportButton(): JSX.Element {
  const exporter = useDataExport();
  const done = exporter.isSuccess;

  return (
    <div data-testid="data-export">
      <button
        type="button"
        onClick={() => exporter.mutate()}
        disabled={exporter.isPending || done}
        className="rounded-xl border border-workshop/20 dark:border-surface-light/20 px-4 py-2 text-sm hover:bg-workshop/5 dark:hover:bg-surface-light/5 disabled:opacity-60"
      >
        {exporter.isPending ? "Sending…" : done ? "Sent" : "Download my data"}
      </button>
      {done ? (
        <p className="mt-2 text-xs opacity-80" role="status">
          Sent to your phone via SMS link.
        </p>
      ) : null}
      {exporter.isError ? (
        <p className="mt-2 text-xs text-status-overdue" role="alert">
          Couldn&apos;t kick off the export. Try again in a minute.
        </p>
      ) : null}
    </div>
  );
}
