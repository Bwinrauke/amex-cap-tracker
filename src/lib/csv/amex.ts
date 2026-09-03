import { tokenizeCsv } from "./tokenize";

/** A row the parser accepted as a real charge. */
export interface ParsedCharge {
  /** 1-based index among the file's non-empty rows, for error reporting. */
  lineNo: number;
  /** ISO date, YYYY-MM-DD. */
  postedOn: string;
  merchant: string;
  descriptor: string;
  /** Always positive — the sign lives in `status`, per the charges schema. */
  amount: number;
  status: "posted" | "refunded";
  reference: string | null;
  category: string | null;
  /** last4 seen on the row, when the layout carries one. */
  cardHint: string | null;
  /** Nth identical (date, amount, descriptor) charge in this file. */
  occurrence: number;
  raw: Record<string, string>;
}

export interface SkippedRow {
  lineNo: number;
  reason: string;
  raw: Record<string, string>;
}

export type SignConvention = "positive_is_charge" | "negative_is_charge";

export interface ColumnMap {
  date: number | null;
  postedDate: number | null;
  description: number | null;
  descriptor: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  reference: number | null;
  category: number | null;
  card: number | null;
}

export interface ParseResult {
  charges: ParsedCharge[];
  skipped: SkippedRow[];
  /** Every non-empty line, keyed by header, for the import_rows audit trail. */
  rawRows: { lineNo: number; raw: Record<string, string>; parseError: string | null }[];
  layout: {
    headerFound: boolean;
    headers: string[] | null;
    columns: ColumnMap;
    signConvention: SignConvention;
    signReason: string;
    /** True when debit/credit live in separate columns. */
    splitAmountColumns: boolean;
  };
}

/* -------------------------------------------------------------------------
 * Field parsing
 * ---------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject dates like 02/31 that a naive check would let through.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Two-digit years: Amex statements are recent, so 70-99 means 19xx. */
function expandYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

/**
 * Parses the date formats Amex ships: US slash dates, ISO, and the
 * "12 Mar 2025" / "Mar 12, 2025" forms used by some statement exports.
 */
export function parseDate(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const year = expandYear(+m[3]);
    // Amex US exports are MM/DD/YYYY. Fall back to DD/MM only when the
    // first field cannot be a month.
    if (a <= 12) return iso(year, a, b);
    if (b <= 12) return iso(year, b, a);
    return null;
  }

  m = /^(\d{1,2})[\s-]([A-Za-z]{3,4})\.?[\s-](\d{2,4})$/.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? iso(expandYear(+m[3]), month, +m[1]) : null;
  }

  m = /^([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/.exec(text);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(expandYear(+m[3]), month, +m[2]) : null;
  }

  return null;
}

/**
 * Parses a money field, preserving sign. Handles currency symbols, thousands
 * separators, accounting parentheses, and trailing-minus notation.
 */
