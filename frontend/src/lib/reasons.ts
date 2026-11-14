import type { Quote } from "./api";
import { formatEuroCents } from "./format";
import { getLanguage, tr } from "./i18n";

/**
 * The server's decision for a quote, in the interface's language. In English
 * the server's own sentence is the most specific; in Finnish the sentence is
 * built from the same structured checks, so it never disagrees with them.
 */
export function permissionReason(quote: Pick<Quote, "permission" | "totalEurCents">): string {
  const { permission } = quote;
  if (getLanguage() === "en") return permission.reason;
  if (permission.decision === "within_limit") return tr("reason.within");
  if (permission.decision === "created_by_buyer") return tr("reason.buyer");

  const parts = (permission.checks ?? [])
    .filter((check) => check.outcome !== "passed")
    .map((check) => {
      if (check.rule === "spending_limit" && permission.limitEurCents !== null) {
        return tr("reason.spending", { total: formatEuroCents(quote.totalEurCents), limit: formatEuroCents(permission.limitEurCents) });
      }
      if (check.rule === "daily_limit") return tr("reason.daily");
      return tr("reason.rule", { rule: tr(`rule.${check.rule}`) });
    });
  return [...parts, tr("reason.approve")].join(" ");
}

/** Short phrases the server repeats often, such as "out of stock", in the interface's language. */
/** Valio Aimo's availability reasons from the server, in Finnish when Finnish is selected. */
const PHRASES: [RegExp, (...parts: string[]) => string][] = [
  [/^out of stock$/, () => tr("product.outOfStock").toLowerCase()],
  [/^Valio Aimo cannot deliver it on any date$/, () => "Valio Aimo ei voi toimittaa sitä millekään päivälle"],
  [/^Valio Aimo has blocked its sales for now$/, () => "Valio Aimo on toistaiseksi estänyt sen myynnin"],
  [/^Valio Aimo has no price for it$/, () => "Valio Aimolla ei ole sille hintaa"],
  [/^none available for (d{4})-(d{2})-(d{2})$/, (_all, year, month, day) => `ei saatavilla ${Number(day)}.${Number(month)}.${year}`],
  [/^none available$/, () => "ei saatavilla"],
  [
    /^the order cut-off for delivery on (d{4})-(d{2})-(d{2}) was (.+)$/,
    (_all, year, month, day, time) => `toimitukselle ${Number(day)}.${Number(month)}.${year} tilausaika päättyi (${time})`,
  ],
  [/^allergens not declared by the manufacturer$/, () => "valmistaja ei ole ilmoittanut allergeeneja"],
];

export function serverPhrase(text: string): string {
  if (getLanguage() === "en") return text;
  for (const [pattern, finnish] of PHRASES) {
    const match = pattern.exec(text);
    if (match) return finnish(...match);
  }
  return text;
}
