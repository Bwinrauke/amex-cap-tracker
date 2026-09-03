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
| `NEXT_PUBLIC_SITE_URL` | `https://<your-app>.vercel.app` |

Nothing else is required. `SUPABASE_SERVICE_ROLE_KEY` and the `PLAID_*`
variables are only needed if Plaid is switched on, which it is not by default.

## 3. Tell Supabase to trust the new domain

**Magic links will silently fail without this step.** In the Supabase
dashboard, under **Authentication → URL Configuration**:

- Set **Site URL** to `https://<your-app>.vercel.app`
- Add `https://<your-app>.vercel.app/auth/callback` to **Redirect URLs**

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

## Using your own domain

Works with any domain, on any registrar. Deploy and confirm the app works on
the `.vercel.app` URL first — debugging DNS and a broken build at the same
time is miserable.

1. **Vercel → Project → Settings → Domains → Add**, and enter the domain.
2. Vercel shows the exact DNS record to create. It differs by shape:

   | What you enter | Record Vercel asks for |
   | --- | --- |
   | `app.example.com` (subdomain) | `CNAME` → `cname.vercel-dns.com` |
   | `example.com` (root/apex) | `A` → the IP Vercel shows, or `ALIAS`/`ANAME` where the registrar supports it |

3. Add that record at whoever runs the domain's DNS. Certificates are issued
   automatically once it resolves; propagation is usually minutes.

**Do not repoint a domain that already serves a website.** Changing the `A` or
`CNAME` for a name that currently loads a storefront or marketing site will
take that site down. Put the app on a subdomain that is not in use instead.
Adding a web record does not affect `MX` records, so email keeps working.

### Then update both of these, or sign-in breaks silently

A magic link is generated against a configured URL. Point it at the wrong host
and the link either 404s or bounces back to the login page, with no error
explaining why.

- **Vercel → Environment Variables**: set `NEXT_PUBLIC_SITE_URL` to
  `https://<your-domain>`, then **redeploy** — env changes do not apply to an
  existing deployment.
- **Supabase → Authentication → URL Configuration**: set **Site URL** to the
  same value, and add `https://<your-domain>/auth/callback` to **Redirect
  URLs**.

Leave the old `.vercel.app` callback in the redirect list while you switch, so
a mistake in the DNS does not lock you out of the app entirely.

## Checking it worked

The dashboard should show ten cards: three Amex Gold and seven Chase Ink, with
a recommendation for advertising and one for shipping. If you land on the
login page in a loop, step 3 was missed.
