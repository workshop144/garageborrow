# Garage Borrow — Claude Code Prompt Sequence

Run these in order, each in a fresh Claude Code session in the cloned repo directory.

---

## Setup before Prompt 1

```bash
cd "/Users/$USER/Documents/Claude/Projects/Dad's Garage"
git clone git@github.com:YOUR-USERNAME/garageborrow.git
cd garageborrow
claude
```

In Claude Code, first add the parent folder so Claude can read the existing design assets (icon-source.svg, TERMS.md, PRIVACY.md, borrow-confirmation-copy.md):

```
/add-dir "/Users/$USER/Documents/Claude/Projects/Dad's Garage"
```

Then paste Prompt 1.

---

## Prompt 1 — Bootstrap monorepo

```
I'm building "Garage Borrow" — an open-source neighborhood gear-lending PWA.
Repo lives at github.com/YOUR-USERNAME/garageborrow, MIT license, public.
First deployed instance is one small-town garage at its own domain.
Multi-tenant from day 1: each "garage" is a tenant, optional `city_slug` facet
on garages for future cross-city discovery (no separate city entity).

Tech stack:
  Frontend: React 18 + Vite + TypeScript (strict) + Tailwind + Framer Motion + 
            vite-plugin-pwa
  API: AWS Lambda (Node 20 + TypeScript, esbuild bundled) behind API Gateway 
       HTTP API, Hono framework, AWS SDK v3 lib-dynamodb client
  Auth: Cognito User Pool (phone-only signup via SMS, no passwords, no email)
  DB: DynamoDB single-table, on-demand billing
  Storage: S3 (private, OAC-fronted via CloudFront) for tool photos
  CDN: CloudFront, price class 100
  Notifications: SNS for SMS, Web Push for in-app
  Region: us-east-2 (Ohio)
  IaC: AWS SAM
  CI: GitHub Actions

Bootstrap a pnpm monorepo with:
  apps/web/          → Vite React PWA, TypeScript strict, Tailwind, 
                       Framer Motion, vite-plugin-pwa configured
  apps/api/          → Hono on AWS Lambda, esbuild bundling, shared tsconfig
  packages/shared/   → Zod schemas, domain types, pure business logic, 
                       DynamoDB key encoders/decoders
  packages/ui/       → Shared React components (extracted later for native reuse)
  infra/             → AWS SAM template.yaml (placeholder for now)
  docs/              → Project documentation
  scripts/           → Utility scripts (icon export, OpenAPI gen, etc.)
  .github/workflows/ → ci.yml: lint, typecheck, test, build on PR
                      deploy.yml: deploy to AWS on push to main

Tooling:
  - pnpm workspaces
  - TypeScript strict everywhere, shared base tsconfig
  - eslint flat config + prettier + husky + lint-staged
  - vitest for unit tests
  - .editorconfig
  - .gitignore covering node_modules, dist, .env*, .aws-sam

Root README.md placeholder with:
  Title: "Garage Borrow"
  Tagline: "Lend what you have. Borrow what you need. An open-source 
            neighborhood gear-sharing platform."
  Stub sections: Why, Quick start, Architecture, Cost, Deploy, License

Add MIT LICENSE file (Copyright YYYY Mr. Broots).
Add CONTRIBUTING.md and CODE_OF_CONDUCT.md (Contributor Covenant 2.1).

Copy these design assets from the parent workspace folder into the repo:
  ../icon-source.svg                  → apps/web/public/icon-source.svg
  ../TERMS.md                          → apps/web/src/content/terms.md
  ../PRIVACY.md                        → apps/web/src/content/privacy.md
  ../borrow-confirmation-copy.md       → docs/borrow-confirmation-copy.md
  ../CLAUDE-CODE-PROMPTS.md            → docs/build-prompts.md

Initialize git, stage everything, make first commit:
  "chore: bootstrap monorepo scaffold"
Don't push — I'll review and push manually.

Don't write actual AWS resources, schemas, UI, or business logic yet. 
Just the scaffolding.
```

---

## Prompt 2 — Domain model + Zod schemas

