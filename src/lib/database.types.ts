/**
 * Shape of the existing Supabase schema (project wballdjmvafqxfkmzhzw).
 *
 * This mirrors the live database — the app never creates or migrates
 * anything. Numeric columns arrive from PostgREST as JS numbers.
 */

export type AppRole = "admin" | "viewer";

export type ChargeStatus = "pending" | "posted" | "declined" | "refunded";
export type ImportSource = "csv" | "pdf" | "plaid" | "manual" | "workbook";
export type BatchStatus = "pending" | "committed" | "discarded";
export type OpeningSource = "declared" | "reconciled" | "suspected_duplicate";

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  created_at: string;
}

export type EntityRow = {
  id: string;
  name: string;
  created_at: string;
}

export type CardAccountRow = {
  id: string;
  nickname: string;
  last4: string | null;
  entity_id: string | null;
  product: string;
  opened_on: string | null;
  statement_close_day: number | null;
  status: "active" | "inactive" | "closed";
  ads_account: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CapYearRow = {
  id: string;
  card_account_id: string;
  year: number;
  cap_amount: number;
  bonus_multiplier: number;
  base_multiplier: number;
  opening_cap_used: number;
  opening_source: OpeningSource;
  opening_verified: boolean;
  created_at: string;
  updated_at: string;
}

export type ChargeRow = {
  id: string;
  card_account_id: string;
  posted_on: string;
  merchant: string;
  descriptor: string | null;
  amount: number;
  category: string | null;
  counts_toward_cap: boolean;
  charge_type: string;
  status: ChargeStatus;
  reference: string | null;
  notes: string | null;
  source: ImportSource;
  batch_id: string | null;
  plaid_transaction_id: string | null;
  /** Set by a DB trigger. Never sent from the client. */
  fingerprint: string | null;
  occurrence: number;
  created_at: string;
  updated_at: string;
}

/**
 * Insert shape for charges. `fingerprint` is deliberately absent — the
 * set_charge_fingerprint trigger computes it, and sending one would fight
 * the trigger that makes re-imports idempotent.
 */
export type ChargeInsert = {
  card_account_id: string;
  posted_on: string;
  merchant: string;
  descriptor: string | null;
  amount: number;
  category: string | null;
  counts_toward_cap: boolean;
  status: ChargeStatus;
  reference: string | null;
  notes?: string | null;
  source: ImportSource;
  batch_id: string | null;
  occurrence: number;
  /** Only set by the Plaid sync; the CSV importer leaves it out. */
  plaid_transaction_id?: string | null;
}

export type MerchantRuleRow = {
  id: string;
  pattern: string;
  merchant: string;
  category: string | null;
  counts_toward_cap: boolean;
  priority: number;
  created_at: string;
}

export type ImportBatchRow = {
  id: string;
  card_account_id: string | null;
  source: ImportSource;
  filename: string | null;
  file_sha256: string | null;
  uploaded_by: string | null;
  raw_row_count: number;
  parsed_count: number;
  inserted_count: number;
  duplicate_count: number;
  skipped_count: number;
  status: BatchStatus;
  notes: string | null;
  created_at: string;
  committed_at: string | null;
}

export type ImportRowRow = {
  id: string;
  batch_id: string;
  line_no: number;
  raw: Record<string, unknown>;
  parse_error: string | null;
}

export type PlaidItemRow = {
  id: string;
  item_id: string;
  access_token_encrypted: string;
  institution_id: string | null;
  institution_name: string | null;
  sync_cursor: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type PlaidAccountRow = {
  id: string;
  plaid_item_id: string;
  account_id: string;
  name: string | null;
  mask: string | null;
  official_name: string | null;
  subtype: string | null;
  card_account_id: string | null;
  created_at: string;
}

/** Per account/year cap position. Authoritative — never recomputed in JS. */
export type CapRunwayRow = {
  card_account_id: string;
  nickname: string;
  last4: string | null;
  account_status: string;
  sort_order: number;
  entity: string | null;
  cap_year: number;
  cap_amount: number;
  bonus_multiplier: number;
  base_multiplier: number;
  opening_cap_used: number;
  opening_source: OpeningSource;
  opening_verified: boolean;
  opening_counted: number;
  logged_eligible: number;
  charge_count: number;
  cap_used: number;
  remaining_runway: number;
  points: number;
  spend_past_cap: number;
  first_charge_on: string | null;
  last_charge_on: string | null;
}

/** Per charge bonus/base split. Authoritative — never recomputed in JS. */
export type ChargeAllocationRow = {
  id: string;
  card_account_id: string;
  cap_year: number;
  posted_on: string;
  merchant: string;
  descriptor: string | null;
  amount: number;
  category: string | null;
  counts_toward_cap: boolean;
  status: ChargeStatus;
  source: ImportSource;
  reference: string | null;
  notes: string | null;
  batch_id: string | null;
  used_before: number;
  amount_at_bonus: number;
  amount_at_base: number;
  points: number;
}

export type MonthlySpendRow = {
  card_account_id: string;
  cap_year: number;
  month: number;
  eligible_spend: number;
  total_spend: number;
  points: number;
  charge_count: number;
}

/**
 * supabase-js resolves table types through these three members plus
 * Relationships; omitting Relationships collapses every query result to
 * `never`, so it is required even when empty.
 */
type Def<R, I = R, U = Partial<R>> = {
  Row: R;
  Insert: I;
  Update: U;
  Relationships: [];
};
type ViewDef<R> = { Row: R; Relationships: [] };

/*
 * Declared as a type alias, not an interface: supabase-js checks this against
 * Record<string, GenericTable>, and only type aliases get TypeScript's
 * implicit index signature. As an interface every query resolves to `never`.
 */
export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      profiles: Def<ProfileRow, Omit<ProfileRow, "created_at">>;
      entities: Def<EntityRow, { name: string }>;
      card_accounts: Def<CardAccountRow, Partial<CardAccountRow> & { nickname: string }>;
      cap_years: Def<CapYearRow, Partial<CapYearRow> & { card_account_id: string; year: number }>;
      charges: Def<ChargeRow, ChargeInsert>;
      merchant_rules: Def<MerchantRuleRow, Partial<MerchantRuleRow> & { pattern: string; merchant: string }>;
      import_batches: Def<ImportBatchRow, Partial<ImportBatchRow> & { source: ImportSource }>;
      import_rows: Def<ImportRowRow, Omit<ImportRowRow, "id" | "parse_error"> & { parse_error?: string | null }>;
      plaid_items: Def<PlaidItemRow, Partial<PlaidItemRow> & { item_id: string; access_token_encrypted: string }>;
      plaid_accounts: Def<PlaidAccountRow, Partial<PlaidAccountRow> & { plaid_item_id: string; account_id: string }>;
    };
    Views: {
      v_cap_runway: ViewDef<CapRunwayRow>;
      v_charge_allocation: ViewDef<ChargeAllocationRow>;
      v_monthly_spend: ViewDef<MonthlySpendRow>;
    };
    Functions: { [_ in never]: never };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}