export function parseAmount(input: string): number | null {
  let text = input.trim().replace(/−/g, "-");
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/-\s*$/.test(text)) {
    negative = true;
    text = text.replace(/-\s*$/, "");
  }

  text = text.replace(/[$€£\s]/g, "").replace(/,/g, "");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (/^(USD|usd)/.test(text)) text = text.replace(/^(USD|usd)/, "");

  if (!/^\d*\.?\d+$/.test(text) && !/^\d+\.?\d*$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/* -------------------------------------------------------------------------
 * Header resolution
 * ---------------------------------------------------------------------- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const HEADER_ALIASES: Record<keyof ColumnMap, string[]> = {
  date: ["date", "transaction date", "trans date", "date processed", "activity date"],
  postedDate: ["posted date", "post date", "posting date", "date posted"],
  description: ["description", "merchant", "payee", "details", "transaction description", "merchant name"],
  descriptor: ["appears on your statement as", "extended details", "descriptor", "statement descriptor"],
  amount: ["amount", "amount usd", "transaction amount", "amount in usd"],
  debit: ["debit", "charges", "withdrawal", "debit amount"],
  credit: ["credit", "credits", "payments credits", "deposit", "credit amount"],
  reference: ["reference", "reference id", "reference number", "transaction id", "receipt id"],
  category: ["category", "type", "transaction type", "spend category"],
  // "Card Member" is a person's name, not an account number, so it is
  // deliberately absent — the hint is only useful when it carries digits.
  card: ["account", "account number", "card no", "card number", "card"],
};

function emptyColumnMap(): ColumnMap {
  return {
    date: null, postedDate: null, description: null, descriptor: null,
    amount: null, debit: null, credit: null, reference: null,
    category: null, card: null,
  };
}

/** Maps header cells onto known fields. First match wins per field. */
export function mapHeaders(headers: string[]): ColumnMap {
  const columns = emptyColumnMap();
  const seen = headers.map(norm);

  // Alias order carries the preference, so "Appears On Your Statement As"
  // beats "Extended Details" as the descriptor no matter which column is
  // physically first.
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof ColumnMap, string[]][]) {
    for (const alias of aliases) {
      const index = seen.indexOf(alias);
      if (index !== -1) {
        columns[field] = index;
        break;
      }
    }
  }
  return columns;
}

/** A row is a header when it names both a date-ish and an amount-ish column. */
function looksLikeHeader(row: string[]): boolean {
  const columns = mapHeaders(row);
  const hasDate = columns.date !== null || columns.postedDate !== null;
  const hasAmount =
    columns.amount !== null || columns.debit !== null || columns.credit !== null;
  const hasParsableDate = row.some((cell) => parseDate(cell) !== null);
  return hasDate && hasAmount && !hasParsableDate;
}

/**
 * Infers columns from the data itself, for the headerless exports.
 * Picks the column that most often parses as a date, the one that most often
 * parses as money, and the widest remaining text column as the description.
 */
export function inferColumns(rows: string[][]): ColumnMap {
  const columns = emptyColumnMap();
  const width = Math.max(...rows.map((r) => r.length), 0);
  if (width === 0) return columns;

  const dateHits = new Array<number>(width).fill(0);
  const amountHits = new Array<number>(width).fill(0);
  const textLength = new Array<number>(width).fill(0);

  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const cell = row[i] ?? "";
      if (parseDate(cell) !== null) dateHits[i]++;
      // A bare integer like a line number is not money; require a decimal,
      // a separator, or an explicit sign.
      else if (parseAmount(cell) !== null && /[.,()$-]/.test(cell)) amountHits[i]++;
      textLength[i] += cell.length;
    }
  }

  const best = (scores: number[]) => {
    let index = -1;
    let top = 0;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > top) {
        top = scores[i];
        index = i;
      }
    }
    // Require the signal in a majority of rows before trusting it.
    return top >= Math.max(1, rows.length / 2) ? index : -1;
  };

  const dateIndex = best(dateHits);
  const amountIndex = best(amountHits);
  if (dateIndex >= 0) columns.date = dateIndex;
  if (amountIndex >= 0) columns.amount = amountIndex;

  let descriptionIndex = -1;
  let longest = -1;
  for (let i = 0; i < width; i++) {
    if (i === dateIndex || i === amountIndex) continue;
    if (textLength[i] > longest) {
      longest = textLength[i];
      descriptionIndex = i;
    }
  }
  if (descriptionIndex >= 0) columns.description = descriptionIndex;

  return columns;
}

/* -------------------------------------------------------------------------
 * Noise filtering
 * ---------------------------------------------------------------------- */

const SUMMARY_PATTERNS = [
  /^total\b/i,
  /\btotal (charges|credits|payments|fees|interest|of new charges)\b/i,
  /^(previous|new|closing|opening|statement|remaining|current) balance/i,
  /\bbalance (forward|due)\b/i,
  /^(payments|credits|payments and credits|new charges|fees|interest charged)\s*$/i,
  /^account summary/i,
  /^minimum payment/i,
  /^(please pay by|payment due date|closing date)/i,
  /^(page|prepared for|customer service|membership rewards points)\b/i,
  /^\*+/,
  /^continued\b/i,
  /^amount enclosed/i,
];