```
In packages/shared, define the full domain model as Zod schemas in src/schemas/. 
Export TS types via z.infer. Build the DynamoDB key encoders and parsers in 
src/ddb/keys.ts. Cover ALL the following, exactly as designed:

GARAGE (tenant)
  id (slug like "demo-garage"), name, owner_phone (E.164), 
  city_slug ("sample-town"), city_display ("Sample Town, ST"), 
  geo: { lat, lon } | null,
  quality_tiers: string[] (e.g. ["Pro","Standard","Basic","Beat-up"]),
  status: 'open' | 'closed_until' | 'closed_indefinitely',
  closed_until_date?: ISO date,
  payforward_orgs: NonprofitOrg[] (default seed: Example Community Foundation),
  payforward_intro_copy?: string,
  ai_enabled: boolean (default false in MVP),
  ai_min_tier: TierName (default "family"),
  ai_total_monthly_cap_cents: number (default 500),
  ai_default_user_monthly_tokens: number (default 100000),
  ai_default_model: 'haiku' | 'sonnet' (default 'haiku'),
  tier_labels: { howdy: string, friend: string, family: string } (defaults 
              "Howdy", "Friend", "Family", garage owner can rename),
  vouching_required: boolean (default false),
  created_at, updated_at

NONPROFIT_ORG
  name, description?, url?, donate_url?, logo_url?, ein?, display_order

USER
  phone (E.164, primary key for user), display_name (default "FirstName L."),
  visibility: 'visible' | 'hidden' (default 'visible'),
  garages_member_of: string[],
  notification_prefs: { 
    sms_enabled, push_enabled, reminders, waitlist_updates, 
    new_tools, promotion_celebrations,
    quiet_hours_start, quiet_hours_end (HH:MM strings) 
  },
  deleted_at?: ISO timestamp (soft delete; hard delete after 30 days),
  created_at, last_seen_at

GARAGE_MEMBERSHIP (per-garage state for a user)
  garage_id, user_phone,
  tier: 'howdy' | 'friend' | 'family' (default 'howdy'),
  joined_at, vouched_by_phone?,
  borrows_total, borrows_active, returns_on_time, returns_late, no_shows,
  ai_tokens_used_this_month, ai_tokens_used_total, ai_budget_override_tokens?,
  notes?: string (Dad's private notes)

ITEM (the parent "tool type", visible card on pegboard)
  id, garage_id, name, description, category, primary_photo_key,
  handling_notes?, default_duration_days (default 3),
  requires_approval: boolean (default false),
  min_tier: TierName (default 'howdy'),
  auto_approve_tier: TierName (default 'family'),
  approx_value?: number,
  tags: string[],
  donated_by_phone?, donated_by_display?,
  status: 'available' | 'all_loaned' | 'partial_loaned' | 'broken' | 
          'maintenance' | 'retired' | 'lost',
  created_at, updated_at, retired_at?

INSTANCE (specific physical unit of an Item; only used when Item has >1)
  id, item_id, garage_id, label, quality_tier, notes?,
  status: 'available' | 'loaned' | 'reserved' | 'maintenance' | 'broken' | 
          'retired',
  current_loan_id?, created_at, updated_at

LOAN (active or completed borrow)
  id, garage_id, item_id, instance_id?, borrower_phone,
  borrowed_at, expected_return_at, actual_return_at?,
  status: 'active' | 'returned' | 'overdue' | 'lost',
  extension_count: number, last_extended_at?,
  liability_acknowledged_at: ISO timestamp,
  liability_copy_version: string

RESERVATION (future borrow)
  id, garage_id, item_id, instance_id?, borrower_phone,
  start_at, end_at, status: 'pending' | 'approved' | 'declined' | 'cancelled',
  approval_required: boolean, decided_by_phone?, decided_at?, decline_reason?

WAITLIST_ENTRY
  id, garage_id, item_id, borrower_phone, joined_at, position,
  notify_when_available: boolean

DONATION_OFFER
  id, garage_id, donor_phone, item_name, description, photo_keys: string[],
  condition: 'new' | 'good' | 'fair' | 'poor',
  donor_notes?, suggested_category?,
  status: 'pending' | 'accepted' | 'declined' | 'received',
  decided_at?, decided_by_phone?, dad_notes?, decline_reason?,
  resulting_item_id?, created_at

INCIDENT_REPORT (damage/loss)
  id, garage_id, item_id, loan_id, reporter_phone,
  type: 'damage' | 'loss' | 'malfunction',
  description, photo_keys: string[], suggested_action?,
  status: 'open' | 'resolved' | 'closed',
  created_at, resolved_at?

NOTIFICATION
  id, user_phone, garage_id?, type, payload: jsonb, channel: 'sms' | 'push' | 
  'inapp', sent_at, read_at?

PUSH_SUBSCRIPTION
  user_phone, endpoint, keys: { p256dh, auth }, created_at

AI_INTERACTION
  id, garage_id, user_phone, timestamp, model, prompt_tokens, 
  completion_tokens, cost_cents (integer), prompt_first_200

DDB single-table key encoder/parser (src/ddb/keys.ts):
  TENANT#{garage_id}              | META
  TENANT#{garage_id}              | USER#{phone}
  TENANT#{garage_id}              | MEMBER#{phone}
  TENANT#{garage_id}              | ITEM#{item_id}
  TENANT#{garage_id}              | ITEM#{item_id}#INST#{instance_id}
  TENANT#{garage_id}              | LOAN#{date}#{loan_id}
  TENANT#{garage_id}              | RES#{date}#{res_id}
  TENANT#{garage_id}              | WAIT#{item_id}#{ts}#{phone}
  TENANT#{garage_id}              | DONATION#{date}#{id}
  TENANT#{garage_id}              | INCIDENT#{date}#{id}
  TENANT#{garage_id}              | AVAIL#{dow}#{start}  (future visit feature)
  TENANT#{garage_id}              | AI#{date}#{interaction_id}
  USER#{phone}                    | NOTIFICATION#{ts}#{id}
  USER#{phone}                    | PUSH#{endpoint_hash}

GSIs:
  GSI1 byUser:           PK = USER#{phone}, SK = LOAN#{ts} or RES#{ts}
  GSI2 byInstanceStatus: PK = INST#{item_id}#{instance_id}, SK = STATUS#{status}

Add unit tests with vitest covering:
  - Round-trip encoding/decoding of every key shape
  - Schema validation of each entity (positive + negative cases)
  - Helper: tier resolution function (item access decision: hidden | request | 
    instant) with truth-table coverage

Export everything from packages/shared/src/index.ts.
Don't touch apps/api or apps/web yet — schemas only.
```

---

## Prompt 3 — AWS SAM infrastructure

