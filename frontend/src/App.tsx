import { Bot } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityLog } from "./components/ActivityLog";
import { AgentPanel } from "./components/AgentPanel";
import { ApprovalQueue } from "./components/ApprovalQueue";
import { Dashboard } from "./components/Dashboard";
import { DemoControls } from "./components/DemoControls";
import { OrdersView } from "./components/OrdersView";
import { Overview } from "./components/Overview";
import { MandateCard } from "./components/MandateCard";
import { PolicyCard } from "./components/PolicyCard";
import { ProductCatalog } from "./components/ProductCatalog";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import { renewalRequest, StandingOrderPanel } from "./components/StandingOrder";
import { alertRequest, StockAlerts } from "./components/StockAlerts";
import { suggestionRequest, SuggestionsPanel } from "./components/Suggestions";
import { WholesalerView } from "./components/WholesalerView";
import { fetchAgentStatus, type AgentStatus } from "./lib/api";
import { useI18n } from "./lib/i18n";
import type { MessageKey } from "./lib/messages";
import { personName } from "./lib/names";
import { reliabilityBySupplier } from "./lib/risk";
import { useHashTab } from "./lib/useHashTab";
import { useSummary } from "./lib/useSummary";
import { VIEW_NAMES, VIEWS, type View } from "./lib/views";

/** The line under each view's heading. */
const INTROS: Record<View, MessageKey> = {
  dashboard: "dash.intro",
  workspace: "view.workspace.intro",
  catalog: "view.catalog.intro",
  orders: "view.orders.intro",
  activity: "view.activity.intro",
  wholesaler: "view.wholesaler.intro",
};

/** The two kitchens, each with its own agent and policy on the server. */
const KITCHENS = [
  { agentId: "demo-agent", name: "Hotel chain", agentName: "Hotel chain purchasing agent" },
  { agentId: "school-agent", name: "School kitchen", agentName: "School kitchen purchasing agent" },
] as const;

