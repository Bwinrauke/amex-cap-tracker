# Deploying

The app is not deployed anywhere yet. It runs locally and the code is on
GitHub, but nothing is hosting it. These are the steps to get a live URL.

## 1. Import the repo into Vercel

At <https://vercel.com/new>, import `Bwinrauke/amex-cap-tracker`. Vercel
detects Next.js on its own — no build settings to change.

## 2. Set the environment variables

Add these under **Settings → Environment Variables** before the first deploy.
Both are public values, safe in the browser:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://wballdjmvafqxfkmzhzw.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_O8ffPch4JDpcio63RA1QUg_SB56JhoE` |

Set both as **Config**, not Secret. Anything prefixed `NEXT_PUBLIC_` is
compiled into the browser bundle by design, so marking it Secret protects
nothing — and Vercel makes saved secrets write-only, so you could not edit it
afterwards without deleting and recreating it.

The Supabase anon key is meant to be public; RLS is what protects the data.

Nothing else is required. `SUPABASE_SERVICE_ROLE_KEY` and the `PLAID_*`
variables are only needed if Plaid is switched on, which it is not by default.

## 3. Tell Supabase to trust the new domain

**Magic links will silently fail without this step.** In the Supabase
dashboard, under **Authentication → URL Configuration**:

- Set **Site URL** to `https://<your-app>.vercel.app`
- Add `https://<your-app>.vercel.app/auth/callback` to **Redirect URLs**

Once `apps.cityjeans.com` is live, add its callback too and make it the Site
URL. Keeping both means neither host locks you out.

## 4. Only your address can hold an account

Access is restricted at the database level, not just in the app. The
`allowed_emails` table lists who may have an account, and `handle_new_user()`
creates a profile only for those addresses. Every RLS policy gates on having
a profile, so anyone else can complete a magic link and still read nothing —
including through the public REST API, which an app-only check could not
prevent, since the anon key is public by design.

`ben@cityjeans.com` is on the list, and will become admin on first sign-in.
Anyone else lands on a "no access" page.

To let someone else in later:

```sql
insert into allowed_emails (email, note) values ('them@example.com', 'why');
```

They are created as a read-only `viewer`. To revoke, delete their
`allowed_emails` row **and** their `profiles` row — removing the allow-list
entry alone does not remove access already granted.

As a second layer you can also turn off new signups entirely in Supabase under
**Authentication → Sign In / Providers**, once you have signed in.

## Putting it on apps.cityjeans.com

`cityjeans.com` serves the Shopify Plus storefront, so nothing about the root
domain changes. `apps` is a separate DNS record; adding it cannot affect the
store, and it does not touch `MX` records, so email is unaffected too.

Deploy and confirm the app works on the `.vercel.app` URL first — debugging
DNS and a broken build at the same time is miserable.

### 1. Claim the domain in Vercel first

**Vercel → Project → Settings → Domains → Add**, enter `apps.cityjeans.com`.

Do this before creating the DNS record: Vercel then shows you the exact target
to point at, and verifies the moment it resolves.

### 2. Create the record

| Field | Value |
| --- | --- |
| Type | `CNAME` |
| Name / Host | `apps` (some panels want the full `apps.cityjeans.com`) |
| Value / Target | `cname.vercel-dns.com` — **use whatever Vercel shows**, some accounts get a different target |
| TTL | leave default |

DNS for `cityjeans.com` is on **Cloudflare**, so create it there:
**Cloudflare → cityjeans.com → DNS → Records → Add record**.

- **Name**: `apps` — just the label. Cloudflare appends the domain itself;
  typing the full hostname produces `apps.cityjeans.com.cityjeans.com`.
- **Proxy status**: **DNS only** (grey cloud), not Proxied (orange). This is
  the one that catches people. With the proxy on, Cloudflare terminates TLS
  itself, Vercel cannot complete certificate validation, and the domain sits
  in "Invalid Configuration" while visitors get an SSL error.
- **TTL**: Auto.

The storefront's own records are untouched — this only adds the `apps` label.

Certificates are issued automatically once the record resolves — usually
minutes.

### 3. Let Supabase accept the new host

The magic link comes back to whichever host you signed in from — the app
derives that itself, so there is no base-URL variable to set. Supabase does
have to be told the host is allowed, or the link bounces back to the login
page with no error explaining why.

**Supabase → Authentication → URL Configuration**: set **Site URL** to
`https://apps.cityjeans.com`, and add `https://apps.cityjeans.com/auth/callback`
to **Redirect URLs**.

Keep the `.vercel.app` callback in the redirect list while you switch, so a
DNS mistake cannot lock you out of the app.

## Checking it worked

The dashboard should show ten cards: three Amex Gold and seven Chase Ink, with
a recommendation for advertising and one for shipping.

If you land back on the login page in a loop, the callback URL for the host you
are on is missing from Supabase's redirect list. If you reach a "no access" page
instead, you signed in with an address that is not in `allowed_emails`.