```
In infra/template.yaml, write a complete AWS SAM template for the Garage Borrow 
backend. Region us-east-2. Cost target < $5/mo.

Resources:

DynamoDB Table "GarageBorrow":
  - On-demand billing
  - PK + SK both string, plus 2 GSIs (byUser, byInstanceStatus)
  - TTL attribute "expires_at"
  - Point-in-time recovery enabled
  - Stream enabled (NEW_AND_OLD_IMAGES) for future event processing

Cognito User Pool:
  - Phone-only signup, SMS via SNS (verified phone required)
  - No email, no password, no aliases — phone IS the username
  - Auto-verified phone
  - Custom attributes: "garages" (string list, max 20)
  - SMS authentication only
  - MFA off (SMS code IS the auth)
  - Password policy: not applicable (no passwords)

Cognito User Pool Client:
  - PKCE flow, no secret (used by PWA directly)
  - Refresh token validity 30 days
  - Access token validity 1 hour

S3 Buckets:
  - garageborrow-images-{stage}: private, OAC-fronted via CloudFront, 
    versioning on, lifecycle rule: noncurrent versions to Glacier IA 
    after 30 days
  - garageborrow-web-{stage}: private, OAC-fronted, for static PWA hosting

CloudFront Distribution:
  - Two origins: web bucket at /, images bucket at /img/*
  - Price class 100 (US/Canada/Europe only)
  - Custom domain placeholder: yourgarage.com (commented out — owner adds 
    after ACM cert validation)
  - HTTPS only, redirect HTTP→HTTPS
  - Default cache behavior: SPA fallback (404→/index.html)
  - Compression on

API Gateway HTTP API:
  - JWT authorizer pointing at Cognito User Pool
  - CORS: yourgarage.com + localhost:5173 (dev)
  - Throttling: 50 RPS burst, 25 sustained per route (cheap protection)

Lambda functions (Node 20, esbuild, 512MB each):
  - api: main HTTP handler, all routes via Hono router (apps/api/src/index.ts)
  - notifier: invoked by EventBridge daily at 9am ET for overdue reminders + 
              reservation pre-day reminders
  - image-resizer: S3 ObjectCreated trigger, generates thumb/medium variants
  - account-cleaner: invoked daily, hard-deletes users with 
                     deleted_at > 30 days ago

EventBridge:
  - Rule: daily 9:00 AM ET (cron 0 14 * * ? *) → notifier Lambda
  - Rule: daily 3:00 AM ET → account-cleaner Lambda

SES (in us-east-2):
  - Identity verification config (placeholder; production access requires 
    manual support ticket)
  - Used for: data export emails (when user requests data download)

SSM Parameters:
  - /garageborrow/{stage}/vapid_public_key
  - /garageborrow/{stage}/vapid_private_key
  - /garageborrow/{stage}/cognito_client_id (output, also written here)

CloudWatch Alarms:
  - Billing alarm at $5, $10, $25 (SNS → owner phone)
  - Lambda error rate > 5% over 5 min → SNS
  - DynamoDB throttling > 0 → SNS

IAM (least privilege):
  - api Lambda: DDB CRUD on GarageBorrow + GSIs, S3 PutObject/GetSignedURL on 
    images bucket, SNS Publish for SMS, Cognito AdminGetUser, SES SendEmail
  - notifier Lambda: DDB read, SNS publish, web-push (no AWS perms needed)
  - image-resizer Lambda: S3 read/write on images bucket only

Outputs:
  ApiUrl, CloudFrontUrl, UserPoolId, UserPoolClientId, ImagesBucketName, 
  WebBucketName, DdbTableName

Choices to confirm align with cost target (< $5/mo):
  - HTTP API (not REST API) ✓
  - On-demand DDB ✓
  - CloudFront price class 100 ✓
  - No NAT gateway, no VPC ✓
  - No Aurora, no ElastiCache ✓

Also generate:
  infra/samconfig.toml (stub with us-east-2 region)
  Makefile at repo root with: build, deploy-guided, deploy, logs-api, 
                              logs-notifier, destroy
  scripts/gen-vapid.ts (writes new VAPID keypair to SSM)

Do not deploy. Just the template + samconfig + Makefile.
```

---

## Prompt 4 — API handlers

