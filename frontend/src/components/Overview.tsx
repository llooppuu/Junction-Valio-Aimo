import { Bot, Hourglass, PackageCheck, ShieldCheck, type LucideIcon } from "lucide-react";
import { formatEuroCents } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { personName } from "../lib/names";
import type { Summary } from "../lib/useSummary";

interface OverviewProps {
  summary: Summary | null;
  agentAvailable: boolean;
  /** The kitchen whose agent the workspace is showing. */
  agentId: string;
}

interface Stat {
  key: string;
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  attention?: boolean;
}

/** Four numbers that tell the buyer where things stand, for the kitchen in view. */
export function Overview({ summary, agentAvailable, agentId }: OverviewProps) {
  const { t } = useI18n();
  const policy = summary?.policies.find((candidate) => candidate.agentId === agentId) ?? null;
  const waiting = summary?.quotes.filter((quote) => quote.status === "needs_approval") ?? [];
  const waitingTotal = waiting.reduce((total, quote) => total + quote.totalEurCents, 0);
  const orders = summary?.orders ?? [];
  const spent = orders.reduce((total, order) => total + order.totalEurCents, 0);
  const runs = summary?.runs ?? [];
  const running = runs.filter((run) => run.status === "running").length;
  const value = (text: string) => (summary ? text : "…");

  const stats: Stat[] = [
    {
      key: "limit",
      label: t("stat.limit"),
      value: value(policy ? formatEuroCents(policy.spendingLimitEurCents) : t("stat.notSet")),
      note: policy ? t("stat.perQuote", { buyer: personName(policy.buyerName) }) : t("stat.perQuoteServer"),
      icon: ShieldCheck,
    },
    {
      key: "waiting",
      label: t("stat.waitingForYou"),
      value: value(String(waiting.length)),
      note: waiting.length > 0 ? t("stat.toReview", { amount: formatEuroCents(waitingTotal) }) : t("stat.nothingToReview"),
      icon: Hourglass,
      attention: waiting.length > 0,
    },
    {
      key: "orders",
      label: t("stat.orders"),
      value: value(String(orders.length)),
      note: t("stat.inTotal", { amount: formatEuroCents(spent) }),
      icon: PackageCheck,
    },
    {
      key: "runs",
      label: t("stat.runs"),
      value: value(agentAvailable ? String(runs.length) : t("stat.off")),
      note: running > 0 ? t("stat.workingNow") : agentAvailable ? t("stat.idle") : t("stat.turnOn"),
      icon: Bot,
    },
  ];

  return (
    <section className="overview" aria-label={t("overview.label")}>
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.key} className={`stat ${stat.attention ? "stat-attention" : ""}`}>
            <div className="stat-top">
              <p className="stat-label">{stat.label}</p>
              <Icon aria-hidden="true" size={18} className="stat-icon" />
            </div>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-note">{stat.note}</p>
          </div>
        );
      })}
    </section>
  );
}
