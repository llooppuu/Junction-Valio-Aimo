import { Bell, ChevronDown, ClipboardCheck, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SupplierReliability } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { personName } from "../lib/names";
import type { Summary } from "../lib/useSummary";
import { ActivityLog } from "./ActivityLog";
import { AgentPanel } from "./AgentPanel";
import { ApprovalQueue } from "./ApprovalQueue";
import { AutonomyCard } from "./AutonomyCard";
import { DemoControls } from "./DemoControls";
import { MandateCard } from "./MandateCard";
import { PolicyCard } from "./PolicyCard";
import { alertRequest, StockAlerts } from "./StockAlerts";
import { renewalRequest, StandingOrderPanel } from "./StandingOrder";
import { suggestionRequest, SuggestionsPanel } from "./Suggestions";

interface Kitchen {
  agentId: string;
  name: string;
  agentName: string;
}

interface AgentWorkspaceProps {
  active: boolean;
  summary: Summary | null;
  agentAvailable: boolean;
  kitchen: Kitchen;
  kitchens: readonly Kitchen[];
  onKitchenChange: (id: string) => void;
  version: number;
  resets: number;
  reliability: Map<string, SupplierReliability>;
  launch: { message: string; at: number } | null;
  onLaunched: (at: number) => void;
  onAsk: (agentId: string, message: string) => void;
  onChange: () => void;
  onReset: () => void;
  onOpenQuote: (id: string) => void;
  onShowActivity: () => void;
}

type Panel = "approvals" | "updates" | "settings";