```
Build apps/api/src using Hono with the AWS Lambda adapter. Single bundled 
Lambda handler entry at src/index.ts; route modules in src/routes/.

JWT auth middleware extracts phone from Cognito sub on protected routes. 
Use @aws-sdk/lib-dynamodb DocumentClient (singleton, reused across invocations). 
Use packages/shared schemas for all input validation and response shaping. 
Structured logging with pino, redact phone numbers in logs.

Routes (all return JSON; error shape: { error: { code, message, details? }}):

PUBLIC:
  GET    /v1/health                    → liveness check

AUTHED (JWT required):
  GET    /v1/me                        → user + memberships across all garages
  PATCH  /v1/me                        → update display_name, visibility, 
                                          notification_prefs
  POST   /v1/me/delete-request         → soft-delete user, schedule hard delete
  GET    /v1/me/data-export            → trigger SES email with JSON export
  POST   /v1/me/push-subscription      → register web-push subscription

  GET    /v1/g/:garage                 → garage profile + member's tier 
                                          (does NOT reveal own tier name)
  GET    /v1/g/:garage/items           → list items filtered by user's tier 
                                          (resolution logic: hidden|request|
                                          instant per item)
  GET    /v1/g/:garage/items/:id       → item detail with instance list, 
                                          handling_notes, status pills
  GET    /v1/g/:garage/members         → public directory (visible-only, with 
                                          display_name + active borrows + 
                                          borrows_total)

  POST   /v1/g/:garage/loans           → instant borrow (validates tier, 
                                          captures liability acknowledgment)
  POST   /v1/g/:garage/reservations    → reserve future or request approval
  POST   /v1/g/:garage/loans/:id/extend → extend (no approval, notifies owner)
  POST   /v1/g/:garage/loans/:id/return → mark returned 
                                          (auto-confirm after 48h silence)
  POST   /v1/g/:garage/items/:id/waitlist → join waitlist
  DELETE /v1/g/:garage/waitlist/:id    → leave waitlist

  POST   /v1/g/:garage/donations       → submit item donation offer
  GET    /v1/g/:garage/donations/mine  → see donations I've offered

  POST   /v1/uploads/sign              → presigned S3 PUT for tool/donation 
                                          photo (returns key + url)

OWNER-ONLY (verify phone == garage.owner_phone):
  POST   /v1/g/:garage/items                    → create item
  PATCH  /v1/g/:garage/items/:id                → update item
  POST   /v1/g/:garage/items/:id/instances      → add instance
  PATCH  /v1/g/:garage/items/:id/instances/:iid → update instance
  POST   /v1/g/:garage/items/:id/retire         → set status retired
  POST   /v1/g/:garage/loans/:id/dispute        → dispute return claim
  POST   /v1/g/:garage/incidents                → log damage/loss

  GET    /v1/g/:garage/admin/donations          → list all donation offers
  POST   /v1/g/:garage/admin/donations/:id/decide → accept|decline; on accept 
                                                     auto-creates Item

  GET    /v1/g/:garage/admin/members            → all members with tier + stats
  PATCH  /v1/g/:garage/admin/members/:phone     → set tier, set notes
  GET    /v1/g/:garage/admin/promotion-suggestions → users with N+ on-time 
                                                      returns suggesting 
                                                      promotion

  PATCH  /v1/g/:garage/admin/settings           → name, status, vacation, 
                                                   tier_labels, payforward_orgs, 
                                                   ai_*

OPENAPI:
  GET    /v1/openapi.json              → auto-generated from Zod schemas via 
                                          @asteasolutions/zod-to-openapi
  GET    /v1/docs                      → Scalar UI rendering of OpenAPI spec

Tier resolution logic (apply to GET /items and POST /loans):
  if user.tier < item.min_tier        → hide item from list / 403 on borrow
  elif user.tier >= item.auto_approve_tier → instant borrow
  else                                → require approval (creates Reservation 
                                         with approval_required=true)

Liability copy versioning: store current version string (e.g. "v1-2026-04") 
on each Loan. When copy is updated, increment version.

Idempotency: support `Idempotency-Key` header on all POST routes, dedup via 
DDB record TTL'd at 24h.

Atomic counters: use DDB UpdateExpression with ADD for borrows_total, 
ai_tokens_used_*, etc. — never read-modify-write.

vitest unit tests with aws-sdk-client-mock covering:
  - Tier resolution truth table
  - Borrow flow happy path + rejection cases
  - Approval flow
  - Donation accept/decline → Item creation
  - Auto-confirm return after 48h
  - JWT middleware (valid, expired, missing, wrong tenant)

Don't write the notifier or image-resizer Lambdas yet — those come later.
```

---

## Prompt 5 — PWA shell, auth, Workshop theme, dark mode

