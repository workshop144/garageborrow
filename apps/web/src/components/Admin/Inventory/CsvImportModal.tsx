import { useMemo, useState } from "react";

import { Drawer } from "../../Drawers/Drawer";
import { useBulkImportItems } from "../../../hooks/useAdminItems";
import type { BulkImportResult } from "../../../hooks/useAdminItems";

type Props = {
  open: boolean;
  onClose: () => void;
};

const EXPECTED_HEADERS = [
  "name",
  "category",
  "description",
  "default_duration_days",
  "quality_tier",
  "requires_approval",
  "min_tier",
  "auto_approve_tier",
  "tags",
];

// Minimal RFC 4180-ish CSV split. Handles quoted cells with embedded commas
// but not embedded line breaks — those are rare in practice and the import is
// for the owner's own spreadsheets, not arbitrary user uploads.
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = splitLine(lines[0] ?? "").map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitLine(lines[li] ?? "");
    const row: Record<string, string> = {};
    for (let hi = 0; hi < headers.length; hi++) {
      row[headers[hi]!] = (cells[hi] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers, rows };
}

function coerceRow(raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === "") continue;
    if (k === "tags") {
      out[k] = v
        .split("|")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    } else if (k === "default_duration_days") {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (k === "requires_approval") {
      out[k] = v.toLowerCase() === "true" || v === "1";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function CsvImportModal({ open, onClose }: Props): JSX.Element {
  const [text, setText] = useState("");
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const importMut = useBulkImportItems();

  const parsed = useMemo(() => parseCsv(text), [text]);
  const previewRows = parsed.rows.slice(0, 10);

  function reset(): void {
    setText("");
    setResult(null);
  }

  function close(): void {
    reset();
    onClose();
  }

  async function submit(): Promise<void> {
    const payload = parsed.rows.map(coerceRow);
    const r = await importMut.mutateAsync({ rows: payload });
    setResult(r);
  }

  return (
    <Drawer open={open} onClose={close} title="Import items from CSV" testid="csv-import-modal">
      <div className="space-y-4">
        <p className="text-sm opacity-80">
          Expected columns: <code>{EXPECTED_HEADERS.join(", ")}</code>. Tags are pipe-delimited
          (e.g. <code>power|outdoor</code>).
        </p>
        <label className="block text-sm font-medium">CSV content</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-workshop/15 dark:border-surface-light/15 bg-transparent p-2 font-mono text-xs"
          placeholder="name,category,description,default_duration_days,..."
          data-testid="csv-import-textarea"
        />

        {previewRows.length > 0 ? (
          <section data-testid="csv-import-preview">
            <p className="text-sm font-semibold">Preview — {parsed.rows.length} row(s) detected</p>
            <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-workshop/15 dark:border-surface-light/15">
              <table className="min-w-full text-xs">
                <thead className="bg-workshop/5 dark:bg-surface-light/5">
                  <tr>
                    {parsed.headers.map((h) => (
                      <th key={h} className="px-2 py-1 text-left font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-workshop/10 dark:border-surface-light/10"
                    >
                      {parsed.headers.map((h) => (
                        <td key={h} className="px-2 py-1 align-top">
                          {row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {result ? (
          <section
            data-testid="csv-import-result"
            className="rounded-xl border border-workshop/15 dark:border-surface-light/15 p-3 text-sm"
          >
            <p className="font-semibold">
              Imported {result.created} of {result.total} (errors: {result.errors})
            </p>
            {result.errors > 0 ? (
              <ul className="mt-2 max-h-40 overflow-auto text-xs">
                {result.results
                  .filter(
                    (r): r is Extract<(typeof result.results)[number], { status: "error" }> =>
                      r.status === "error",
                  )
                  .map((r) => (
                    <li key={r.index} className="text-status-overdue">
                      Row {r.index + 1}:{" "}
                      {r.errors.map((e) => `${e.path || "(row)"} – ${e.message}`).join("; ")}
                    </li>
                  ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={parsed.rows.length === 0 || importMut.isPending}
            className="rounded-xl bg-gold-bright px-3 py-2 text-sm font-semibold text-workshop disabled:opacity-50"
            data-testid="csv-import-submit"
          >
            {importMut.isPending ? "Importing…" : `Import ${parsed.rows.length}`}
          </button>
        </div>
      </div>
    </Drawer>
  );
}