/** Keep purchasing in one screen; supporting information opens without moving the conversation. */
export function AgentWorkspace(props: AgentWorkspaceProps) {
  const { t } = useI18n();
  const { active, summary, agentAvailable, kitchen, kitchens, version, resets, onChange } = props;
  const [panel, setPanel] = useState<Panel | null>(null);
  const alerts = summary?.alerts.filter((alert) => alert.agentId === kitchen.agentId) ?? [];
  const suggestions = summary?.suggestions.filter((suggestion) => suggestion.agentId === kitchen.agentId) ?? [];
  const standingOrder = summary?.standingOrders.find((review) => review.agentId === kitchen.agentId);
  const waiting = summary?.quotes.filter((quote) => quote.status === "needs_approval").length ?? 0;
  const updates = alerts.filter((alert) => alert.status === "open").length
    + suggestions.filter((suggestion) => suggestion.status === "suggested").length
    + (standingOrder?.flagged ? 1 : 0);

  useEffect(() => { if (!active) setPanel(null); }, [active]);

  // Mobile keyboards can resize the visual viewport without resizing the page.
  useEffect(() => {
    if (!active) return;
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || viewport.scale === 1) {
        const height = viewport?.height ?? window.innerHeight;
        document.documentElement.style.setProperty("--workspace-viewport-height", `${height}px`);
        document.documentElement.classList.toggle("workspace-short-viewport", height <= 512);
        document.documentElement.classList.toggle("workspace-very-short-viewport", height <= 416);
      }
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--workspace-viewport-height");
      document.documentElement.classList.remove("workspace-short-viewport", "workspace-very-short-viewport");
    };
  }, [active]);

  const handover = (message: string) => {
    setPanel(null);
    props.onAsk(kitchen.agentId, message);
  };

  return (
    <div className="agent-workspace">
      <div className="workspace-toolbar">
        <div className="workspace-title">
          <h1 id="workspace-title">{t("nav.workspace")}</h1>
          <label className="workspace-kitchen">
            <span className="visually-hidden">{t("kitchen.label")}</span>
            <select value={kitchen.agentId} onChange={(event) => props.onKitchenChange(event.target.value)}>
              {kitchens.map((option) => <option key={option.agentId} value={option.agentId}>{personName(option.name)}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        </div>
        <div className="workspace-tools" role="group" aria-label={t("workspace.tools")}>
          <button type="button" className={`workspace-tool ${waiting > 0 ? "workspace-tool-attention" : ""}`} onClick={() => setPanel("approvals")} aria-haspopup="dialog">
            <ClipboardCheck size={18} aria-hidden="true" />
            {t("workspace.approvals")}
            <span className="workspace-tool-count">{summary ? waiting : "…"}</span>
          </button>
          <button type="button" className="workspace-tool" onClick={() => setPanel("updates")} aria-haspopup="dialog">
            <Bell size={18} aria-hidden="true" />
            {t("workspace.updates")}
            {updates > 0 && <span className="workspace-tool-count">{updates}</span>}
          </button>
          <button type="button" className="workspace-tool" onClick={() => setPanel("settings")} aria-haspopup="dialog">
            <Settings2 size={18} aria-hidden="true" />
            {t("workspace.settings")}
          </button>
        </div>
      </div>

      <AgentPanel
        key={`agent-${kitchen.agentId}-${resets}`}
        launch={props.launch}
        onLaunched={props.onLaunched}
        agentId={kitchen.agentId}
        agentName={personName(kitchen.agentName)}
        onActivity={onChange}
        onReviewApprovals={() => setPanel("approvals")}
      />

      <WorkspaceDrawer open={active && panel !== null} title={t(panel === "approvals" ? "workspace.approvals" : panel === "updates" ? "workspace.updates" : "workspace.settings")} onClose={() => setPanel(null)}>
        <div hidden={panel !== "approvals"}>
          <ApprovalQueue key={`queue-${resets}`} version={version} onDecision={onChange} reliability={props.reliability} />
        </div>
        <div hidden={panel !== "updates"}>
          <StockAlerts alerts={alerts} agentAvailable={agentAvailable} onAsk={(alert) => handover(alertRequest(alert))} />
          <SuggestionsPanel suggestions={suggestions} agentAvailable={agentAvailable} onAsk={(suggestion) => handover(suggestionRequest(suggestion))} onChange={onChange} />
          <StandingOrderPanel review={standingOrder} agentAvailable={agentAvailable} onAsk={(review) => handover(renewalRequest(review))} />
          {!standingOrder && !alerts.some((alert) => alert.status === "open") && !suggestions.some((suggestion) => ["suggested", "held_back"].includes(suggestion.status)) && <p className="workspace-panel-empty">{t("workspace.noUpdates")}</p>}
        </div>
        <div className="workspace-settings" hidden={panel !== "settings"}>
          <details>
            <summary>{t("workspace.rules")}</summary>
            <PolicyCard policy={summary?.policies.find((policy) => policy.agentId === kitchen.agentId) ?? null} />
          </details>
          <details>
            <summary>{t("mandate.title")}</summary>
            <MandateCard agentId={kitchen.agentId} version={version} onChange={onChange} />
          </details>
          <details>
            <summary>{t("autonomy.title")}</summary>
            <AutonomyCard agentId={kitchen.agentId} version={version} onChange={onChange} />
          </details>
          <details>
            <summary>{t("activity.live")}</summary>
            <ActivityLog key={`feed-${resets}`} version={version} compact onOpenQuote={props.onOpenQuote} onShowAll={props.onShowActivity} />
          </details>
          <details>
            <summary>{t("demo.title")}</summary>
            <DemoControls onReset={props.onReset} />
          </details>
        </div>
      </WorkspaceDrawer>
    </div>
  );
}

function WorkspaceDrawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { element.close(); return; }
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, [open]);

  return (
    <dialog ref={dialog} className="workspace-drawer" aria-labelledby="workspace-drawer-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose();
    }}>
      <header className="workspace-drawer-header">
        <h2 id="workspace-drawer-title">{title}</h2>
        <button type="button" className="workspace-drawer-close" aria-label={t("workspace.closePanel")} onClick={onClose}><X size={24} aria-hidden="true" /></button>
      </header>
      <div className="workspace-drawer-content">{children}</div>
    </dialog>
  );
}