```
Build apps/web — the PWA frontend skeleton, auth flow, and base theme.

Workshop palette (define in tailwind.config.ts as CSS variables, 
both light and dark mode variants):
  Primary gold:        #B5A66B   (Tiger gold)
  Accent gold:         #DAAF35   (civic gold, brighter)
  Bright bg gold:      #E8B833   (matches app icon background)
  Workshop dark:       #1A1A1A   (text, headers in light mode)
  Surface light:       #FAF7F0   (warm off-white background)
  Surface dark:        #2A2018   (warm dark background, dark mode)
  Status available:    #4A7C59   (earthy green)
  Status out:          #C97D3F   (warm rust)
  Status overdue:      #B85042   (muted red)
  Tier howdy:          #E5D5A0   (pale gold)
  Tier friend:         #B5A66B   (tiger gold)
  Tier family:         #DAAF35   (rich amber, the "celebrated" gold)

Wood-grain background: SVG tile in src/assets/wood-grain.svg (warm brown 
striations on the surface color, both light + dark variants).

Pegboard dot pattern: SVG tile in src/assets/pegboard-dots.svg (subtle dots, 
gold on surface).

Typography:
  Headings:      "Permanent Marker" (Google Fonts) — for hero titles, "DAD" 
                 voice moments, status pills
  Body:          Inter variable
  Mono (code):   JetBrains Mono (used in admin debug views only)

PWA configuration (vite-plugin-pwa):
  - manifest:
      name: "Demo Garage"  (configurable per tenant build)
      short_name: "Garage"
      theme_color: "#E8B833"
      background_color: "#FAF7F0"
      display: standalone
      orientation: portrait
      icons: 192, 512, 180 (Apple touch), maskable variants
  - registerType: prompt
  - workbox runtime caching:
      api → networkFirst, 5min
      images → cacheFirst, 30 days, maxEntries 100
      static → cacheFirst, immutable
  - offline fallback page at /offline.html

Icon export:
  scripts/export-icons.ts — read public/icon-source.svg, produce:
    public/icon-192.png
    public/icon-512.png
    public/icon-180-apple.png
    public/icon-32-favicon.png
    public/icon-maskable-192.png (with safe-area padding)
    public/icon-maskable-512.png
  Use sharp for SVG→PNG. Run as part of the build script.

React Router v6 setup:
  /                  → Pegboard (home)
  /login             → Phone entry + OTP
  /onboarding        → 3-screen tour after first login
  /tool/:id          → Tool detail
  /me                → My Stuff
  /me/profile        → Edit display_name, visibility, notification prefs
  /me/notifications  → Notifications inbox
  /donate            → Donate item flow
  /pay-it-forward    → Pay-it-forward page (configurable nonprofits)
  /admin             → Admin (owner-only, gated)
  /admin/items       → Inventory
  /admin/members     → Tier management
  /admin/donations   → Donation review queue
  /admin/incidents   → Incident reports
  /admin/settings    → Garage settings
  /legal/terms       → renders terms.md
  /legal/privacy     → renders privacy.md

Auth flow (using amazon-cognito-identity-js):
  Step 1: Phone entry → Cognito.signUp / signIn → SMS code dispatched
  Step 2: OTP entry → confirms → returns JWT
  Tokens stored in memory (not localStorage). Refresh hook auto-refreshes 
    access token.
  AuthContext + useAuth hook + ProtectedRoute wrapper.

API client (src/lib/api.ts):
  Typed fetch wrapper auto-injecting Bearer JWT.
  Types imported from packages/shared.
  Error envelope normalization.

Dark mode:
  Auto-follows prefers-color-scheme.
  Manual override toggle in /me/profile.
  All components use Tailwind dark: variants.
  Wood grain bg has dark variant.
  All status colors meet WCAG AA in both modes.

Onboarding 3-screen tour (shown after first OTP confirm):
  Screen 1: "Tap to borrow. That's it."  (hand pulling tool off pegboard)
  Screen 2: "Bring it back when you can. No big deal."  (tool returning)
  Screen 3: "If something goes sideways, just text Dad."  (phone icon)
  Skip button always available.

Error boundary at app root with friendly fallback:
  "Well, something broke. Let's try that again." + retry button.

Stub the Pegboard page with a placeholder grid for now.
Wire auth fully end-to-end so I can phone-login on real Cognito after deploy.
```

---

## Prompt 6 — Pegboard home

```
Build apps/web/src/pages/Pegboard.tsx — the home screen and visual centerpiece.

Visual concept (refined per design):
  - Wood-grain SVG bg as the primary surface
  - Subtle pegboard dot pattern overlaid (use src/assets/pegboard-dots.svg)
  - Tool cards rendered as labeled items "hanging on the pegboard"
  - Each card: 3D-ish box with subtle drop shadow, slight rotation 
    (-2 to +2 deg, randomized per card stable on item id) for organic feel
  - Tool photo as the "label"
  - Tool name in Permanent Marker font, sentence case
  - Status pill: small rounded badge with semantic color
      "Available" (green)
      "All out — back ~Sat" (rust + relative time)
      "Some available" (amber, when partial_loaned)
      "Family only — text Dad" (pale gold, when blocked by min_tier)
      "Ask Dad" (amber, when requires_approval and user not at auto_approve)
  - Quantity badge if item has multiple instances ("3 of 5 ready")
  - Bottom of card: small "Donated by Bob S." badge if donated_by_display set

Filter bar at top:
  - Category chips (dynamically generated from items in this garage)
  - Search input (filters by name, description, tags)
  - "Available now" toggle
  - "Sort: recently added | most borrowed | A-Z"

Bottom nav (mobile-first):
  Pegboard | My Stuff | Donate | (Admin if owner) | Profile
  Each with icon + label. Active state = gold background.

Framer Motion:
  - Stagger entrance on page load (card-by-card)
  - Hover: lift + scale 1.02 + drop shadow grows
  - Tap: spring press
  - Tap card → navigate /tool/:id with shared layoutId so card "expands" 
    into detail view

Empty states:
  - No items in garage: "Dad hasn't put anything on the pegboard yet."
  - No items match filter: "Nothing matches that. Try a different filter."

Tier-aware filtering done server-side (Prompt 4 already handles min_tier 
hiding). Frontend just renders what API returns.

Pull-to-refresh on mobile (use react-pull-to-refresh or DIY).

Empty pegboard background still shows the wood-grain + dots so the page 
doesn't feel barren.

Wire to API endpoint GET /v1/g/:garage/items.
Use react-query (TanStack Query) for caching and invalidation.
```

---

## Prompt 7 — Tool detail + borrow / reserve / waitlist flows

