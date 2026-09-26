# A tool-lending PWA built for one neighborhood, now ready to fork for yours

_Draft, about 1500 words. Adjust details before posting to dev.to / Hacker News / a blog._

---

Garage Borrow started in one person's garage in a small town. People the owner knows come by and borrow things: drills, a log splitter, outgrown camping gear, a 3D printer that turned out to be one project too many. For years the system was a group text and the owner's memory, and that system was breaking down. So the owner built **Garage Borrow**, an open-source neighborhood gear-lending PWA, and released it under MIT. This post covers why it exists, who it is for, what is in it, and how to spin one up for your own neighborhood in an afternoon.

## Why it exists

The pitch is one paragraph: _neighbors already share tools. They do it badly, in group chats and DMs, and most of the friction is bookkeeping: who has what, when did they take it, did they return the saw or does Mike still have it from June._ Anyone who has been the de facto lender on their block knows the feeling. Things go out and don't come back; people are too embarrassed to ask twice; the social cost of nagging is real.

Every commercial tool-library platform the owner looked at solved this with infrastructure that didn't fit: payments, multi-day rentals, fee schedules, insurance attestations, real names on file. None of that was wanted. The goal was **a phone-numbers-only directory of who has what and a button that says "I have it now."** That is what got built.

## Who it's for

This is not a marketplace. It is not a startup. It is software for:

- **Small-town tool libraries** that already exist as informal arrangements
- **Churches and community groups** that lend equipment to members
- **Neighborhood gear-sharing collectives** that don't want to charge money or vet members in any formal way
- **One person with a generous garage** and a few dozen tools to share with friends

The minimum viable user count is one: the owner. The maximum is bounded by how many people the host actually wants to deal with personally, which in practice is in the low hundreds.

The deliberate non-goals:

- No money handling. Nothing changes hands financially. If your group rents tools for a fee, this isn't your tool.
- No verification rituals. Phone-number sign-up, that's it. Trust comes from being someone the owner knows or someone vouched in by someone they know.
- No native app. It's a PWA. iOS and Android both render it fine on the home screen. A native app would triple the maintenance surface for zero new functionality.

## Technical highlights

The README covers the details. The choices that matter:

### Multi-tenant from day one

Only one garage runs today, but the data model has been multi-tenant since the first commit. There's a `Garage` record with a slug, and every other record (`Item`, `Loan`, `Donation`, etc.) lives under `TENANT#<slug>` in DynamoDB. It is the only bet on the future in the design, and the cheapest possible one: it costs nothing today, and anyone who forks the repo to run their own garage finds the wiring already there. The tenant's name, site URL and time zone are build-time settings, not code.

### Built to run under $5/month

A concrete cost target and a hard constraint. The whole stack lives inside the AWS free tier with about $2/month in unavoidable charges (Cognito SMS for OTP sign-in, plus the Route 53 hosted zone). The deliberate choices:

- **HTTP API, not REST API.** $1.00/M requests vs $3.50/M.
- **DynamoDB on-demand.** No provisioned capacity to leave on overnight.
- **CloudFront price class 100.** US/CA/EU edges only. Sydney isn't needed.
- **No NAT, no VPC.** Saves $32/mo on NAT alone, which is a free-tier killer.
- **arm64 Lambda.** 20% cheaper than x86 per ms.
- **Phone-only auth via Cognito custom triggers.** Cognito's hosted UI is bloated and email-first, so the three custom triggers (`define-auth-challenge`, `create-auth-challenge`, `verify-auth-challenge`) do SMS OTP directly. No magic links, no email field, no password.

### PWA with real iOS support

Every PWA decision was tested against an actual iPhone. Apple's PWA story is famously incomplete, but staying inside the lines (manifest, service worker, push) gets a 95% native experience. The push subscription flow is the gnarliest part: iOS 16.4+ requires the user to install the app first, then enable notifications, in that order. App shortcuts on long-press are gravy and only Android picks them up, but they are two lines of manifest JSON.

### Audit log on every admin write

