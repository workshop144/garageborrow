# I built a tool-lending PWA for my neighborhood, and now you can fork it for yours

_Draft — ~1500 words. Adjust personal details before posting to dev.to / Hacker News / your blog._

---

Garage Borrow started in one person's garage in a small town. People I know come by and borrow things — drills, a log splitter, outgrown camping gear, a 3D printer I overcommitted to. The system that ran it for years was a group text and my own memory, and the system was breaking down. So I built **Garage Borrow**: an open-source neighborhood gear-lending PWA. I'm releasing it under MIT today, and I want to talk about why it exists, who it's for, what's in it, and how to spin one up for your own neighborhood in an afternoon.

## Why I built it

The pitch is one paragraph: _neighbors already share tools. They do it badly, in group chats and DMs, and most of the friction is bookkeeping — who has what, when did they take it, did they return the saw or did Mike still have it from June._ If you've ever been the de facto lender on your block, you know the feeling. Things go out and don't come back; people are too embarrassed to ask twice; the social cost of nagging is real.

Every commercial tool-library platform I looked at solved this with infrastructure that didn't fit: payments, multi-day rentals, fee schedules, insurance attestations, real names on file. I didn't want any of that. I wanted **a phone-numbers-only directory of who has what and a button that says "I have it now."** I built that.

## Who it's for

This is not a marketplace. It is not a startup. It is software for:

- **Small-town tool libraries** that already exist as informal arrangements
- **Churches and community groups** that lend equipment to members
- **Neighborhood gear-sharing collectives** that don't want to charge money or vet members in any formal way
- **One person with a generous garage** and a few dozen tools to share with friends

The minimum viable user count is one — me. The maximum is bounded by how many people the host actually wants to deal with personally, which in my experience is in the low hundreds.

The deliberate non-goals:

- No money handling. Nothing changes hands financially. If your group rents tools for a fee, this isn't your tool.
- No verification rituals. Phone-number sign-up, that's it. Trust comes from being someone the owner knows or someone vouched in by someone they know.
- No native app. It's a PWA. iOS and Android both render it perfectly fine on the home screen. Adding a native app would triple the maintenance surface for zero new functionality.

## Technical highlights

I'll spare you the README; you can read it in the repo. The choices that matter:

### Multi-tenant from day one

Even though I'm only running one garage, the data model has been multi-tenant since the first commit. There's a `Garage` record with a slug, and every other record (`Item`, `Loan`, `Donation`, etc.) lives under `TENANT#<slug>` in DynamoDB. This is the only thing in the design that I'd call a bet on the future, and it's the cheapest possible bet — it costs me nothing today, and if someone forks the repo to run their own garage, the wiring is already there.

### Built to run under $5/month

Concrete cost target. Hard constraint. The whole stack is engineered to live inside the AWS free tier with about $2/month in unavoidable charges (Cognito SMS for OTP sign-in, plus the Route 53 hosted zone). The deliberate choices:

- **HTTP API, not REST API.** $1.00/M requests vs $3.50/M.
- **DynamoDB on-demand.** No provisioned capacity to leave on overnight.
- **CloudFront price class 100.** US/CA/EU edges only. I don't need Sydney.
- **No NAT, no VPC.** Saves $32/mo on NAT alone, which is a free-tier killer.
- **arm64 Lambda.** 20% cheaper than x86 per ms.
- **Phone-only auth via Cognito custom triggers.** Cognito's hosted UI is bloated and email-first; I rewired the three custom triggers (`define-auth-challenge`, `create-auth-challenge`, `verify-auth-challenge`) to do SMS OTP directly. No magic links, no email field, no password.

### PWA with real iOS support

I tested every PWA decision against an actual iPhone. Apple's PWA story is famously incomplete, but if you stay inside the lines (manifest, service worker, push) you can get a 95% native experience. The push subscription flow is the gnarliest part — iOS 16.4+ requires the user to install the app first, then enable notifications, in that order. The app-shortcuts-on-long-press is gravy and only Android picks them up, but it's two lines of manifest JSON.

### Audit log on every admin write

