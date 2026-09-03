/**
 * RFC 4180 CSV tokenizer.
 *
 * Amex exports quote fields containing commas and sometimes embed newlines
 * inside "Extended Details", so splitting on commas is not an option.
 * Handles CRLF, a UTF-8 BOM, and doubled quotes ("") as an escaped quote.
 */
export function tokenizeCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let sawAnyChar = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    // Drop rows that are entirely empty, which trailing newlines produce.
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      // Swallow; the \n that follows ends the row. A lone \r ends it too.
      if (text[i + 1] !== "\n") endRow();
    } else {
      field += char;
    }
  }

  if (sawAnyChar && (field !== "" || row.length > 0)) endRow();

  return rows;
}
