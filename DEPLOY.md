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

After the first deploy, add one more with the domain Vercel gives you, then
redeploy so magic links point at the right host:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-app>.vercel.app`, then `https://apps.cityjeans.com` once the domain is live |

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

Where to create it depends on who runs the DNS for `cityjeans.com`. Check
**Shopify admin → Settings → Domains**:

- **"Managed by Shopify"** → open the domain, *Edit DNS settings*, add a custom
  `CNAME` record there.
- **Shown as a connected third-party domain** → add it at whichever registrar
  or DNS host the domain uses (GoDaddy, Cloudflare, Namecheap, and so on).

If the DNS sits behind **Cloudflare**, set the record to **DNS only** (grey
cloud, not orange). Leaving the proxy on stops Vercel from issuing a
certificate, and the site fails with an SSL error.

Certificates are issued automatically once the record resolves — usually
minutes.

### 3. Point sign-in at the new host

A magic link is generated against a configured URL. Miss either of these and
the link bounces back to the login page with no error explaining why.

- **Vercel → Environment Variables**: set
  `NEXT_PUBLIC_SITE_URL=https://apps.cityjeans.com`, then **redeploy** — env
  changes do not apply to an existing deployment.
- **Supabase → Authentication → URL Configuration**: set **Site URL** to
  `https://apps.cityjeans.com`, and add
  `https://apps.cityjeans.com/auth/callback` to **Redirect URLs**.

Keep the `.vercel.app` callback in the redirect list while you switch, so a
DNS mistake cannot lock you out of the app.

## Checking it worked

The dashboard should show ten cards: three Amex Gold and seven Chase Ink, with
a recommendation for advertising and one for shipping.

If you land back on the login page in a loop, the callback URL is missing from
Supabase's redirect list, or `NEXT_PUBLIC_SITE_URL` does not match the host you
are actually on. If you reach a "no access" page instead, you signed in with an
address that is not in `allowed_emails`.
