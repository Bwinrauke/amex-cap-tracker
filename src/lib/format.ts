const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatMoney = (value: number | null | undefined) =>
  money.format(Number(value ?? 0));

export const formatMoneyCents = (value: number | null | undefined) =>
  moneyCents.format(Number(value ?? 0));

export const formatNumber = (value: number | null | undefined) =>
  number.format(Number(value ?? 0));

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Today in the server's local calendar, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
