import { AlertTriangle, ShieldCheck, XCircle } from "lucide-react";
import type { SupplierReliability } from "../lib/api";
import { formatPercent } from "../lib/format";
import { tr, useI18n } from "../lib/i18n";
import { riskLabel, type DeliveryRisk } from "../lib/risk";

const ICONS: Record<DeliveryRisk, typeof ShieldCheck> = { low: ShieldCheck, moderate: AlertTriangle, high: XCircle };

/** What the figure is based on, for tooltips and notes. */
export function reliabilityParts(reliability: SupplierReliability): string {
  return tr("risk.parts", {
    products: reliability.products,
    lowest: reliability.lowest.name,
    lowestRate: formatPercent(reliability.lowest.reliability),
  });
}

/** A compact risk chip, for cards and lists. */
export function RiskBadge({ reliability }: { reliability: SupplierReliability }) {
  const { t } = useI18n();
  const Icon = ICONS[reliability.riskLevel];
  return (
    <span
      className={`risk-badge risk-${reliability.riskLevel}`}
      title={t("risk.title", { rate: formatPercent(reliability.reliability), parts: reliabilityParts(reliability) })}
    >
      <Icon aria-hidden="true" size={13} strokeWidth={2.5} />
      {riskLabel(reliability.riskLevel)}
    </span>
  );
}

/** A warning card for a flagged supplier. Low-risk suppliers show nothing, so warnings stay meaningful. */
export function RiskNote({ reliability }: { reliability: SupplierReliability }) {
  const { t } = useI18n();
  if (!reliability.flagged) return null;
  const Icon = ICONS[reliability.riskLevel];
  return (
    <div className={`risk-note risk-${reliability.riskLevel}`} role="note">
      <Icon aria-hidden="true" size={18} />
      <p>
        <strong>{riskLabel(reliability.riskLevel)}.</strong>{" "}
        {t("risk.note", { supplier: reliability.supplier, rate: formatPercent(reliability.reliability), parts: reliabilityParts(reliability) })}{" "}
        {t(reliability.riskLevel === "high" ? "risk.adviceHigh" : "risk.adviceModerate")}
      </p>
    </div>
  );
}