/** Card payments are not charges; they must not land in the charge log. */
const PAYMENT_PATTERNS = [
  /\bpayment\s*(received|thank\s*you)?\b/i,
  /\bthank\s*you\b/i,
  /\bautopay\b/i,
  /\bonline\s*payment\b/i,
  /\bdirect\s*debit\b/i,
  /\bmobile\s*payment\b/i,
];

export function isSummaryLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return SUMMARY_PATTERNS.some((p) => p.test(t));
}

export function isPaymentLine(text: string): boolean {
  return PAYMENT_PATTERNS.some((p) => p.test(text));
}

/* -------------------------------------------------------------------------
 * Sign convention
 * ---------------------------------------------------------------------- */

export interface SignSample {
  amount: number;
  descriptor: string;
}

/**
 * Works out which sign means "money spent" in this particular file.
 *
 * Amex is not consistent: the web activity export writes purchases positive
 * and credits negative, while some statement and Quicken-style exports invert
 * both. Assuming either way silently doubles or zeroes a cap, so the
 * convention is derived from the file.
 *
 * Evidence, strongest first:
 *  1. Payment/credit lines. A payment is always money coming back to the
 *     card, so purchases carry the opposite sign.
 *  2. Which side holds the bulk of the rows — a statement is mostly purchases.
 */
export function detectSignConvention(samples: SignSample[]): {
  convention: SignConvention;
  reason: string;
} {
  const nonZero = samples.filter((s) => s.amount !== 0);
  if (nonZero.length === 0) {
    return { convention: "positive_is_charge", reason: "No amounts to inspect; assumed Amex default." };
  }

  const payments = nonZero.filter((s) => isPaymentLine(s.descriptor));
  const positivePayments = payments.filter((s) => s.amount > 0).length;
  const negativePayments = payments.filter((s) => s.amount < 0).length;

  if (payments.length > 0 && positivePayments !== negativePayments) {
    if (positivePayments > negativePayments) {
      return {
        convention: "negative_is_charge",
        reason: `${positivePayments} payment/credit line(s) are positive, so purchases are negative.`,
      };
    }
    return {
      convention: "positive_is_charge",
      reason: `${negativePayments} payment/credit line(s) are negative, so purchases are positive.`,
    };
  }

  const positives = nonZero.filter((s) => s.amount > 0);
  const negatives = nonZero.filter((s) => s.amount < 0);

  if (positives.length !== negatives.length) {
    const positiveWins = positives.length > negatives.length;
    return {
      convention: positiveWins ? "positive_is_charge" : "negative_is_charge",
      reason: `${positives.length} positive vs ${negatives.length} negative row(s); the majority are purchases.`,
    };
  }

  // Tied row counts: the purchase side still carries the larger total.
  const sum = (rows: SignSample[]) => rows.reduce((total, s) => total + Math.abs(s.amount), 0);
  const positiveTotal = sum(positives);
  const negativeTotal = sum(negatives);
  return positiveTotal >= negativeTotal
    ? { convention: "positive_is_charge", reason: "Row counts tied; positive rows carry the larger total." }
    : { convention: "negative_is_charge", reason: "Row counts tied; negative rows carry the larger total." };
}

/* -------------------------------------------------------------------------
 * Occurrence
 * ---------------------------------------------------------------------- */

/**
 * Exact mirror of the normalisation inside the database's
 * charge_fingerprint(): lowercase, then collapse runs of whitespace to a
 * single space.
 *
 * Deliberately does NOT trim, because the SQL does not either — a descriptor
 * with trailing space hashes with that space still on it. The parser trims
 * descriptors before they are stored, so in practice both sides see clean
 * text; keeping the transform identical means the JS fingerprint used for the
 * duplicate diff can never drift from the one the trigger writes.
 */
