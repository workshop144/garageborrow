import ReactMarkdown from "react-markdown";
import privacyMd from "../content/privacy.md?raw";
import { AppShell } from "../components/AppShell";

export default function LegalPrivacy(): JSX.Element {
  return (
    <AppShell>
      <article className="prose-sm max-w-none [&_h1]:font-heading [&_h2]:font-heading [&_h1]:text-3xl [&_h2]:text-2xl [&_h2]:mt-6 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <ReactMarkdown>{privacyMd}</ReactMarkdown>
      </article>
    </AppShell>
  );
}
