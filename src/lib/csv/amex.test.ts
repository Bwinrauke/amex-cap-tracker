import { describe, expect, it } from "vitest";
import {
  assignOccurrences,
  detectSignConvention,
  isSummaryLine,
  parseAmexCsv,
  parseAmount,
  parseDate,
  type ParsedCharge,
} from "./amex";
import { tokenizeCsv } from "./tokenize";

describe("tokenizeCsv", () => {
  it("keeps commas inside quoted fields", () => {
    const rows = tokenizeCsv('Date,Description,Amount\n03/01/2026,"ACME, INC.",100.00\n');
    expect(rows[1]).toEqual(["03/01/2026", "ACME, INC.", "100.00"]);
  });

  it("handles escaped quotes and embedded newlines", () => {
    const rows = tokenizeCsv('a,b\n"say ""hi""","line1\nline2"\n');
    expect(rows[1]).toEqual(['say "hi"', "line1\nline2"]);
  });

  it("strips a BOM and tolerates CRLF", () => {
    const rows = tokenizeCsv("﻿Date,Amount\r\n03/01/2026,10.00\r\n");
    expect(rows[0]).toEqual(["Date", "Amount"]);
    expect(rows[1]).toEqual(["03/01/2026", "10.00"]);
  });

  it("drops entirely blank lines", () => {
    expect(tokenizeCsv("a,b\n\n,\nc,d\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("parseDate", () => {
  it("parses the formats Amex ships", () => {
    expect(parseDate("03/09/2026")).toBe("2026-03-09");
    expect(parseDate("3/9/26")).toBe("2026-03-09");
    expect(parseDate("2026-03-09")).toBe("2026-03-09");
    expect(parseDate("09 Mar 2026")).toBe("2026-03-09");
    expect(parseDate("Mar 9, 2026")).toBe("2026-03-09");
  });

  it("falls back to day-first when the first field cannot be a month", () => {
    expect(parseDate("25/03/2026")).toBe("2026-03-25");
  });

  it("rejects impossible and non-dates", () => {
    expect(parseDate("02/31/2026")).toBeNull();
    expect(parseDate("Total")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parses currency symbols and thousands separators", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("1234.56")).toBe(1234.56);
  });

  it("reads every negative notation Amex uses", () => {
    expect(parseAmount("-45.00")).toBe(-45);
    expect(parseAmount("(45.00)")).toBe(-45);
    expect(parseAmount("45.00-")).toBe(-45);
    expect(parseAmount("−45.00")).toBe(-45);
  });

  it("rejects non-numeric text", () => {
    expect(parseAmount("Total")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("isSummaryLine", () => {
  it("recognises statement summary rows", () => {
    expect(isSummaryLine("Total New Charges")).toBe(true);
    expect(isSummaryLine("Previous Balance")).toBe(true);
    expect(isSummaryLine("Minimum Payment Due")).toBe(true);
    expect(isSummaryLine("GOOGLE ADS 1234")).toBe(false);
  });
});

/* ---------------------------------------------------------------------- */
/* The four layouts                                                        */
/* ---------------------------------------------------------------------- */

describe("parseAmexCsv — layout 1: Date, Description, Amount", () => {
  const csv = [
    "Date,Description,Amount",
    "03/01/2026,GOOGLE ADS 8829,1500.00",
    "03/02/2026,META PLATFORMS INC,2250.75",
  ].join("\n");

  it("parses every charge", () => {
    const result = parseAmexCsv(csv);
    expect(result.layout.headerFound).toBe(true);
    expect(result.charges).toHaveLength(2);
    expect(result.charges[0]).toMatchObject({
      postedOn: "2026-03-01", merchant: "GOOGLE ADS 8829", amount: 1500, status: "posted",
    });
    expect(result.charges[1].amount).toBe(2250.75);
  });
});

describe("parseAmexCsv — layout 2: with Card Member and Account #", () => {
  const csv = [
    "Date,Description,Card Member,Account #,Amount",
    "03/01/2026,GOOGLE ADS 8829,BEN W,-41002,1500.00",
    "03/02/2026,TIKTOK ADS,BEN W,-41002,800.00",
  ].join("\n");

  it("resolves columns by name and captures the card hint", () => {
    const result = parseAmexCsv(csv);
    expect(result.charges).toHaveLength(2);
    expect(result.charges[0].amount).toBe(1500);
    expect(result.charges[0].cardHint).toBe("41002");
  });
});

describe("parseAmexCsv — layout 3: full export with Reference and Category", () => {
  const csv = [
    "Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category",
    '03/01/2026,GOOGLE ADS,1500.00,"GOOGLE ADS\nref 55",GOOGLE *ADS 8829,"1600 Amphitheatre",Mountain View CA,94043,US,320260601234567,Business Services',
  ].join("\n");

  it("prefers the statement descriptor and keeps the reference", () => {
    const result = parseAmexCsv(csv);
    expect(result.charges).toHaveLength(1);
    const charge = result.charges[0];
    // "Appears On Your Statement As" outranks "Extended Details".
    expect(charge.descriptor).toBe("GOOGLE *ADS 8829");
    expect(charge.merchant).toBe("GOOGLE ADS");
    expect(charge.reference).toBe("320260601234567");
    expect(charge.category).toBe("Business Services");
  });
});

describe("parseAmexCsv — layout 4: separate Debit and Credit columns", () => {
  const csv = [
    "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
    "02/28/2026,03/01/2026,41002,GOOGLE ADS,Advertising,1500.00,",
    "03/02/2026,03/03/2026,41002,GOOGLE ADS REFUND,Advertising,,250.00",
  ].join("\n");

  it("uses the posted date and reads direction from the column", () => {
    const result = parseAmexCsv(csv);
    expect(result.layout.splitAmountColumns).toBe(true);
    expect(result.charges).toHaveLength(2);

    expect(result.charges[0]).toMatchObject({
      postedOn: "2026-03-01", amount: 1500, status: "posted",
    });
    // A credit column entry is a refund, stored positive.
    expect(result.charges[1]).toMatchObject({
      postedOn: "2026-03-03", amount: 250, status: "refunded",
    });
  });
});

describe("parseAmexCsv — Chase Ink export", () => {
  // Chase writes purchases negative and uses "Post Date" rather than
  // "Posted Date", so this exercises both the alias table and the sign
  // detection against a non-Amex layout.
  const csv = [
    "Transaction Date,Post Date,Description,Category,Type,Amount",
    "03/01/2026,03/02/2026,GOOGLE *ADS 8829,Advertising,Sale,-1500.00",
    "03/03/2026,03/04/2026,STAPLES 00123,Office Supplies,Sale,-250.40",
    "03/05/2026,03/06/2026,Payment Thank You - Web,,Payment,2000.00",
    "03/07/2026,03/08/2026,GOOGLE *ADS REFUND,Advertising,Return,45.00",
  ].join("\n");

  it("resolves the Chase columns and posts the charges positive", () => {
    const result = parseAmexCsv(csv);

    expect(result.layout.headerFound).toBe(true);
    expect(result.layout.signConvention).toBe("negative_is_charge");

    const charges = result.charges.filter((c) => c.status === "posted");
    expect(charges).toHaveLength(2);
    expect(charges[0]).toMatchObject({
      postedOn: "2026-03-02", merchant: "GOOGLE *ADS 8829", amount: 1500,
    });
    expect(charges[1].amount).toBe(250.4);
  });

  it("treats a Chase return as a refund and drops the payment", () => {
    const result = parseAmexCsv(csv);

    expect(result.charges.find((c) => /REFUND/.test(c.merchant))).toMatchObject({
      amount: 45, status: "refunded",
    });
    expect(result.charges.some((c) => /Payment Thank You/.test(c.merchant))).toBe(false);
  });
});

describe("parseAmexCsv — headerless files", () => {
  const csv = [
    "03/01/2026,GOOGLE ADS 8829,1500.00",
    "03/02/2026,META PLATFORMS INC,2250.75",
    "03/03/2026,TIKTOK ADS,800.00",
  ].join("\n");

  it("infers columns positionally", () => {
    const result = parseAmexCsv(csv);
    expect(result.layout.headerFound).toBe(false);
    expect(result.layout.columns).toMatchObject({ date: 0, description: 1, amount: 2 });
    expect(result.charges).toHaveLength(3);
    expect(result.charges[0].postedOn).toBe("2026-03-01");
    expect(result.charges[0].amount).toBe(1500);
  });

  it("infers a different column order", () => {
    const reordered = [
      "GOOGLE ADS 8829,1500.00,03/01/2026",
      "META PLATFORMS INC,2250.75,03/02/2026",
    ].join("\n");
    const result = parseAmexCsv(reordered);
    expect(result.layout.columns).toMatchObject({ date: 2, description: 0, amount: 1 });
    expect(result.charges[0].merchant).toBe("GOOGLE ADS 8829");
  });
});

describe("parseAmexCsv — statement noise", () => {
  const csv = [
    "Prepared for BEN W",
    "Date,Description,Amount",
    "03/01/2026,GOOGLE ADS,1500.00",
    "Total New Charges,,1500.00",
    "Previous Balance,,900.00",
    ",,",
    "03/02/2026,META ADS,500.00",
    "Page 2 of 3",
  ].join("\n");

  it("finds the header below a title line and drops summary rows", () => {
    const result = parseAmexCsv(csv);
    expect(result.layout.headerFound).toBe(true);
    expect(result.charges.map((c) => c.merchant)).toEqual(["GOOGLE ADS", "META ADS"]);
    expect(result.skipped.some((s) => s.reason === "Statement summary line.")).toBe(true);
  });

  it("skips repeated headers in multi-section exports", () => {
    const withRepeat = [
      "Date,Description,Amount",
      "03/01/2026,GOOGLE ADS,1500.00",
      "Date,Description,Amount",
      "03/02/2026,META ADS,500.00",
    ].join("\n");
    const result = parseAmexCsv(withRepeat);
    expect(result.charges).toHaveLength(2);
    expect(result.skipped.some((s) => s.reason === "Repeated header row.")).toBe(true);
  });

  it("records every non-empty row for the audit trail", () => {
    const result = parseAmexCsv(csv);
    expect(result.rawRows.length).toBeGreaterThanOrEqual(result.charges.length);
    expect(result.rawRows.some((r) => r.parseError !== null)).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */
/* Sign convention                                                         */
/* ---------------------------------------------------------------------- */

describe("detectSignConvention", () => {
  it("reads the convention from a payment line", () => {
    const result = detectSignConvention([
      { amount: -1500, descriptor: "GOOGLE ADS" },
      { amount: 2000, descriptor: "ONLINE PAYMENT - THANK YOU" },
    ]);
    // The payment is positive, so spending must be negative.
    expect(result.convention).toBe("negative_is_charge");
  });

  it("falls back to the majority side when there is no payment line", () => {
    const result = detectSignConvention([
      { amount: 100, descriptor: "GOOGLE ADS" },
      { amount: 200, descriptor: "META ADS" },
      { amount: -50, descriptor: "REFUND" },
    ]);
    expect(result.convention).toBe("positive_is_charge");
  });

  it("breaks a tie on the larger total", () => {
    const result = detectSignConvention([
      { amount: -5000, descriptor: "GOOGLE ADS" },
      { amount: 20, descriptor: "SOME CREDIT" },
    ]);
    expect(result.convention).toBe("negative_is_charge");
  });

  it("assumes the Amex default for an empty file", () => {
    expect(detectSignConvention([]).convention).toBe("positive_is_charge");
  });
});

describe("parseAmexCsv — inverted sign convention", () => {
  const csv = [
    "Date,Description,Amount",
    "03/01/2026,GOOGLE ADS,-1500.00",
    "03/02/2026,META ADS,-2250.00",
    "03/03/2026,TIKTOK ADS,-800.00",
    "03/04/2026,AUTOPAY PAYMENT RECEIVED,4550.00",
  ].join("\n");

  it("detects that purchases are negative and stores them positive", () => {
    const result = parseAmexCsv(csv);
    expect(result.layout.signConvention).toBe("negative_is_charge");
    expect(result.charges).toHaveLength(3);
    expect(result.charges.every((c) => c.amount > 0 && c.status === "posted")).toBe(true);
    expect(result.charges[0].amount).toBe(1500);
  });

  it("keeps the card payment out of the charge log", () => {
    const result = parseAmexCsv(csv);
    expect(result.charges.some((c) => /AUTOPAY/.test(c.merchant))).toBe(false);
    expect(result.skipped.some((s) => s.reason === "Card payment, not a charge.")).toBe(true);
  });
});

describe("parseAmexCsv — refunds", () => {
  const csv = [
    "Date,Description,Amount",
    "03/01/2026,GOOGLE ADS,1500.00",
    "03/02/2026,META ADS,900.00",
    "03/03/2026,GOOGLE ADS REFUND,-250.00",
  ].join("\n");

  it("stores a refund positive with status refunded", () => {
    const result = parseAmexCsv(csv);
    expect(result.layout.signConvention).toBe("positive_is_charge");
    const refund = result.charges.find((c) => /REFUND/.test(c.merchant));
    expect(refund).toMatchObject({ amount: 250, status: "refunded" });
  });
});

/* ---------------------------------------------------------------------- */
/* Occurrence                                                              */
/* ---------------------------------------------------------------------- */

describe("occurrence numbering", () => {
  it("numbers identical same-day charges so both survive dedupe", () => {
    const csv = [
      "Date,Description,Amount",
      "03/01/2026,GOOGLE ADS 8829,1500.00",
      "03/01/2026,GOOGLE ADS 8829,1500.00",
      "03/01/2026,GOOGLE ADS 8829,1500.00",
    ].join("\n");

    const result = parseAmexCsv(csv);
    expect(result.charges).toHaveLength(3);
    expect(result.charges.map((c) => c.occurrence)).toEqual([1, 2, 3]);
  });

  it("does not conflate charges that differ in date, amount or descriptor", () => {
    const csv = [
      "Date,Description,Amount",
      "03/01/2026,GOOGLE ADS,1500.00",
      "03/02/2026,GOOGLE ADS,1500.00",
      "03/01/2026,GOOGLE ADS,1500.01",
      "03/01/2026,META ADS,1500.00",
    ].join("\n");

    const result = parseAmexCsv(csv);
    expect(result.charges.map((c) => c.occurrence)).toEqual([1, 1, 1, 1]);
  });

  it("is stable across a re-import of the same file, which keeps it idempotent", () => {
    const csv = [
      "Date,Description,Amount",
      "03/01/2026,GOOGLE ADS,1500.00",
      "03/01/2026,GOOGLE ADS,1500.00",
    ].join("\n");

    const first = parseAmexCsv(csv).charges.map((c) => c.occurrence);
    const second = parseAmexCsv(csv).charges.map((c) => c.occurrence);
    expect(first).toEqual(second);
  });

  it("matches descriptors the way the database fingerprint does", () => {
    const charges = [
      { postedOn: "2026-03-01", amount: 100, descriptor: "GOOGLE  ADS" },
      { postedOn: "2026-03-01", amount: 100, descriptor: "google ads" },
    ] as ParsedCharge[];
    assignOccurrences(charges);
    // Case and repeated whitespace are normalised away, as in charge_fingerprint().
    expect(charges.map((c) => c.occurrence)).toEqual([1, 2]);
  });
});
