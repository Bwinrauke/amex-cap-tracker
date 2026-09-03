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

## Checking it worked

The dashboard should show ten cards: three Amex Gold and seven Chase Ink, with
a recommendation for advertising and one for shipping. If you land on the
login page in a loop, step 3 was missed.