export function normalizeDescriptor(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

export function occurrenceKey(postedOn: string, amount: number, descriptor: string): string {
  return `${postedOn}|${amount.toFixed(2)}|${normalizeDescriptor(descriptor)}`;
}

/**
 * Numbers each charge as the Nth identical (date, amount, descriptor) row in
 * the file. Two identical same-day charges are real spend, and this is what
 * lets both survive the fingerprint dedupe — while a re-import of the same
 * file reproduces the same numbering, so it stays idempotent.
 */
export function assignOccurrences(charges: ParsedCharge[]): void {
  const counts = new Map<string, number>();
  for (const charge of charges) {
    const key = occurrenceKey(charge.postedOn, charge.amount, charge.descriptor);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    charge.occurrence = next;
  }
}

/* -------------------------------------------------------------------------
 * Parser
 * ---------------------------------------------------------------------- */

const cell = (row: string[], index: number | null): string =>
  index === null ? "" : (row[index] ?? "").trim();

function buildRawRecord(row: string[], headers: string[] | null): Record<string, string> {
  const record: Record<string, string> = {};
  row.forEach((value, i) => {
    const key = headers?.[i]?.trim() || `col_${i}`;
    // Duplicate header names would otherwise clobber each other.
    record[record[key] === undefined ? key : `${key}_${i}`] = value;
  });
  return record;
}

export function parseAmexCsv(input: string): ParseResult {
  const rows = tokenizeCsv(input);
  const skipped: SkippedRow[] = [];
  const rawRows: ParseResult["rawRows"] = [];

  if (rows.length === 0) {
    return {
      charges: [],
      skipped,
      rawRows,
      layout: {
        headerFound: false,
        headers: null,
        columns: emptyColumnMap(),
        signConvention: "positive_is_charge",
        signReason: "Empty file.",
        splitAmountColumns: false,
      },
    };
  }

  // Amex sometimes prefixes a statement with a title or blank-ish lines, so
  // scan the first few rows for the header instead of assuming row 0.
  let headerIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (looksLikeHeader(rows[i])) {
      headerIndex = i;
      break;
    }
  }

  const headerFound = headerIndex >= 0;
  const headers = headerFound ? rows[headerIndex] : null;
  const bodyStart = headerFound ? headerIndex + 1 : 0;
  const body = rows.slice(bodyStart).map((row, i) => ({ row, lineNo: bodyStart + i + 1 }));

  const columns = headerFound
    ? mapHeaders(headers!)
    : inferColumns(body.map((b) => b.row));

  const splitAmountColumns =
    columns.amount === null && (columns.debit !== null || columns.credit !== null);

  // Pass 1: pull out date, text and a signed amount, dropping noise.
  interface Staged {
    lineNo: number;
    postedOn: string;
    description: string;
    descriptor: string;
    signedAmount: number;
    /** Set when debit/credit columns already tell us the direction. */
    forcedDirection: "charge" | "credit" | null;
    reference: string | null;
    category: string | null;
    cardHint: string | null;
    raw: Record<string, string>;
  }
  const staged: Staged[] = [];

  for (const { row, lineNo } of body) {
    const raw = buildRawRecord(row, headers);
    const joined = row.join(" ").trim();

    if (headerFound && looksLikeHeader(row)) {
      // A repeated header, which multi-section statement exports include.
      skipped.push({ lineNo, reason: "Repeated header row.", raw });
      rawRows.push({ lineNo, raw, parseError: "Repeated header row." });
      continue;
    }

    const dateText = cell(row, columns.postedDate) || cell(row, columns.date);
    const postedOn = parseDate(dateText);

    const description = cell(row, columns.description);
    const descriptorRaw = cell(row, columns.descriptor);
    const text = description || descriptorRaw || joined;

    if (!postedOn) {
      // No usable date: a summary line, a section header, or trailing junk.
      const reason = isSummaryLine(text) || isSummaryLine(joined)
        ? "Statement summary line."
        : "No parsable date.";
      skipped.push({ lineNo, reason, raw });
      rawRows.push({ lineNo, raw, parseError: reason });
      continue;
    }

    if (isSummaryLine(text)) {
      skipped.push({ lineNo, reason: "Statement summary line.", raw });
      rawRows.push({ lineNo, raw, parseError: "Statement summary line." });
      continue;
    }

    let signedAmount: number | null = null;
    let forcedDirection: "charge" | "credit" | null = null;

    if (splitAmountColumns) {
      const debit = parseAmount(cell(row, columns.debit));
      const credit = parseAmount(cell(row, columns.credit));
      if (debit !== null && debit !== 0) {
        signedAmount = Math.abs(debit);
        forcedDirection = "charge";
      } else if (credit !== null && credit !== 0) {
        signedAmount = Math.abs(credit);
        forcedDirection = "credit";
      }
    } else {
      signedAmount = parseAmount(cell(row, columns.amount));
    }

    if (signedAmount === null) {
      const reason = "No parsable amount.";
      skipped.push({ lineNo, reason, raw });
      rawRows.push({ lineNo, raw, parseError: reason });
      continue;
    }

    if (signedAmount === 0) {
      const reason = "Zero amount.";
      skipped.push({ lineNo, reason, raw });
      rawRows.push({ lineNo, raw, parseError: reason });
      continue;
    }

    if (!text) {
      const reason = "No merchant or description.";
      skipped.push({ lineNo, reason, raw });
      rawRows.push({ lineNo, raw, parseError: reason });
      continue;
    }

    const cardValue = cell(row, columns.card);
    const cardDigits = /(\d{4,5})\s*$/.exec(cardValue.replace(/[^0-9\s]/g, " ").trim());

    staged.push({
      lineNo,
      postedOn,
      description: description || descriptorRaw || text,
      // Prefer the raw statement descriptor when the layout carries one; it
      // is the more stable dedupe key. Collapse newlines from Extended Details.
      descriptor: (descriptorRaw || description || text).replace(/\s+/g, " ").trim(),
      signedAmount,
      forcedDirection,
      reference: cell(row, columns.reference) || null,
      category: cell(row, columns.category) || null,
      cardHint: cardDigits ? cardDigits[1] : null,
      raw,
    });
    rawRows.push({ lineNo, raw, parseError: null });
  }

  // Pass 2: decide the sign convention across the whole file, then apply it.
  const { convention, reason: signReason } = detectSignConvention(
    staged
      .filter((s) => s.forcedDirection === null)
      .map((s) => ({ amount: s.signedAmount, descriptor: s.descriptor })),
  );

  const charges: ParsedCharge[] = [];

  for (const item of staged) {
    const isCharge =
      item.forcedDirection !== null
        ? item.forcedDirection === "charge"
        : convention === "positive_is_charge"
          ? item.signedAmount > 0
          : item.signedAmount < 0;

    if (!isCharge && isPaymentLine(item.descriptor)) {
      // A payment to the card is not spend and never belongs in charges.
      skipped.push({ lineNo: item.lineNo, reason: "Card payment, not a charge.", raw: item.raw });
      continue;
    }

    charges.push({
      lineNo: item.lineNo,
      postedOn: item.postedOn,
      merchant: item.description.replace(/\s+/g, " ").trim(),
      descriptor: item.descriptor,
      amount: Math.round(Math.abs(item.signedAmount) * 100) / 100,
      // charges.amount is positive by constraint; a credit is a refund.
      status: isCharge ? "posted" : "refunded",
      reference: item.reference,
      category: item.category,
      cardHint: item.cardHint,
      occurrence: 1,
      raw: item.raw,
    });
  }

  assignOccurrences(charges);

  return {
    charges,
    skipped,
    rawRows,
    layout: {
      headerFound,
      headers,
      columns,
      signConvention: convention,
      signReason,
      splitAmountColumns,
    },
  };
}
