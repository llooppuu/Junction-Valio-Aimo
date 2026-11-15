import { ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cancelAgentRun,
  fetchAgentRun,
  fetchAgentRuns,
  fetchAgentStatus,
  startAgentRun,
  type AgentRun,
  type AgentStep,
} from "../lib/api";
import { formatEuroCents } from "../lib/format";
import { useI18n, type I18n } from "../lib/i18n";
import type { MessageKey } from "../lib/messages";
import { personName } from "../lib/names";
import { MenuPlanTable } from "./MenuPlanTable";
import { localized } from "../lib/reasons";
import { RequestComposer } from "./RequestComposer";
import { VoiceInput } from "./VoiceInput";
import { ListPhotoInput } from "./ListPhotoInput";

const POLL_INTERVAL_MS = 700;

interface Example {
  key: string;
  title: MessageKey;
  note: MessageKey;
  message: MessageKey;
}

/** Starting points shown before the first request, per kitchen. The hotel's first is the judges' example. */
const EXAMPLES: Record<string, Example[]> = {
  "demo-agent": [
    { key: "brief", title: "agent.ex.brief.title", note: "agent.ex.brief.note", message: "agent.example" },
    { key: "reliability", title: "agent.ex.reliability.title", note: "agent.ex.reliability.note", message: "agent.ex.reliability.message" },
    { key: "seafood", title: "agent.ex.seafood.title", note: "agent.ex.seafood.note", message: "agent.ex.seafood.message" },
  ],
  "school-agent": [
    { key: "oat", title: "agent.ex.oat.title", note: "agent.ex.oat.note", message: "agent.ex.oat.message" },
    { key: "trap", title: "agent.ex.trap.title", note: "agent.ex.trap.note", message: "agent.ex.trap.message" },
    { key: "rules", title: "agent.ex.rules.title", note: "agent.ex.rules.note", message: "agent.ex.rules.message" },
  ],
};

type StatusState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "off" }
  | { status: "on"; model: string };

interface Suggestion {
  label: string;
  message: string;
  /** Put the message in the box for the buyer to finish, instead of sending it. */
  fill?: boolean;
}

/** One-click follow-ups for the step the conversation has reached. */
function suggestionsFor(last: AgentRun | undefined, t: I18n["t"]): Suggestion[] {
  if (!last) return [];
  // The agent restated a list read from a photo: the buyer confirms it, or corrects it in their own words.
  if (last.status === "completed" && last.outcome === "list_to_confirm") {
    return [
      { label: t("agent.suggest.listCorrect"), message: t("agent.suggest.listCorrectMessage") },
      { label: t("agent.suggest.listFix"), message: t("agent.suggest.listFixMessage"), fill: true },
    ];
  }
  if (last.status !== "completed" || !last.quote) return [];
  const id = last.quote.id;
  switch (last.outcome) {
    case "quote_ready":
      return [{ label: t("agent.suggest.order"), message: t("agent.suggest.orderMessage") }];
    case "awaiting_approval":
      return [
        { label: t("agent.suggest.approved", { id }), message: t("agent.suggest.approvedMessage", { id }) },
        { label: t("agent.suggest.rejected", { id }), message: t("agent.suggest.rejectedMessage", { id }) },
      ];
    case "needs_attention":
      return [{ label: t("agent.suggest.newQuote"), message: t("agent.suggest.newQuoteMessage") }];
    default:
      return [];
  }
}

interface AgentPanelProps {
  /** A request handed over from elsewhere in the app, such as a stock alert, sent once as soon as the agent is ready. */
  launch?: { message: string; at: number } | null;
  /** Called once the launched request has been sent. */
  onLaunched?: (at: number) => void;
  /** The kitchen's agent that acts for new conversations. */
  agentId: string;
  agentName: string;
  /** Called whenever the agent may have changed something, so other views refresh. */
  onActivity: () => void;
  /** Opens the workspace's approval view without making the buyer scroll. */
  onReviewApprovals?: () => void;
}

