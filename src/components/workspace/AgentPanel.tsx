import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Bot } from 'lucide-react';
import { Panel } from '../ui/Card.tsx';
import Badge from '../ui/Badge.tsx';
import { planAgentRun, type RunPlan } from '../../lib/agent-sim.ts';
import { onComposerFocusRequest, takePendingComposerRequest } from '../../lib/composer.ts';
import { useDemoState } from '../../lib/demo-state.tsx';
import { AGENT_MODEL, examplePrompts } from '../../data/mock.ts';
import type { Kitchen } from '../../lib/types.ts';

const STEP_DELAY_MS = 450;

interface RunView {
  request: string;
  plan: RunPlan;
  shown: number;
}

interface AgentPanelProps {
  kitchen: Kitchen;
  onRunningChange: (running: boolean) => void;
}

export default function AgentPanel({ kitchen, onRunningChange }: AgentPanelProps) {
  const { alerts, revokedMandates, nextQuoteId, nextOrderId, completeRun } = useDemoState();
  const [selected, setSelected] = useState(0);
  const [text, setText] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const completedRef = useRef(false);

  const running = run !== null && run.shown < run.plan.steps.length;
  const placeholder = examplePrompts[selected]?.text ?? '';

  // Put the cursor in the request box when an "Ask the agent" button asks for it.
  useEffect(() => {
    const focusComposer = () => {
      const request = takePendingComposerRequest();
      if (!request) return;
      if (request.text) setText(request.text);
      window.setTimeout(() => {
        textareaRef.current?.scrollIntoView({ block: 'center' });
        textareaRef.current?.focus({ preventScroll: true });
      }, 60);
    };
    focusComposer();
    return onComposerFocusRequest(focusComposer);
  }, []);

  // Reveal the run's API calls one at a time, then record the run.
  useEffect(() => {
    if (!run) return;
    if (run.shown < run.plan.steps.length) {
      const timer = window.setTimeout(
        () => setRun((current) => (current ? { ...current, shown: current.shown + 1 } : current)),
        STEP_DELAY_MS,
      );
      return () => window.clearTimeout(timer);
    }
    if (!completedRef.current) {
      completedRef.current = true;
      completeRun(kitchen.id, run.request, run.plan);
    }
    return undefined;
  }, [run, kitchen.id, completeRun]);

  useEffect(() => onRunningChange(running), [running, onRunningChange]);

  // A different kitchen means a different agent: clear its run.
  useEffect(() => {
    setRun(null);
  }, [kitchen.id]);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const request = text.trim();
    if (!request || running) return;
    const plan = planAgentRun({
      kitchen,
      request,
      mandateRevoked: revokedMandates.includes(kitchen.id),
      alerts,
      nextQuoteId,
      nextOrderId,
    });
    completedRef.current = false;
    setRun({ request, plan, shown: 0 });
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) send(event);
  };

  const chooseExample = (index: number) => {
    setSelected(index);
    setText(examplePrompts[index]?.text ?? '');
    textareaRef.current?.focus();
  };

  return (
    <Panel
      className="agent-panel"
      title={
        <>
          {kitchen.agentName} <Badge tone="soft">{AGENT_MODEL}</Badge>
        </>
      }
    >
      <p className="agent-panel__intro">
        Tell the agent what you need. It works through the wholesaler's API with its own credentials, so the server
        checks every price, its spending limit, and your approvals. Each step below is a real API call.
      </p>

      <ul className="examples" role="list" aria-label="Example requests">
        {examplePrompts.map((example, index) => (
          <li key={example.eyebrow}>
            <button
              type="button"
              className="example"
              aria-pressed={index === selected}
              onClick={() => chooseExample(index)}
            >
              <span className="example__eyebrow">{example.eyebrow}</span>
              <span className="example__text">“{example.text}”</span>
              <span className="example__hint">{example.hint}</span>
            </button>
          </li>
        ))}
      </ul>

      <form className="composer" onSubmit={send}>
        <label htmlFor="agent-request" className="visually-hidden">
          Request for the {kitchen.agentName.toLowerCase()}
        </label>
        <textarea
          id="agent-request"
          ref={textareaRef}
          className="composer__input"
          rows={2}
          value={text}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="btn btn--primary composer__send" disabled={!text.trim() || running}>
          Send
        </button>
      </form>

      {run && (
        <section className="run" aria-label="Agent run" aria-live="polite">
          <p className="run__request">
            <span className="run__label">Request</span> “{run.request}”
          </p>
          <ol className="run__steps">
            {run.plan.steps.slice(0, run.shown).map((step, index) => (
              <li key={`${step.path}-${index}`} className="run-step">
                <span className="run-step__index" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="run-step__body">
                  <code className="run-step__call">
                    <span className="run-step__method">{step.method}</span> {step.path}
                    <span className={`run-step__status ${step.status >= 400 ? 'is-error' : ''}`}>{step.status}</span>
                  </code>
                  <p className="run-step__summary">{step.summary}</p>
                </div>
              </li>
            ))}
          </ol>
          {running ? (
            <p className="run__working">The agent is working…</p>
          ) : (
            <div className="run__reply">
              <Bot size={18} aria-hidden="true" />
              <p>{run.plan.reply}</p>
            </div>
          )}
        </section>
      )}
    </Panel>
  );
}
