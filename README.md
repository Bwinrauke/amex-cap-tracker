# 4x Cap Runway

A points-maximizing tracker for business card spend. It watches bonus-category
spend against each card's own annual cap and answers the question that
actually matters: **which card should the next charge go on?**

Built for a mixed portfolio — Amex Business Gold, Amex Business Platinum and
Chase Ink Business cards all earn at different rates under different caps.

Next.js 15 (App Router, TypeScript) on Vercel, reading an existing Supabase
project.

## What it does

- **Dashboard** — bonus points still capturable this year, per-card cap
  meters, burn rate, projected exhaust date, and a recommendation naming the
  card the next charge should go on.
- **Charge planner** — enter an amount and see what every card would actually
  earn on it, plus the best way to split a charge too large for one card's
  bonus headroom.
- **Import** — upload a statement CSV. Preview parses, classifies and diffs it
  against what is already stored **without writing anything**; commit writes
  only the rows you ticked.
- **Charges** — the full log with each charge's bonus / base split.
- **Accounts** — per-card rates, caps and opening-balance provenance.
- **Connections** — import history, and Plaid when it is switched on.

## How the recommendation works

Ranking by *remaining runway* is wrong the moment you hold more than one
product: an Ink Cash earning 5x on a $25,000 cap is a better home for the next
$1,000 than a Business Gold earning 4x with $150,000 of runway left.

So `src/lib/cap.ts` ranks by **the rate a charge would actually earn**:

- `marginalRate()` — what the next eligible dollar earns on a card: its bonus
  rate while cap headroom remains, its base rate once that is gone.
- `bonusPointsAvailable()` — runway times the *uplift* of the bonus rate over
  that card's own base rate. A flat-rate card like Ink Unlimited has no uplift,
  so it correctly shows nothing left to capture however much cap it nominally
  has.
- `rankCardsForCharge()` — what a charge of a given size earns on each card,
  straddling the cap where the charge is larger than the runway left. A high
  headline rate on a nearly-full card can lose to a lower rate with room.
- `planCharge()` — the best split when no single card can absorb the charge at
  its bonus rate. Filling the richest rate first is provably optimal here:
  each card's bonus headroom is independent and its rate fixed, so this is the
  fractional-knapsack case where greedy is the best choice.

## Adding a card

No code changes. Insert a `card_accounts` row, then a `cap_years` row carrying
that card's terms for the year:

| Card | `bonus_multiplier` | `base_multiplier` | `cap_amount` |
| --- | --- | --- | --- |
| Amex Business Gold | 4 | 1 | 150000 |
| Chase Ink Business Preferred | 3 | 1 | 150000 |
| Chase Ink Business Cash | 5 | 1 | 25000 |
| Chase Ink Business Unlimited | 1.5 | 1.5 | *(any large number)* |

Set `cap_year_start_month` / `cap_year_start_day` on the card when its cap year
does not start on 1 January.

Which charges count is decided per charge by `counts_toward_cap`, driven by
`merchant_rules` at import time and correctable by hand in the preview.

### Cap years that are not calendar years

Chase Ink caps run on the cardmember anniversary, not the calendar year.
`card_accounts.cap_year_start_month` / `cap_year_start_day` carry that anchor,
and `v_charge_allocation` buckets each charge with `cap_year_for()`. Both
default to 1 January, so calendar-year cards behave exactly as before.

A cap year is named by the calendar year it **opens** in: a November-anniversary
card's 1 Nov 2025 - 31 Oct 2026 period is `year = 2025`.

### Known gaps

- **Eligibility is global, not per card.** `merchant_rules.counts_toward_cap`
  is one boolean for every card, but bonus categories differ by product —
  shipping earns 3x on Ink Preferred while an Amex Gold only earns its bonus
  rate on the categories that card has selected. Until eligibility is per
  card, a charge in a category one card treats as a bonus and another does not
  has to be corrected by hand in the import preview.
- **Purchase-size thresholds.** Business Platinum's 1.5x applies only to
  single purchases of $5,000 or more. `merchant_rules` matches on descriptor
  text alone, with no amount condition.

## The database is pre-existing