There's exactly one administrator. Every privileged mutation still writes an `AuditLog` entry, with a diff renderer at `/admin/activity`. The reason is paranoia: deleting something by mistake, or accepting a donation meant to be rejected, should leave a forensic record. It costs about 50 lines of code per route and has already paid for itself twice.

### Tier-based access

Users belong to a `Membership` with a tier: `howdy` (default), `friend`, or `family`. Items can require a minimum tier. The log splitter is `family`-only because it's the kind of equipment where the owner wants to know who is using it. The drill is `howdy`-only because honestly, what's the worst that happens. Tier promotion is manual: the owner promotes people they trust, and the next time the user opens `/me` they get a one-time confetti overlay welcoming them. That single feature is the one thing first-time users mention.

### No abstractions until the second one

The codebase is deliberately boring. There's a `repo.ts` module with one function per data access pattern; there's no ORM, no GraphQL, no event bus. Donations started as a copy of the loan handlers; wishlist and pay-it-forward followed the same path. Three near-identical handlers will eventually become an abstraction; two never will. The codebase is small enough to hold in one head at once, which is the only sustainable architecture there is.

## What running it taught

Roughly in the order they were surprising:

**1. The bookkeeping was 90% of the value.** Known in the abstract, underestimated in magnitude. Once people stopped having to remember if they'd returned the saw, they stopped feeling guilty about borrowing again. Borrow volume tripled in the first month.

**2. SMS sandboxing is a real cost.** Cognito starts in SMS sandbox mode and requires a service quota request to send to non-allowlisted numbers. Approval took three business days. Build this into your launch plan.

**3. iOS push setup is fiddly.** It works, but the order of operations is non-obvious and the failure modes are silent. The smoke test in `docs/smoke-test.md` documents the order that works.

**4. Liability copy needs three tiers.** A drill and a log splitter cannot share confirmation copy. The app resolves `standard` / `power-tool` / `high-value` from item tags. The high-value tier requires explicit owner approval before borrowing; the standard tier is a single-tap acknowledgment.

**5. People love the wood-grain background.** Every design decision was meant to evoke "nice neighbor's garage," not "SaaS dashboard." Permanent Marker for headings, warm gold accents, wood grain on the splash screens. Reviewers consistently flag the visual style as the thing that made them trust the app, which says something both flattering and slightly distressing about the rest of the software industry.

## Why open source

Nobody is selling this. The marginal cost of letting one person borrow a drill is zero, but the marginal cost of running a tool library with payment processing and a customer support queue is enormous, which is why most attempts at this fold within a year. The MIT license means anyone can deploy a copy for their own neighborhood, host it themselves, change the tier names and the tool categories, and owe nothing.

If you have a garage full of stuff and the same problem, this is meant to be useful to you specifically. The deploy guide in `docs/deploy.md` is a 13-step playbook for one afternoon. It covers domain setup, ACM certificates, the awkward Cognito SMS approval, generating real VAPID keys for web push, configuring AWS Budgets for billing alerts (the SAM template's CloudWatch billing alarms only fire if redeployed to `us-east-1`, since `EstimatedCharges` doesn't publish in other regions), and a one-command seed script that bootstraps your owner record.

The whole thing (domain, deploy, first inventory, first borrow) should fit in a Saturday.

## How to spin up your own garage

Read [docs/deploy.md](./deploy.md) in the repo. The short version:

1. Buy a domain.
2. `make deploy-guided`: guided SAM deploy, about 5 minutes. Set `SiteUrl` to your domain and `TenantName` to your garage's name.
3. Request the ACM cert in `us-east-1`, validate via Route 53, uncomment the alias block in `template.yaml`, redeploy.
4. Request Cognito SMS production access (3 business days).
5. Run `pnpm --filter @garageborrow/web exec tsx ../../scripts/gen-vapid.ts --stage prod`.
6. Run the same incantation with `seed-garage.ts` and your owner phone number.
7. Photograph 50 tools at `/admin/items`.
8. Tell your neighbors.

If something doesn't work, open an issue. The repo is at <https://github.com/workshop144/garageborrow>.

Mr. Broots
