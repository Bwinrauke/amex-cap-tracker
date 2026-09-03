-- APPLIED 2026-09-03 as migration `anniversary_cap_years`.
-- Kept as the record of what was changed and why.
--
-- Chase Ink caps run on the cardmember anniversary year, but
-- v_charge_allocation currently derives the cap year with
-- EXTRACT(year FROM posted_on) — i.e. the calendar year. For a Chase card
-- whose anniversary is not 1 January, spend lands in the wrong cap year in
-- both directions, so the $150k 3x cap is measured against the wrong window.
--
-- This is backwards compatible: the new columns default to 1 January, which
-- reproduces today's behaviour exactly. Amex cards are unaffected unless
-- their anchor is changed.
--
-- Review, then apply as a single migration.

begin;

-- 1. Where each card's cap year starts. Defaults reproduce calendar years.
alter table card_accounts
  add column if not exists cap_year_start_month smallint not null default 1,
  add column if not exists cap_year_start_day   smallint not null default 1;

alter table card_accounts
  add constraint card_accounts_cap_year_start_month_check
    check (cap_year_start_month between 1 and 12),
  add constraint card_accounts_cap_year_start_day_check
    check (cap_year_start_day between 1 and 31);

comment on column card_accounts.cap_year_start_month is
  'Month the bonus cap year opens. 1 for calendar-year cards (Amex); the '
  'cardmember anniversary month for Chase Ink.';

-- 2. Which cap year a posting date belongs to.
--    Row comparison is lexicographic, so (month, day) ordering is exact and
--    needs no special case for short months or 29 February.
create or replace function cap_year_for(
  p_posted_on   date,
  p_start_month smallint default 1,
  p_start_day   smallint default 1
)
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when (extract(month from p_posted_on)::int, extract(day from p_posted_on)::int)
         >= (coalesce(p_start_month, 1)::int, coalesce(p_start_day, 1)::int)
    then extract(year from p_posted_on)::int
    else extract(year from p_posted_on)::int - 1
  end;
$$;

-- 3. Same output columns as today, so dependent views (v_cap_runway,
--    v_monthly_spend) keep working untouched — only how cap_year is derived
--    changes.
create or replace view v_charge_allocation as
with eligible as (
  select
    c.id, c.card_account_id, c.posted_on, c.merchant, c.descriptor, c.amount,
    c.category, c.counts_toward_cap, c.charge_type, c.status, c.reference,
    c.notes, c.source, c.batch_id, c.plaid_transaction_id, c.fingerprint,
    c.created_at, c.updated_at,
    cap_year_for(c.posted_on, ca.cap_year_start_month, ca.cap_year_start_day) as cap_year
  from charges c
  join card_accounts ca on ca.id = c.card_account_id
  where c.status = any (array['pending'::text, 'posted'::text])
), joined as (
  select
    e.*, cy.cap_amount, cy.bonus_multiplier, cy.base_multiplier,
    case
      when cy.opening_source = 'suspected_duplicate' and not cy.opening_verified
      then 0::numeric
      else cy.opening_cap_used
    end as opening_used
  from eligible e
  join cap_years cy
    on cy.card_account_id = e.card_account_id
   and cy.year = e.cap_year
), running as (
  select
    j.*,
    (j.opening_used + coalesce(sum(
      case when j.counts_toward_cap then j.amount else 0::numeric end
    ) over (
      partition by j.card_account_id, j.cap_year
      order by j.posted_on, j.id
      rows between unbounded preceding and 1 preceding
    ), 0::numeric)) as used_before
  from joined j
)
select
  id, card_account_id, cap_year, posted_on, merchant, descriptor, amount,
  category, counts_toward_cap, status, source, reference, notes, batch_id,
  used_before,
  case
    when not counts_toward_cap then 0::numeric
    else greatest(0::numeric, least(amount, (cap_amount - used_before)))
  end as amount_at_bonus,
  case
    when not counts_toward_cap then amount
    else amount - greatest(0::numeric, least(amount, (cap_amount - used_before)))
  end as amount_at_base,
  ((case
      when not counts_toward_cap then 0::numeric
      else greatest(0::numeric, least(amount, (cap_amount - used_before)))
    end * bonus_multiplier)
   + (case
      when not counts_toward_cap then amount
      else amount - greatest(0::numeric, least(amount, (cap_amount - used_before)))
    end * base_multiplier)) as points
from running r;

commit;

-- Afterwards, for each anniversary-year card:
--   update card_accounts
--      set cap_year_start_month = <month>, cap_year_start_day = <day>
--    where nickname = '<card>';
--
-- and make sure a cap_years row exists for each anniversary year that card
-- has spend in. A cap year is named by the calendar year it OPENS in, so the
-- window 15 Mar 2026 - 14 Mar 2027 is year = 2026.
