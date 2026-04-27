import type { NonprofitOrg } from "@garageborrow/shared";

import { safeHref } from "../../lib/safeHref";

type Props = {
  org: NonprofitOrg;
};

export function NonprofitCard({ org }: Props): JSX.Element {
  const url = safeHref(org.url ?? org.donate_url);
  const logoSrc = safeHref(org.logo_url);
  return (
    <article
      className="flex flex-col gap-3 rounded-xl border border-workshop/15 dark:border-surface-light/10 bg-surface-light/60 dark:bg-workshop/40 p-4"
      data-testid={`nonprofit-${org.name}`}
    >
      <div className="flex items-center gap-3">
        {logoSrc ? (
          <img src={logoSrc} alt="" className="h-12 w-12 rounded-lg object-contain bg-white p-1" />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-lg bg-gold-bright/30 font-heading text-lg text-workshop"
          >
            {org.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h3 className="font-heading text-lg leading-tight">{org.name}</h3>
      </div>
      {org.description ? <p className="text-sm opacity-80">{org.description}</p> : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start rounded-xl bg-gold-bright px-3 py-2 text-sm font-semibold text-workshop"
          data-testid={`nonprofit-link-${org.name}`}
        >
          Visit their site
        </a>
      ) : null}
    </article>
  );
}
