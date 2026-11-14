import { Bot } from "lucide-react";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityLog } from "./components/ActivityLog";
import { Dashboard } from "./components/Dashboard";
import { HeroVideo } from "./components/HeroVideo";
import { OrdersView } from "./components/OrdersView";
import { ProductCatalog } from "./components/ProductCatalog";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import { WholesalerView } from "./components/WholesalerView";
import { fetchAgentStatus, type AgentStatus } from "./lib/api";
import { useI18n } from "./lib/i18n";
import type { MessageKey } from "./lib/messages";
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
    <div className={`shell ${view === "workspace" ? "shell-workspace" : ""}`}>
      <SiteHeader
        view={view}
        onSelect={selectView}
        badges={{
          workspace: { count: waiting, attention: true },
          orders: { count: summary?.orders.length ?? 0 },
        }}
      />

      <main className="shell-main">
        {view !== "workspace" && <section className={`page-hero ${dashboard ? "page-hero-feature" : ""}`} aria-labelledby="page-title">
          {dashboard && <HeroVideo />}
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
        </section>}

        <div className={`page ${view === "workspace" ? "workspace-page" : ""}`}>
          {/* Every view stays mounted, so a running agent keeps updating while you look at another view. */}
          <div id="view-dashboard" hidden={view !== "dashboard"}>
            <Dashboard summary={summary} agent={agent} onNavigate={selectView} onShowQuote={openQuote} />
          </div>

          <div id="view-workspace" hidden={view !== "workspace"}>
            <AgentWorkspace
              active={view === "workspace"}
              summary={summary}
              agentAvailable={agent?.available ?? false}
              kitchen={kitchen}
              kitchens={KITCHENS}
              onKitchenChange={setKitchenId}
              version={version}
              resets={resets}
              reliability={reliability}
              launch={ask && !ask.sent && ask.agentId === kitchen.agentId ? { message: ask.message, at: ask.at } : null}
              onLaunched={(at) => setAsk((current) => (current && current.at === at ? { ...current, sent: true } : current))}
              onAsk={(agentId, message) => setAsk({ agentId, message, at: Date.now(), sent: false })}
              onChange={refresh}
              onReset={onReset}
              onOpenQuote={openQuote}
              onShowActivity={() => selectView("activity")}
            />
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

      {view !== "workspace" && <SiteFooter onSelect={selectView} />}
    </div>
  );
}
