import ReactMarkdown from "react-markdown";
import { AppShell } from "../AppShell";

type Props = {
  source: string;
};

// Pulls the H1 title and the "Last updated:" line off the top of the markdown
// so the page chrome can render them prominently. Falls back to rendering the
// raw markdown if the expected pattern isn't matched.
function splitFrontmatter(source: string): {
  title: string | null;
  lastUpdated: string | null;
  body: string;
} {
  const lines = source.split(/\r?\n/);
  let title: string | null = null;
  let lastUpdated: string | null = null;
  let bodyStart = 0;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;
    if (!title && line.startsWith("# ")) {
      title = line.slice(2).trim();
      bodyStart = i + 1;
      continue;
    }
    if (!lastUpdated) {
      const match = /^\*\*Last updated:\s*([^*]+)\*\*$/i.exec(line);
      if (match?.[1]) {
        lastUpdated = match[1].trim();
        bodyStart = i + 1;
        continue;
      }
    }
  }
  return {
    title,
    lastUpdated,
    body: lines.slice(bodyStart).join("\n").trimStart(),
  };
}

export function LegalDocument({ source }: Props): JSX.Element {
  const { title, lastUpdated, body } = splitFrontmatter(source);
  return (
    <AppShell>
      <div className="bg-wood -mx-4 px-4 py-6 sm:-mx-0 sm:rounded-2xl sm:px-6">
        <article className="mx-auto max-w-2xl rounded-2xl bg-surface-light/95 dark:bg-surface-dark/95 p-6 shadow-md ring-1 ring-workshop/10 dark:ring-surface-light/10">
          {title ? <h1 className="font-heading text-3xl text-gold-bright">{title}</h1> : null}
          {lastUpdated ? (
            <p
              className="mt-2 inline-block rounded-full bg-gold-bright/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gold-accent"
              data-testid="last-updated-badge"
            >
              Last updated · {lastUpdated}
            </p>
          ) : null}
          <div className="prose prose-sm dark:prose-invert mt-6 max-w-none prose-headings:font-heading prose-headings:text-gold-bright prose-a:text-gold-accent prose-strong:text-workshop dark:prose-strong:text-surface-light leading-relaxed">
            <ReactMarkdown>{body}</ReactMarkdown>
          </div>
        </article>
      </div>
    </AppShell>
  );
}
