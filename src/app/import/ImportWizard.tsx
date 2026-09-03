"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, formatMoneyCents, formatNumber, formatDate } from "@/lib/format";
import type { PreviewRow } from "@/lib/import/build";

interface PreviewResponse {
  cardAccount: { id: string; nickname: string; last4: string | null };
  filename: string;
  fileSha256: string;
  layout: {
    headerFound: boolean;
    headers: string[] | null;
    signConvention: string;
    signReason: string;
    splitAmountColumns: boolean;
  };
  rows: PreviewRow[];
  skipped: { lineNo: number; reason: string }[];
  summary: {
    rawRowCount: number;
    parsedCount: number;
    newCount: number;
    duplicateCount: number;
    skippedCount: number;
    eligibleNewSpend: number;
    newPoints: number;
    years: number[];
  };
}

interface CommitResponse {
  batchId: string;
  selectedCount: number;
  insertedCount: number;
  duplicateCount: number;
  skippedCount: number;
}

type Override = { countsTowardCap?: boolean };

export function ImportWizard({
  accounts,
}: {
  accounts: { id: string; nickname: string; last4: string | null }[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [cardAccountId, setCardAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [busy, setBusy] = useState<"idle" | "previewing" | "committing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResponse | null>(null);

  const selectedRows = useMemo(
    () => (preview?.rows ?? []).filter((row) => selected.has(row.lineNo)),
    [preview, selected],
  );

  const selectedTotals = useMemo(() => {
    let eligible = 0;
    let points = 0;
    for (const row of selectedRows) {
      const counts = overrides[row.lineNo]?.countsTowardCap ?? row.countsTowardCap;
      if (counts && row.status === "posted") eligible += row.amount;
      points += row.points;
    }
    return { eligible, points, count: selectedRows.length };
  }, [selectedRows, overrides]);

  function reset() {
    setPreview(null);
    setSelected(new Set());
    setOverrides({});
    setResult(null);
    setError(null);
  }

  async function runPreview(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setBusy("previewing");
    setError(null);
    setResult(null);

    const body = new FormData();
    body.set("file", file);
    body.set("cardAccountId", cardAccountId);

    const response = await fetch("/api/import/preview", { method: "POST", body });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error ?? "Preview failed.");
      setBusy("idle");
      return;
    }

    const data = payload as PreviewResponse;
    setPreview(data);
    // Pre-tick everything new; duplicates stay unticked since committing them
    // is a no-op anyway.
    setSelected(new Set(data.rows.filter((r) => r.disposition === "new").map((r) => r.lineNo)));
    setOverrides({});
    setBusy("idle");
  }

  async function commit() {
    if (!file || !preview || selected.size === 0) return;

    setBusy("committing");
    setError(null);

    const body = new FormData();
    body.set("file", file);
    body.set("cardAccountId", cardAccountId);
    body.set("selected", JSON.stringify([...selected]));
    body.set("overrides", JSON.stringify(overrides));

    const response = await fetch("/api/import/commit", { method: "POST", body });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error ?? "Import failed.");
      setBusy("idle");
      return;
    }

    setResult(payload as CommitResponse);
    setPreview(null);
    setSelected(new Set());
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setBusy("idle");
    router.refresh();
  }

  function toggle(lineNo: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(lineNo)) next.delete(lineNo);
      else next.add(lineNo);
      return next;
    });
  }

  function toggleAll(rows: PreviewRow[]) {
    const everySelected = rows.every((row) => selected.has(row.lineNo));
    setSelected((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (everySelected) next.delete(row.lineNo);
        else next.add(row.lineNo);
      }
      return next;
    });
  }

  function setEligibility(lineNo: number, countsTowardCap: boolean) {
    setOverrides((current) => ({ ...current, [lineNo]: { ...current[lineNo], countsTowardCap } }));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={runPreview} className="card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="file" className="mb-1.5 block text-sm text-ink-300">
              Statement CSV
            </label>
            <input
              id="file"
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                reset();
              }}
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink-800 file:px-3 file:py-1 file:text-sm file:text-ink-100"
            />
          </div>

          <div>
            <label htmlFor="account" className="mb-1.5 block text-sm text-ink-300">
              Import into
            </label>
            <select
              id="account"
              value={cardAccountId}
              onChange={(e) => {
                setCardAccountId(e.target.value);
                reset();
              }}
              className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.nickname}
                  {account.last4 ? ` ••••${account.last4}` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={!file || !cardAccountId || busy !== "idle"}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy === "previewing" ? "Parsing…" : "Preview"}
          </button>
        </div>

        <p className="mt-3 text-xs text-ink-500">
          Preview parses, classifies and checks the file against what is already stored. It
          writes nothing.
        </p>
      </form>

      {error ? (
        <p className="card border-danger-400/30 bg-danger-400/5 p-4 text-sm text-danger-400">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="card border-accent-500/30 bg-accent-500/5 p-5">
          <h2 className="font-semibold text-accent-400">Import committed</h2>
          <p className="mt-1 text-sm text-ink-300">
            {formatNumber(result.insertedCount)} charge
            {result.insertedCount === 1 ? "" : "s"} added
            {result.duplicateCount > 0
              ? `, ${formatNumber(result.duplicateCount)} already existed and were left alone`
              : ""}
            .
          </p>
        </div>
      ) : null}

      {preview ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Rows parsed" value={formatNumber(preview.summary.parsedCount)} />
            <Stat
              label="New"
              value={formatNumber(preview.summary.newCount)}
              tone="text-accent-400"
            />
            <Stat
              label="Already stored"
              value={formatNumber(preview.summary.duplicateCount)}
              tone="text-ink-500"
            />
            <Stat
              label="Skipped"
              value={formatNumber(preview.summary.skippedCount)}
              tone="text-ink-500"
            />
          </section>

          <section className="card p-4 text-xs text-ink-500">
            <p>
              <span className="text-ink-300">Layout:</span>{" "}
              {preview.layout.headerFound
                ? `header row matched (${preview.layout.headers?.length} columns)`
                : "no header found — columns inferred from the data"}
              {preview.layout.splitAmountColumns ? ", separate debit/credit columns" : ""}.
            </p>
            <p className="mt-1">
              <span className="text-ink-300">Sign convention:</span>{" "}
              {preview.layout.signConvention === "positive_is_charge"
                ? "purchases are positive"
                : "purchases are negative"}{" "}
              — {preview.layout.signReason}
            </p>
          </section>

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium">{formatNumber(selectedTotals.count)}</span> row
                {selectedTotals.count === 1 ? "" : "s"} selected ·{" "}
                <span className="text-accent-400 tabular">
                  {formatMoney(selectedTotals.eligible)}
                </span>{" "}
                eligible ·{" "}
                <span className="tabular">{formatNumber(selectedTotals.points)}</span> points
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleAll(preview.rows.filter((r) => r.disposition === "new"))}
                  className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:border-ink-500"
                >
                  Toggle all new
                </button>
                <button
                  onClick={commit}
                  disabled={selected.size === 0 || busy !== "idle"}
                  className="rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy === "committing"
                    ? "Importing…"
                    : `Import ${formatNumber(selected.size)} row${selected.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </header>

            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="sticky top-0 bg-ink-900">
                  <tr className="border-b border-ink-800 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-3 py-2.5 font-medium"> </th>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Merchant</th>
                    <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-3 py-2.5 font-medium">Bonus?</th>
                    <th className="px-3 py-2.5 text-right font-medium">At bonus</th>
                    <th className="px-3 py-2.5 text-right font-medium">Points</th>
                    <th className="px-3 py-2.5 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const counts = overrides[row.lineNo]?.countsTowardCap ?? row.countsTowardCap;
                    const isDuplicate = row.disposition === "duplicate";

                    return (
                      <tr
                        key={row.lineNo}
                        className={`border-b border-ink-850 last:border-0 ${
                          isDuplicate ? "opacity-55" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.has(row.lineNo)}
                            onChange={() => toggle(row.lineNo)}
                            className="h-4 w-4 accent-green-500"
                            aria-label={`Select ${row.merchant}`}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink-300 tabular">
                          {formatDate(row.postedOn)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="block max-w-[260px] truncate" title={row.descriptor}>
                            {row.merchant}
                          </span>
                          <span className="text-xs text-ink-500">
                            {row.matchedPattern ? `rule: ${row.category}` : "no rule matched"}
                            {row.occurrence > 1 ? ` · occurrence ${row.occurrence}` : ""}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          {formatMoneyCents(row.amount)}
                          {row.status === "refunded" ? (
                            <span className="ml-1 text-xs text-warn-400">refund</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={counts}
                            onChange={(e) => setEligibility(row.lineNo, e.target.checked)}
                            className="h-4 w-4 accent-green-500"
                            aria-label={`Counts toward cap for ${row.merchant}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular text-accent-400">
                          {row.amountAtBonus > 0 ? formatMoneyCents(row.amountAtBonus) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          {formatNumber(row.points)}
                        </td>
                        <td className="px-3 py-2">
                          {isDuplicate ? (
                            <span className="rounded-md bg-ink-800 px-2 py-0.5 text-xs text-ink-500">
                              already stored
                            </span>
                          ) : (
                            <span className="rounded-md bg-accent-500/15 px-2 py-0.5 text-xs text-accent-400">
                              new
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {preview.skipped.length > 0 ? (
            <section className="card p-5">
              <h2 className="text-sm font-medium">
                Skipped {formatNumber(preview.skipped.length)} line
                {preview.skipped.length === 1 ? "" : "s"}
              </h2>
              <ul className="mt-2 space-y-1 text-xs text-ink-500">
                {preview.skipped.slice(0, 25).map((skip) => (
                  <li key={skip.lineNo}>
                    Line {skip.lineNo}: {skip.reason}
                  </li>
                ))}
                {preview.skipped.length > 25 ? (
                  <li>…and {preview.skipped.length - 25} more.</li>
                ) : null}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular ${tone}`}>{value}</p>
    </div>
  );
}