The app **creates and migrates nothing**. It reads three views that own all
the cap arithmetic, and never recomputes them in JavaScript:

| View | Grain | Gives |
| --- | --- | --- |
| `v_cap_runway` | account × year | `cap_used`, `remaining_runway`, `points`, `spend_past_cap`, `opening_counted`, `charge_count` |
| `v_charge_allocation` | charge | `amount_at_bonus`, `amount_at_base`, `points` |
| `v_monthly_spend` | account × month | eligible and total spend |

The one place JavaScript does cap arithmetic is `src/lib/cap.ts`, and only
for things the views cannot cover: the import preview (rows that are not in
the database yet), forward projections (burn rate, exhaust date) and the
forward-looking "which card should this go on" ranking. The preview allocator
mirrors `v_charge_allocation` exactly.

## Rules the code is built around

- `charges.amount` is always positive. A refund is `status='refunded'`, not a
  negative amount.
- `charges.fingerprint` is set by a database trigger. **The client never sends
  one.** `ChargeInsert` deliberately has no `fingerprint` field.
- Inserts go through `upsert(..., { onConflict: 'card_account_id,fingerprint',
  ignoreDuplicates: true })`. That is what makes re-imports idempotent.
- `charges.occurrence` is the Nth identical `(date, amount, descriptor)` charge
  **in the file**. Two identical same-day charges are real spend, and numbering
  them from the file (rather than from what is already stored) is what keeps a
  re-import of the same file a no-op.
- RLS: everyone reads, only `role='admin'` writes. Every write route calls
  `requireAdmin()` before it does anything, so a viewer gets a clean 403
  instead of a half-applied batch.

`src/lib/import/build.ts` mirrors the database's `charge_fingerprint()`
function in JS purely so the preview can label duplicates before writing.
The two are pinned together by tests carrying values generated by the live
function — if they ever drift, the tests fail.

## The CSV parser

Amex alone ships at least four layouts, and Chase adds another, so
`src/lib/csv/amex.ts`:

- resolves columns **by header name**, with alias precedence (so
  `Appears On Your Statement As` beats `Extended Details` as the descriptor);
- **infers columns positionally** when there is no header, by finding which
  column consistently parses as a date and which as money;
- skips statement summary lines, repeated headers and card payments;
- **detects the sign convention from the data** rather than assuming purchases
  are positive — it reads the direction off payment/credit lines where it can,
  and falls back to whichever side holds the bulk of the rows. Assuming either
  convention would silently double or zero out a cap. This is what lets a
  Chase export — purchases written negative, `Post Date` rather than
  `Posted Date` — parse correctly with no special-casing.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in as needed
npm run dev
```

```bash
npm test          # vitest
npm run build     # production build
npm run typecheck
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Publishable key |
| `NEXT_PUBLIC_SITE_URL` | recommended | Base URL for magic-link redirects |
| `SUPABASE_SERVICE_ROLE_KEY` | Plaid only | `plaid_items` is deny-all under RLS |
| `PLAID_ENABLED` | no | Plaid is off unless this is exactly `true` |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` | Plaid only | Plaid credentials |
| `PLAID_TOKEN_ENCRYPTION_KEY` | Plaid only | 32 bytes, hex or base64 (`openssl rand -hex 32`) |

## Auth

Supabase magic link via `@supabase/ssr`. `middleware.ts` refreshes the session
and redirects anyone without one to `/login`. The first user to sign up is
already an admin (the database's `handle_new_user` trigger handles that);
everyone after is a viewer.

For magic links to land correctly, add your deployed origin and
`https://<your-domain>/auth/callback` to the Supabase project's allowed
redirect URLs.

## Plaid

Off by default and inert unless `PLAID_ENABLED=true` — every route returns 503
otherwise. Access tokens are encrypted with **AES-256-GCM** (random IV per
token, auth tag verified on read) before they reach the database, and
`plaid_items` is readable only by the service role. Synced transactions carry
the Plaid transaction id in `reference`, so they dedupe through the same
fingerprint mechanism as the CSV import.

## Deploying to Vercel

Import the repo, set the environment variables above, and deploy. No build
step touches the database.