```
Build apps/web/src/pages/ToolDetail.tsx and the borrow drawer.

ToolDetail layout:
  - Hero: large item photo (Framer Motion shared layoutId from Pegboard card)
  - Title in Permanent Marker
  - Category, tags, donor credit if any
  - Description prose
  - Handling notes block (if present): yellow callout box, 
    icon + "Worth a heads up:" prefix, in italic
  - Instance list (only if >1 instance):
      Each row: small thumb (or item photo if no instance photo), label, 
      tier badge, status. Tap to select.
  - Primary action button (state-driven):
      available → "Borrow it" (button: brand gold)
      requires_approval (user below auto_approve_tier) → "Request to borrow"
      all_loaned → "Join waitlist (#N in line)"
      below min_tier → "Family only — text Dad" (disabled, opens SMS link)

Borrow drawer (slides up from bottom on mobile, modal on desktop):
  Step 1 — Pick instance (skipped if only one):
    Cards for each available instance with tier badge
  Step 2 — Pick return date:
    "When do you think you'll bring it back?"
    Quick chips: Today, This weekend, Next weekend, In a week, In two weeks
    Custom date picker
    Helper text: "Just a guess. Easy to extend later."
    Default chip selection based on item.default_duration_days
  Step 3 — Optional note to owner (free text, 200 char max)
  Step 4 — Liability acknowledgment (from docs/borrow-confirmation-copy.md):
    Pick the tier of copy based on item characteristics:
      power tools / sharp / heavy items → power tool copy
      trailer / log splitter / 3D printer / CNC → high-value copy
      everything else → standard copy
    Display in yellow-bordered callout above confirm button
  Confirm button:
    "Take it home" (instant) or 
    "Send request to Dad" (approval) or 
    "Join the waitlist"
  On success: confetti + box-lifting animation + redirect to /me

Extension flow (on My Stuff page):
  "Need it longer?" button → drawer with chips: +3 days, +1 week, +2 weeks, 
    pick date
  No approval needed — instantly extends; SMS to Dad: "Bob extended the drill 
    until next Saturday."

Waitlist:
  POST joins waitlist; response includes position
  When item becomes available, server notifies position #1 (web push + SMS 
  fallback)
  /tool/:id shows "You're #2 in line" if user is on waitlist
  "Leave waitlist" button always available

Use Idempotency-Key header on all POSTs (uuidv4 generated client-side per 
attempt, retried on transient failure).

Optimistic UI updates: borrow tap shows immediate "borrowing..." state; 
rollback on error.

All API calls via packages/shared types. No `any`.
```

---

## Prompt 8 — My Stuff, profile, public directory, privacy preview

```
Build apps/web/src/pages/MyStuff.tsx, ProfileSettings.tsx, and Members.tsx.

MyStuff (/me):
  Section 1 — "You have these right now"
    Each loan card:
      Item photo, name, borrowed date (relative: "since Tuesday")
      Expected return: "due ~Sat" (relative)
      Buttons: "Mark returned", "Need it longer" (extension flow)
      If overdue: gentle copy "Just checking in" with extension nudge
  Section 2 — "Reserved"
    Upcoming reservations with start/end dates
    Cancel button
  Section 3 — "Waiting on"
    Items I'm waitlisted for + position
    "Leave waitlist" button
  Section 4 — "Stats" (small chips at top)
    "12 borrowed · 11 on time · 1 out now"
  Empty state: "Pegboard's full and your hands are empty. Go grab something."

ProfileSettings (/me/profile):
  - Display name input (default "FirstName L." but editable)
  - Visibility toggle: "Visible" / "Hidden" with PREVIEW BLOCK showing both 
    states side-by-side ("Here's what others see")
      Visible:  "Bob S. — has the trailer until Sat. 12 borrows total."
      Hidden:   "A neighbor has the trailer until Sat."
  - Notification preferences (toggles + quiet hours):
      Reminders, waitlist updates, new tools, promotion celebrations
      Quiet hours start/end pickers
      SMS vs push channel selection (push prompt on first enable)
  - Dark mode: System / Light / Dark
  - Language: English (locked, future-prep only)
  - "Download my data" button (POST /v1/me/data-export, emails JSON)
  - "Delete my account" button (POST /v1/me/delete-request, requires 
    OTP confirm, schedules hard delete in 30 days, banner shows 
    "Account scheduled for deletion in N days · Cancel")

Public Members directory (/g/:garage/members):
  - Grid of member cards (visible members only)
  - Each card: avatar (or initials), display_name, 
    active borrows count + names, total borrows count, 
    member since (relative), tier label HIDDEN from non-owners
  - Search/filter by name
  - Owner sees their own cards + tier badge

Family-tier promotion celebration:
  - Detected via push notification or app open
  - Full-screen overlay first time it's seen:
    Confetti animation
    "Dad just gave you the keys."
    "Anything in the garage is yours to grab whenever."
    "Got it" button to dismiss
  - Subsequent app opens: small "Family member" badge on profile

All copy in Dad-voice, warm and informal.
```

---

## Prompt 9 — Admin (Inventory, Tiers, Vouching, Donations, Vacation, Settings)

