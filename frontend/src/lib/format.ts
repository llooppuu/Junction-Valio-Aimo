import type { PackageUnit, Product } from "./api";
import { getLanguage, tr, type Language } from "./i18n";

const LOCALES: Record<Language, string> = { en: "en-GB", fi: "fi-FI" };

/** Intl formatters are slow to build, so each one is made once per language. */
function cached<T>(make: (locale: string) => T): () => T {
  const byLanguage = new Map<Language, T>();
  return () => {
    const language = getLanguage();
    let formatter = byLanguage.get(language);
    if (!formatter) {
      formatter = make(LOCALES[language]);
      byLanguage.set(language, formatter);
    }
    return formatter;
  };
}

const euroFormat = cached((locale) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }));
const numberFormat = cached((locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }));
const percentFormat = cached((locale) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }));
// Delivery dates have no time zone, so UTC keeps them on the same day for every viewer.
const dateFormat = cached(
  (locale) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
);
const longDateFormat = cached(
  (locale) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
);
const timeFormat = cached((locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }));
const timeSecondsFormat = cached((locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
const dateTimeFormat = cached(
  (locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
);

function unitLabel(unit: PackageUnit, amount: number): string {
  switch (unit) {
    case "litre":
      return getLanguage() === "fi" ? "l" : "L";
    case "kilogram":
      return "kg";
    case "piece":
      return tr(amount === 1 ? "unit.piece.one" : "unit.piece.other");
  }
}

export function formatEuroCents(cents: number): string {
  return euroFormat().format(cents / 100);
}

export function formatNumber(value: number): string {
  return numberFormat().format(value);
}

export function formatQuantity(amount: number, unit: PackageUnit): string {
  return `${numberFormat().format(amount)} ${unitLabel(unit, amount)}`;
}

export function formatPackages(count: number): string {
  return tr(count === 1 ? "unit.package.one" : "unit.package.other", { count: numberFormat().format(count) });
}

/** 0.97 becomes "97%" or "97 %". */
export function formatPercent(share: number): string {
  return percentFormat().format(share);
}

export function formatDeliveryDate(isoDate: string | null | undefined): string {
  return isoDate ? dateFormat().format(new Date(`${isoDate}T00:00:00Z`)) : "–";
}

/** For example "Wednesday 11 November" or "keskiviikko 11. marraskuuta". */
export function formatLongDate(isoDate: string): string {
  return longDateFormat().format(new Date(`${isoDate}T12:00:00Z`));
}

export function formatTime(iso: string): string {
  return timeFormat().format(new Date(iso));
}

export function formatTimeSeconds(iso: string): string {
  return timeSecondsFormat().format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat().format(new Date(iso));
}

/** Price per litre or kilogram, Valio Aimo's own when it gives one, which makes different package sizes comparable. */
export function formatUnitPrice({ pricePerPackageEurCents, packageSize, comparisonPrice }: Product): string {
  if (comparisonPrice) return `${formatEuroCents(comparisonPrice.eurCents)} / ${unitLabel(comparisonPrice.unit, 1)}`;
  const price = formatEuroCents(pricePerPackageEurCents / packageSize.amount);
  return `${price} / ${unitLabel(packageSize.unit, 1)}`;
}

export function formatTotalStock({ availablePackages, packageSize }: Product): string {
  return formatQuantity(availablePackages * packageSize.amount, packageSize.unit);
}

/** Valio Aimo's technical sales unit codes, in words. Unknown codes are shown as they are. */
const SALES_UNITS: Record<Language, Record<string, string>> = {
  en: { KI: "case", ST: "item", KG: "kg", PAK: "pack", BAG: "bag", RAS: "tub", PRK: "can", BOT: "bottle", SK: "sack", CS: "carton", KRT: "carton", PS: "bag" },
  fi: { KI: "laatikko", ST: "kpl", KG: "kg", PAK: "paketti", BAG: "pussi", RAS: "rasia", PRK: "purkki", BOT: "pullo", SK: "säkki", CS: "laatikko", KRT: "kartonki", PS: "pussi" },
};

export function salesUnitName(code: string): string {
  return SALES_UNITS[getLanguage()][code] ?? code;
}

/** An order cut-off time, for example "Sun 15 Nov, 17:00". */
export function formatCutoff(iso: string): string {
  return dateTimeFormat().format(new Date(iso));
}