export function App() {
  const { t, language } = useI18n();
  // Bumped whenever something changes, so every view refreshes at once instead of waiting for its next poll.
  const [version, setVersion] = useState(0);
  // Bumped on a reset, which remounts the views that hold their own conversation or selection.
  const [resets, setResets] = useState(0);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [focus, setFocus] = useState<{ quoteId: string; at: number } | null>(null);
  const [view, selectView] = useHashTab(VIEWS, "dashboard");
  const [kitchenId, setKitchenId] = useState<string>(KITCHENS[0].agentId);
  const kitchen = KITCHENS.find((candidate) => candidate.agentId === kitchenId) ?? KITCHENS[0];
  // A request the buyer handed to an agent from outside the chat, such as a stock alert. "sent" stops it being sent twice.
  const [ask, setAsk] = useState<{ agentId: string; message: string; at: number; sent: boolean } | null>(null);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);
  // Remounts the views that hold a conversation or selection, after the state was reset.
  const onReset = useCallback(() => {
    setAsk(null);
    setResets((current) => current + 1);
    setFocus(null);
    refresh();
  }, [refresh]);
  const openQuote = useCallback(
    (quoteId: string) => {
      setFocus({ quoteId, at: Date.now() });
      selectView("activity");
    },
    [selectView],
  );

  useEffect(() => {
    fetchAgentStatus()
      .then(setAgent)
      .catch(() => setAgent({ available: false, model: null }));
  }, []);

  // Each view scrolls back to the top when it opens, like a page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  useEffect(() => {
    document.title = `${t(VIEW_NAMES[view])} · Trusted Trade Agents`;
  }, [view, language, t]);

  const summary = useSummary(version, agent?.available ?? false);
  const reliability = useMemo(() => reliabilityBySupplier(summary?.suppliers ?? []), [summary]);
  const waiting = summary?.quotes.filter((quote) => quote.status === "needs_approval").length ?? 0;
  const dashboard = view === "dashboard";

  return (
    <div className="shell">
      <SiteHeader
        view={view}
        onSelect={selectView}
        badges={{
          workspace: { count: waiting, attention: true },
          orders: { count: summary?.orders.length ?? 0 },
        }}
      />

      <main className="shell-main">
        <section className={`page-hero ${dashboard ? "page-hero-feature" : ""}`} aria-labelledby="page-title">
          <div className="container page-hero-inner">
            <div>
              {dashboard && <p className="page-hero-eyebrow">{t("dash.eyebrow")}</p>}
              <h1 id="page-title">{t(VIEW_NAMES[view])}</h1>
              <p className="page-hero-intro">{t(INTROS[view])}</p>
            </div>
            {dashboard && (
              <div className="page-actions">
                <button type="button" className="button-outline-light" onClick={() => selectView("catalog")}>
                  {t("dash.browse")}
                </button>
                <button type="button" className="button-cta button-icon" onClick={() => selectView("workspace")}>
                  <Bot aria-hidden="true" size={18} />
                  {t("header.cta")}
                </button>
              </div>
            )}
          </div>
        </section>

        <div className="page">
          {/* Every view stays mounted, so a running agent keeps updating while you look at another view. */}
          <div id="view-dashboard" hidden={view !== "dashboard"}>
            <Dashboard summary={summary} agent={agent} onNavigate={selectView} onShowQuote={openQuote} />
          </div>

          <div id="view-workspace" hidden={view !== "workspace"}>
            <div className="kitchen-switch" role="radiogroup" aria-label={t("kitchen.label")}>
              <span className="kitchen-switch-label">{t("kitchen.label")}</span>
              {KITCHENS.map((option) => (
                <button
                  key={option.agentId}
                  type="button"
                  role="radio"
                  aria-checked={kitchenId === option.agentId}
                  className={`kitchen-option ${kitchenId === option.agentId ? "kitchen-option-on" : ""}`}
                  onClick={() => setKitchenId(option.agentId)}
                >
                  {personName(option.name)}
                </button>
              ))}
              <span className="kitchen-switch-note">{t("kitchen.note")}</span>
            </div>
            <Overview summary={summary} agentAvailable={agent?.available ?? false} agentId={kitchen.agentId} />
            <StockAlerts
              alerts={summary?.alerts.filter((alert) => alert.agentId === kitchen.agentId) ?? []}
              agentAvailable={agent?.available ?? false}
              onAsk={(alert) => setAsk({ agentId: alert.agentId, message: alertRequest(alert), at: Date.now(), sent: false })}
            />
            <SuggestionsPanel
              suggestions={summary?.suggestions.filter((suggestion) => suggestion.agentId === kitchen.agentId) ?? []}
              agentAvailable={agent?.available ?? false}
              onAsk={(suggestion) =>
                setAsk({ agentId: suggestion.agentId, message: suggestionRequest(suggestion), at: Date.now(), sent: false })
              }
              onChange={refresh}
            />
            <StandingOrderPanel
              review={summary?.standingOrders.find((review) => review.agentId === kitchen.agentId)}
              agentAvailable={agent?.available ?? false}
              onAsk={(review) => setAsk({ agentId: review.agentId, message: renewalRequest(review), at: Date.now(), sent: false })}
            />
            <div className="workspace">
              <AgentPanel
                key={`agent-${kitchen.agentId}-${resets}`}
                launch={ask && !ask.sent && ask.agentId === kitchen.agentId ? { message: ask.message, at: ask.at } : null}
                onLaunched={(at) => setAsk((current) => (current && current.at === at ? { ...current, sent: true } : current))}
                agentId={kitchen.agentId}
                agentName={personName(kitchen.agentName)}
                onActivity={refresh}
              />
              <div className="workspace-side">
                <ApprovalQueue key={`queue-${resets}`} version={version} onDecision={refresh} reliability={reliability} />
                <PolicyCard policy={summary?.policies.find((policy) => policy.agentId === kitchen.agentId) ?? null} />
                <MandateCard agentId={kitchen.agentId} version={version} onChange={refresh} />
                <ActivityLog
                  key={`feed-${resets}`}
                  version={version}
                  compact
                  onOpenQuote={openQuote}
                  onShowAll={() => selectView("activity")}
                />
                <DemoControls onReset={onReset} />
              </div>
            </div>
          </div>

          <div id="view-catalog" hidden={view !== "catalog"}>
            <ProductCatalog version={version} />
          </div>

          <div id="view-orders" hidden={view !== "orders"}>
            <OrdersView orders={summary?.orders ?? null} quotes={summary?.quotes ?? []} onShowQuote={openQuote} />
          </div>

          <div id="view-wholesaler" hidden={view !== "wholesaler"}>
            <WholesalerView version={version} onChange={refresh} />
          </div>

          <div id="view-activity" hidden={view !== "activity"}>
            <ActivityLog key={`log-${resets}`} version={version} focus={focus} />
          </div>
        </div>
      </main>

      <SiteFooter onSelect={selectView} />
    </div>
  );
}