```
Build apps/web/src/pages/admin/ — owner-only views, gated by user phone == 
garage.owner_phone (verified via /v1/me).

Admin layout: sidebar nav with sections, content area on right.

Sidebar:
  Out right now | Inventory | Members | Donations | Incidents | Settings

OutRightNow (/admin):
  Real-time list of active loans
  Each row: item, borrower (name + phone with tap-to-call), 
            borrowed date, expected return, "Mark returned" + "Send reminder"
  Color-coded urgency: green (within window), amber (due today), red (overdue)

Inventory (/admin/items):
  List view of all items with photo, name, category, 
    instance count, status pill
  Search + filter
  FAB "+ Add tool"
  Tap item → edit drawer:
    Photo upload (camera or library, presigned PUT to S3)
    Name, description, category (combobox with autocomplete from existing)
    Handling notes
    Default duration days
    Requires approval toggle
    Min tier dropdown (Howdy / Friend / Family)
    Auto-approve tier dropdown
    Tags (chip input)
    Approx value (optional, for owner reference)
    Instances (rows, add/edit/remove):
      Label, quality_tier (from garage.quality_tiers), notes, status
    "Retire item" button (sets retired_at)

Members (/admin/members):
  List of all garage members
  Columns: display_name (real name visible to owner), phone, tier, 
           borrows_total, on-time rate, member since, vouched by
  Tap → drawer:
    Set tier dropdown (Howdy / Friend / Family / + future tiers if defined)
    Notes (private to owner)
    Borrow history list
  Promotion suggestions banner at top:
    "Bob has had 5 on-time returns. Promote to Family?"
    Yes/No buttons; Yes promotes + sends celebration notification

Donations (/admin/donations):
  Inbox of pending donation offers
  Each: photo gallery, donor name, item name, condition, donor notes
  "Accept" → drawer to fill in category/tier/instance details, then 
              POST creates Item (with donated_by credit)
  "Decline" → optional reason text → notifies donor politely

Incidents (/admin/incidents):
  Inbox of reported damage/loss
  Each: photo, description, reporter, related loan
  Status: open/resolved/closed
  Resolve → optional resolution notes

Settings (/admin/settings):
  Garage profile:
    Name, city_slug, city_display, geo (lat/lon picker)
    Status: Open / Closed until (date) / Closed indefinitely
  Tier configuration:
    tier_labels object — let owner rename Howdy/Friend/Family 
    or add custom tiers
    quality_tiers list — edit array
  Vouching:
    Toggle vouching_required
  Pay it forward:
    Reorder/edit/add nonprofit list
    Edit intro copy override
  AI:
    All AI settings (currently feature-flagged off)
    Enable AI toggle (default off in MVP)
    Min tier dropdown
    Default model (Haiku/Sonnet)
    Per-user monthly token budget
    Garage-wide monthly cap (cents)
    "Coming soon — keep checking back" banner if disabled
  Friends-of-friends:
    Add another garage owner's phone to "trust network" 
    (creates cross-garage discoverability — placeholder for v1.5)

All admin actions hit /v1/g/:garage/admin/* routes (owner-gated server-side).
Use react-query mutations with optimistic updates.
```

---

## Prompt 10 — Donate flow + Pay It Forward + AI Coming Soon

```
Build the borrower-facing donation submission, the Pay It Forward page, 
and the AI placeholder card.

Donate flow (/donate):
  Multi-step form, friendly copy throughout:
  Step 1: "What are you donating?" — name + description text inputs
  Step 2: Photo upload (1-3 photos, presigned S3, square crop encouraged)
  Step 3: Condition picker (New / Good / Fair / Poor with examples)
  Step 4: Optional notes for Dad
  Step 5: Suggested category (combobox, optional)
  Step 6: Confirm
    "Dad will look at this and either welcome it into the garage or let you 
     know it's not a fit. No pressure either way."
    "Submit" → POST /v1/g/:garage/donations
  Success screen:
    "Thanks for the offer. We'll let you know either way."
    Link back to Pegboard

My Donations (/me/donations):
  List of donation offers I've made with status
  Pending: "Dad's looking at it"
  Accepted: "It's in the garage now — see it on the pegboard"
  Declined: "Dad passed on this one. Reason: {reason if provided}"

Pay It Forward (/pay-it-forward):
  Hero: "Demo Garage takes no money — ever."
  Garage's payforward_intro_copy below hero 
    (default Dad-voice copy if not set)
  List of configured nonprofits (cards):
    Logo (or placeholder), name, description, "Visit their site" CTA
  Default seed for Demo Garage tenant:
    Example Community Foundation (URL placeholder until owner confirms)
  Footer copy: "Want to give back another way? Donate something to the 
                garage instead — borrowers can pass that gear along to 
                others for years. [Donate something →]"

AI Coming Soon card on Pegboard home (Family-tier only):
  Visible only to Family members
  Card style: gold gradient, slightly different from regular tool cards
  Title: "Ask Dad's Garage" 
  Body: "Coming soon. AI helper to find the right tool, walk you through 
         using it, or sort out a project."
  CTA: "Get notified when it's ready" → toggles a flag on user's notification 
       prefs
  Footer: "Family perk · Coming soon"
  Server-side: hidden when garage.ai_enabled = false (just renders the 
               coming-soon card); when ai_enabled flips to true and a model 
               is configured, the card becomes interactive (chat input).

All flows use Dad-voice copy. No money handling anywhere. No payment processor.
```

---

## Prompt 11 — Notifications + scheduled reminders