There's exactly one administrator: me. But I built an `AuditLog` write path on every privileged mutation anyway, with a diff renderer at `/admin/activity`. The reason is paranoia: if I ever delete something I shouldn't have, or accept a donation I meant to reject, I want a forensic record. It costs ~50 lines of code per route. It has already saved me twice.

### Tier-based access

Users belong to a `Membership` with a tier: `howdy` (default), `friend`, or `family`. Items can require a minimum tier. The log splitter is `family`-only because it's the kind of equipment where I want to know who's using it. The drill is `howdy`-only because honestly, what's the worst that happens. Tier promotion is manual: I promote people I trust, and the next time the user opens `/me` they get a one-time confetti overlay welcoming them. That single feature has been the one thing first-time users mention.

### No abstractions until the second one

I tried to keep this codebase boring. There's a `repo.ts` module with one function per data access pattern; there's no ORM, no GraphQL, no event bus. When I added donations, I copy-pasted the loan handlers and modified them. When I added wishlist and pay-it-forward, I did the same thing. Three near-identical handlers will eventually become an abstraction; two never will. The codebase is small enough that I can hold it all in my head at once, which is the only sustainable architecture I've ever found.

## What I learned

A few things, in roughly the order they surprised me:

**1. The bookkeeping was 90% of the value.** I knew this in the abstract; I underestimated the magnitude. Once people stopped having to remember if they'd returned the saw, they stopped feeling guilty about borrowing again. Borrow volume tripled in the first month.

**2. SMS sandboxing is a real cost.** Cognito starts in SMS sandbox mode and requires a service quota request to send to non-allowlisted numbers. The approval process took three business days for me. Build this into your launch plan.

**3. iOS push setup is fiddly.** It works, but the order of operations is non-obvious and the failure modes are silent. The smoke test in `docs/smoke-test.md` documents the order I figured out.

**4. Liability copy needs three tiers.** A drill and a log splitter cannot share confirmation copy. I ended up with `standard` / `power-tool` / `high-value` resolved from item tags. The high-value tier requires explicit owner approval before borrowing; the standard tier is essentially a single-tap acknowledgment.

**5. People love the wood-grain background.** Every design decision was meant to evoke "nice neighbor's garage," not "SaaS dashboard." Permanent Marker for headings, warm gold accents, wood-grain on the splash screens. Reviewers consistently flag the visual style as the thing that made them trust the app, which says something both flattering and slightly distressing about the rest of the software industry.

## Why open source

I'm not trying to sell this. The marginal cost of letting one person borrow a drill is zero, but the marginal cost of running a tool library with payment processing and a customer support queue is enormous, which is why most attempts at this fold within a year. Garage Borrow's MIT license means anyone can deploy a copy for their own neighborhood, host it themselves, modify the tier names and the tool categories, and never owe me a thing.

If you're a small-town person with a garage full of stuff and the same problem I had, I want this to be useful to you specifically. The deploy guide in `docs/deploy.md` is a 13-step playbook you can follow in an afternoon. It includes domain setup, ACM certificates, the awkward Cognito SMS approval, generating real VAPID keys for web push, configuring AWS Budgets for billing alerts (because the SAM template's CloudWatch billing alarms only fire if you redeploy them to `us-east-1` — `EstimatedCharges` doesn't publish in other regions), and a one-command seed script that bootstraps your owner record.

The whole thing — domain, deploy, first inventory, first borrow — should fit in a Saturday.

## How to spin up your own garage

Read [docs/deploy.md](./deploy.md) in the repo. The TL;DR:

1. Buy a domain.
2. `make deploy-guided` — guided SAM deploy, takes ~5 minutes.
3. Request the ACM cert in `us-east-1`, validate via Route 53, uncomment the alias block in `template.yaml`, redeploy.
4. Request Cognito SMS production access (3 business days).
5. Run `pnpm --filter @garageborrow/web exec tsx ../../scripts/gen-vapid.ts --stage prod`.
6. Run the same incantation with `seed-garage.ts` and your owner phone number.
7. Photograph 50 tools at `/admin/items`.
8. Tell your neighbors.

If something doesn't work, open an issue. I'll fix it. The repo is at <https://github.com/broots144/garageborrow>.

— Mr. Broots
