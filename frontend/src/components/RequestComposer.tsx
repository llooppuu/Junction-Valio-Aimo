import { ArrowUp, Square } from "lucide-react";
import type { FormEvent, ReactNode, Ref } from "react";
import { useI18n } from "../lib/i18n";

interface RequestComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Future input methods can update the controlled draft before the buyer sends it. */
  inputActions?: ReactNode;
  /** While busy, replaces Send with a Cancel button that stops the work in progress. */
  onCancel?: () => void;
}

/** A shared draft and explicit send action for typed requests and future speech transcripts. */
export function RequestComposer({ value, onChange, onSubmit, placeholder, disabled = false, busy = false, inputRef, inputActions, onCancel }: RequestComposerProps) {
  const { t } = useI18n();
  const blocked = disabled || busy;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!blocked && value.trim()) onSubmit();
  };

  return (
    <form className="agent-form request-composer" onSubmit={submit} aria-busy={busy}>
      <label htmlFor="agent-message" className="visually-hidden">{t("agent.yourRequest")}</label>
      <textarea
        ref={inputRef}
        id="agent-message"
        className="request-composer-input"
        rows={2}
        maxLength={2000}
        placeholder={placeholder}
        value={value}
        disabled={blocked}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!blocked && value.trim()) onSubmit();
          }
        }}
      />
      <div className="request-composer-actions">
        {inputActions}
        {busy && onCancel ? (
          <button type="button" className="button-secondary button-icon request-send request-cancel" onClick={onCancel} title={t("agent.cancelHint")}>
            <Square size={16} aria-hidden="true" />
            {t("agent.cancel")}
          </button>
        ) : (
          <button type="submit" className="button-cta button-icon request-send" disabled={blocked || !value.trim()}>
            {busy ? t("agent.working") : t("agent.send")}
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}