/** Lets the buyer hand requests to the AI agent and watch it work through the API. */
export function AgentPanel({ launch = null, onLaunched, agentId, agentName, onActivity, onReviewApprovals }: AgentPanelProps) {
  const { t, language } = useI18n();
  const [agent, setAgent] = useState<StatusState>({ status: "loading" });
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The photos sent this session, by run, to show in the thread. They stay in the browser.
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launchedRef = useRef<number | null>(null);
  // Follows new steps unless the buyer has scrolled up to read something earlier.
  const followRef = useRef(true);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread && followRef.current) thread.scrollTop = thread.scrollHeight;
  }, [runs]);

  // A hidden tab has no height. Follow the latest reply when it becomes visible
  // or the mobile keyboard resizes the conversation, unless the buyer scrolled up.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const observer = new ResizeObserver(() => {
      if (followRef.current && thread.clientHeight > 0) thread.scrollTop = thread.scrollHeight;
    });
    observer.observe(thread);
    return () => observer.disconnect();
  }, []);

  const last = runs.at(-1);
  const activeRunId = last?.status === "running" ? last.id : null;
  const busy = sending || activeRunId !== null;

  useEffect(() => {
    const controller = new AbortController();
    fetchAgentStatus(controller.signal)
      .then(async (status) => {
        if (!status.available || !status.model) {
          setAgent({ status: "off" });
          return;
        }
        // After a page reload, pick up the latest conversation where it left off.
        const all = (await fetchAgentRuns(controller.signal)).filter((run) => run.agent.id === agentId);
        const latest = all[0]?.conversationId;
        setRuns(latest ? all.filter((run) => run.conversationId === latest).reverse() : []);
        setAgent({ status: "on", model: status.model });
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setAgent({ status: "error", message: caught instanceof Error ? caught.message : t("common.unknownError") });
        }
      });
    return () => controller.abort();
  }, [agentId]);

  // Follows the running run, step by step, until it finishes.
  useEffect(() => {
    if (!activeRunId) return;
    const controller = new AbortController();
    let seenSteps = 0;
    const timer = setInterval(() => {
      fetchAgentRun(activeRunId, controller.signal)
        .then((run) => {
          setRuns((current) => current.map((candidate) => (candidate.id === run.id ? run : candidate)));
          if (run.steps.length !== seenSteps || run.status !== "running") {
            seenSteps = run.steps.length;
            onActivityRef.current();
          }
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setError(caught instanceof Error ? caught.message : t("agent.runLoadFailed"));
          setRuns((current) =>
            current.map((candidate) =>
              candidate.id === activeRunId ? { ...candidate, status: "failed", error: t("agent.runLost") } : candidate,
            ),
          );
        });
    }, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [activeRunId]);

  async function send(text: string, photo?: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setSending(true);
    setError(null);
    try {
      const run = await startAgentRun(trimmed, last?.conversationId, agentId, language, photo ? "list_photo" : undefined);
      // A new request always jumps to the bottom of the thread.
      followRef.current = true;
      setRuns((current) => [...current, run]);
      // A photo leaves whatever the buyer was typing in the box.
      if (photo) setPhotos((current) => ({ ...current, [run.id]: photo }));
      else setMessage("");
      onActivityRef.current();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("agent.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  /** Stops the agent. If the run finished in the meantime, shows how it ended instead. */
  async function cancel(id: string) {
    try {
      const run = await cancelAgentRun(id);
      setRuns((current) => current.map((candidate) => (candidate.id === run.id ? run : candidate)));
      onActivityRef.current();
    } catch {
      const run = await fetchAgentRun(id).catch(() => undefined);
      if (run) setRuns((current) => current.map((candidate) => (candidate.id === run.id ? run : candidate)));
    }
    inputRef.current?.focus();
  }

  // Keep a handover pending until the restored conversation is ready and idle.
  useEffect(() => {
    if (launch && agent.status === "on" && !busy && launchedRef.current !== launch.at) {
      launchedRef.current = launch.at;
      setMessage(launch.message);
      onLaunched?.(launch.at);
      void send(launch.message);
    }
    // send reads the latest state on each render; the launch should fire only when these change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch, agent.status, busy]);

  return (
    <section aria-labelledby="agent-heading" className="agent">
      <div className="section-header agent-header">
        <h2 id="agent-heading">{agentName}</h2>
        {agent.status === "on" && <span className={`agent-status ${busy ? "agent-status-busy" : ""}`} role="status">{t(busy ? "agent.working" : "stat.idle")}</span>}
        {runs.length > 0 && !busy && (
          <button type="button" className="button-secondary button-small" onClick={() => {
            setRuns([]);
            setMessage("");
            setError(null);
            followRef.current = true;
            requestAnimationFrame(() => inputRef.current?.focus());
          }}>
            {t("agent.newConversation")}
          </button>
        )}
      </div>
      <div
        ref={threadRef}
        className="agent-thread"
        tabIndex={0}
        aria-label={t("agent.thread")}
        onScroll={(event) => {
          const thread = event.currentTarget;
          followRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
        }}
      >
        {agent.status === "loading" && <p className="section-muted" role="status">{t("agent.checking")}</p>}

        {agent.status === "error" && (
          <div role="alert" className="catalog-message catalog-message-error">
            <h3>{t("agent.unreachable")}</h3>
            <p className="catalog-message-detail">{agent.message}</p>
          </div>
        )}

        {agent.status === "off" && (
          <div className="agent-off">
            <h3>{t("agent.offTitle")}</h3>
            <p>{t("agent.offText")}</p>
          </div>
        )}

        {agent.status === "on" && (
          <>
            {runs.length === 0 && !busy && (
              <div className="agent-empty">
                <h3>{t("agent.emptyTitle")}</h3>
                <p>{t("agent.emptyHint")}</p>
                <div className="agent-example-chips" aria-label={t("agent.examples")}>
                  {(EXAMPLES[agentId] ?? []).map((example) => (
                    <button key={example.key} type="button" className="agent-example-chip" title={t(example.message)} onClick={() => {
                      setMessage(t(example.message));
                      inputRef.current?.focus({ preventScroll: true });
                    }}>
                      {t(example.title)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {runs.length > 0 && (
              <ol className="agent-runs">
                {runs.map((run) => (
                  <li key={run.id}>
                    <RunView run={run} latest={run.id === last?.id} onReviewApprovals={onReviewApprovals} photo={photos[run.id]} />
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div className="agent-composer-area">
        {error && (
          <p role="alert" className="agent-error">
            {error}
          </p>
        )}

        {!busy && suggestionsFor(last, t).length > 0 && (
          <div className="agent-suggestions" aria-label={t("agent.suggested")}>
            {suggestionsFor(last, t).map((suggestion) => (
              <button
                key={suggestion.message}
                type="button"
                className="agent-suggestion"
                onClick={() => {
                  if (!suggestion.fill) return void send(suggestion.message);
                  setMessage(suggestion.message);
                  inputRef.current?.focus();
                }}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        )}

        <RequestComposer
          inputRef={inputRef}
          value={message}
          onChange={setMessage}
          onSubmit={() => void send(message)}
          placeholder={runs.length === 0 ? t("agent.inputPlaceholder") : t("agent.replyPlaceholder")}
          disabled={agent.status !== "on"}
          busy={busy}
          onCancel={activeRunId ? () => void cancel(activeRunId) : undefined}
          inputActions={
            agent.status === "on" && (
              <>
                <ListPhotoInput onRead={(text, thumbnail) => void send(text, thumbnail)} disabled={busy} />
                <VoiceInput
                  draft={message}
                  onDraft={setMessage}
                  onDone={() => inputRef.current?.focus()}
                  onSend={(text) => void send(text)}
                  disabled={busy}
                />
              </>
            )
          }
        />
      </div>
    </section>
  );
}

function StepList({ steps }: { steps: AgentStep[] }) {
  const { t } = useI18n();
  return (
    <ol className="agent-steps" aria-label={t("agent.steps")}>
      {steps.map((step) => (
        <StepView key={step.index} step={step} />
      ))}
    </ol>
  );
}

/** One request and the agent's work. Completed runs fold their steps away so the thread stays short. */
function RunView({ run, latest, onReviewApprovals, photo }: { run: AgentRun; latest: boolean; onReviewApprovals?: () => void; photo?: string | undefined }) {
  const { t, tn } = useI18n();
  const calls = run.steps.filter((step) => step.kind === "tool_call");
  const refused = calls.filter((step) => step.kind === "tool_call" && !step.ok).length;
  return (
    <article className="agent-run" aria-label={t("agent.runLabel", { id: run.id })}>
      {run.kind === "list_photo" ? (
        <div className="agent-request agent-request-photo">
          <span className="agent-role">{t("agent.you")}</span>
          <span className="agent-photo-label">
            <ImageIcon size={16} aria-hidden="true" /> {t("agent.photoLabel")}
          </span>
          {photo && <img className="agent-photo" src={photo} alt={t("agent.photoAlt")} />}
          <span className="agent-photo-text">{run.request}</span>
        </div>
      ) : (
        <p className="agent-request">
          <span className="agent-role">{t("agent.you")}</span>
          {run.request}
        </p>
      )}

      <div className="agent-work">
        <p className="agent-role agent-role-agent">
          <span className="agent-avatar" aria-hidden="true">
            AI
          </span>
          {personName(run.agent.name)}
          {run.status === "running" && (
            <span className="agent-working">
              <span className="spinner" aria-hidden="true" /> {t("agent.workingInline")}
            </span>
          )}
        </p>
        {run.steps.length > 0 &&
          (run.status === "running" ? (
            <StepList steps={run.steps} />
          ) : (
            <details className="agent-steps-fold">
              <summary>
                {tn("agent.calls.one", calls.length)}
                {refused > 0 && <span className="agent-steps-refused"> · {t("agent.refused", { count: refused })}</span>}
              </summary>
              <StepList steps={run.steps} />
            </details>
          ))}
        {run.status === "running" && run.steps.length === 0 && <p className="section-muted">{t("agent.reading")}</p>}

        {run.status === "completed" && (
          <>
            {run.outcome && (
              <p className={`agent-outcome agent-outcome-${run.outcome}`}>
                {t(`agent.outcome.${run.outcome}`)}
                {run.quote && (
                  <>
                    {" "}
                    · {run.quote.id} · {formatEuroCents(run.quote.totalEurCents)}
                  </>
                )}
              </p>
            )}
            <p className="agent-reply">{run.reply}</p>
            {latest && run.outcome === "awaiting_approval" && onReviewApprovals && (
              <button type="button" className="button-secondary button-small agent-review" onClick={onReviewApprovals}>
                {t("dash.review")}
              </button>
            )}
          </>
        )}

        {run.status === "cancelled" && <p className="section-muted agent-cancelled">{t("agent.cancelled")}</p>}

        {run.status === "failed" && (
          <p role="alert" className="agent-error">
            {run.error}
          </p>
        )}
      </div>
    </article>
  );
}

function StepView({ step }: { step: AgentStep }) {
  const { t } = useI18n();
  if (step.kind === "message") {
    return <li className="agent-step agent-step-message">{step.text}</li>;
  }
  return (
    <li className={`agent-step ${step.ok ? "agent-step-ok" : "agent-step-refused"}`}>
      <span className="agent-step-tool">{step.tool}</span>
      <span className="agent-step-status">{step.httpStatus || t("agent.notSent")}</span>
      <span className="agent-step-http">
        {step.method} /api{step.path}
      </span>
      <span className="agent-step-summary">{localized(step.summary, step.summaryFi)}</span>
      {step.permission && <StepPermission permission={step.permission} />}
      {step.plan && (
        <span className="step-plan">
          <MenuPlanTable plan={step.plan} />
        </span>
      )}
    </li>
  );
}

const DECISIONS = ["within_limit", "needs_approval", "blocked", "created_by_buyer"];

const CHECK_ICONS: Record<string, string> = { passed: "✓", needs_approval: "!", blocked: "✕" };

/** The server's permission check inside a step, so the guardrails are visible as they happen. */
function StepPermission({ permission }: { permission: NonNullable<Extract<AgentStep, { kind: "tool_call" }>["permission"]> }) {
  const { t } = useI18n();
  return (
    <span className={`step-permission step-permission-${permission.decision}`}>
      <span className="step-permission-decision">{DECISIONS.includes(permission.decision) ? t(`decision.${permission.decision}` as MessageKey) : permission.decision}</span>
      {permission.checks.length > 0 && (
        <span className="step-permission-checks">
          {permission.checks.map((check) => (
            <span key={check.rule} className={`step-check step-check-${check.outcome}`} title={check.detail}>
              {CHECK_ICONS[check.outcome] ?? "·"} {t(`rule.${check.rule}`)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