```
Wire push notifications, SMS fallback, and the scheduled-reminders Lambda.

Frontend (apps/web):
  Notification permission prompt on first borrow (with rationale: "So we can 
    let you know when stuff you're waiting on opens up.")
  Subscribe via /v1/me/push-subscription with VAPID public key from 
    SSM (fetch via /v1/health which returns it)
  Service worker handles 'push' events:
    Renders notification with title, body, icon (192px), 
    click → focus app at relevant route
  In-app notifications inbox at /me/notifications:
    List of recent notifications (last 30 days)
    Mark all read button
    Tap → navigate to relevant page

Backend — notifier Lambda (apps/api/src/notifier.ts):
  Triggers:
    EventBridge daily 9am ET cron
    Direct invoke from main api Lambda on events
  
  Daily cron tasks:
    1. Find loans with expected_return_at = today and not returned 
        → soft reminder: "Hey, the chainsaw is due back today. No worries 
           if you need more time, just hit extend."
    2. Find loans 2 days overdue 
        → gentle reminder: "Just checking — still got the saw? All good 
           if so, just wanted to make sure it didn't get lost in the shuffle."
    3. Find reservations starting tomorrow 
        → reminder: "You've got the trailer tomorrow. Text Dad to coordinate 
           pickup."
  
  Direct invoke triggers (from main api):
    - Item became available → notify position 1 on waitlist
    - Tier promoted to Family → celebration notification
    - Donation accepted → notify donor
    - Borrow request approved/declined → notify requester
    - Hard delete in 7 days → final warning

  Channel selection per user preferences:
    push_enabled + has subscription → web-push
    sms_enabled + within quiet hours? → SMS via SNS
    fallback: in-app inbox only

  Use 'web-push' npm package; SNS for SMS.

Quiet hours enforcement:
  If now is within user's quiet_hours_start..quiet_hours_end (in user's 
   inferred timezone — assume America/New_York for MVP), defer 
   non-urgent notifications until end of quiet hours. "Urgent" = waitlist-now 
   and approve/decline; everything else is deferrable.

Atomic counters: notifications_sent_today per user, capped at 5 to prevent 
spam.

vitest tests for:
  Quiet hours logic
  Channel selection
  Cron task: identifies correct loans
  Direct invoke: payload validation
```

---

## Prompt 12 — Legal pages, polish, ship checklist

```
Final pass. Wire the legal content from the workspace, accessibility audit, 
deploy guide, README finalization.

Legal pages:
  apps/web/src/content/terms.md is the source of truth (already in repo from 
    Prompt 1)
  apps/web/src/content/privacy.md same
  Render via /legal/terms and /legal/privacy:
    react-markdown with Tailwind prose styling
    Wood-grain bg, surface card, comfortable line-height
    "Last updated" badge prominent
    Linked from Settings, footer, and account-deletion confirm
  Both pages must be reachable from the bottom nav via Profile → Settings → 
    Legal

Borrow confirmation copy:
  Use docs/borrow-confirmation-copy.md as content reference
  Already wired into Prompt 7's borrow drawer; verify the three tiers 
    (standard / power-tool / high-value) are correctly mapping to 
    item characteristics

Accessibility pass:
  All interactive elements have ARIA labels
  Focus rings visible (Tailwind `focus-visible:` utilities)
  prefers-reduced-motion media query disables Framer animations
  Color contrast: every text/bg combo passes WCAG AA in light + dark
  Skip-to-content link
  Keyboard nav fully usable (no mouse-only flows)
  Lighthouse audit: target 90+ Performance / 95+ Accessibility / 95+ 
    Best Practices / 90+ SEO

PWA polish:
  Apple meta tags so "Add to Home Screen" works clean on iOS:
    apple-mobile-web-app-capable, apple-mobile-web-app-status-bar-style, 
    apple-touch-icon
  Splash screens for iOS (multiple sizes via vite-plugin-pwa or manual)
  Theme color matches Tiger gold (#E8B833)

README finalization (root README.md):
  Title + tagline
  Hero screenshot (placeholder; Claude Code generates a Lighthouse-style 
    mockup or instructs how to capture)
  Why section (3 paragraphs from earlier conversation)
  Quick start (one-command deploy via `make deploy-guided`)
  Architecture diagram (mermaid or simple ASCII)
  Cost breakdown (table: estimated AWS spend at small scale)
  Configuration (env vars, customization)
  Roadmap (Phase A complete, Phase B visit-feature noted as future)
  Contributing link
  License (MIT)

CONTRIBUTING.md and CODE_OF_CONDUCT.md (already created in Prompt 1, expand 
  with: how to test locally, how to submit a PR, how to deploy your own 
  garage)

Launch blog post draft at docs/launch-post.md (markdown):
  Story-style post explaining why you built it, what it does, technical 
  highlights, why open source. ~1500 words. For posting on dev.to / Medium / 
  personal blog when ready.

Smoke test plan in docs/smoke-test.md:
  Real device (iPhone + Android) test script:
    Sign up via SMS → onboarding → first borrow → return → admin add tool → 
    add donation → tier promotion → push notification.

Domain + CloudFront wiring:
  Document in docs/deploy.md the manual steps for adding yourgarage.com:
    1. Buy domain at Route 53 console
    2. Create hosted zone (already in SAM template, automatic)
    3. Request ACM cert (us-east-1 required for CloudFront, separate from 
        us-east-2 stack)
    4. Add CNAME validation records
    5. Update CloudFront distribution to use custom domain
    6. Update Cognito callback URLs to https://yourgarage.com

CloudWatch billing alarms reminder: confirm $5 / $10 / $25 thresholds wired 
  to owner phone

Final commit: "feat: v1.0 ready for launch"

Tag: v1.0.0
```

---

## After all 12 prompts

Manual steps:
1. Run `make deploy-guided` once for first deploy
2. Buy `yourgarage.com` and `garageborrow.com` at Route 53
3. Wire CloudFront custom domain (per docs/deploy.md)
4. Cognito SMS production access request (manual support ticket)
5. Set garage owner phone in DynamoDB seed
6. Photograph and upload first 50 inventory items
7. Invite first borrowers via SMS
8. Have an attorney glance at TERMS.md and PRIVACY.md
9. Push to GitHub, announce in r/selfhosted, Hacker News, dev.to

Total estimated session time: 8–12 hours of LLM time across 12 prompts.
Total dev cost on AWS at this scale: ~$2–3/month.
