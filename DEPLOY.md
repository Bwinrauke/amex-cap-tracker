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

## 4. Sign in first — before sharing the URL

The database has **no users yet**, and the `handle_new_user` trigger makes the
first account to sign in an **admin**, with write access to every card and
charge.

The deployed site is reachable by anyone who has the link, and anyone can
request a magic link from it. So sign in as yourself immediately after the
first deploy, before the URL goes anywhere. Everyone who signs in after you
is created as a read-only `viewer`.

Once you are in, consider turning off new signups in Supabase under
**Authentication → Sign In / Providers** so no one else can create an account
at all. Existing users keep working.

## Checking it worked

The dashboard should show ten cards: three Amex Gold and seven Chase Ink, with
a recommendation for advertising and one for shipping. If you land on the
login page in a loop, step 3 was missed.
