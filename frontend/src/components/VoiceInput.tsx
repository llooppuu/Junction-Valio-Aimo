import { LoaderCircle, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchVoiceStatus } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { endsWithSendPhrase, stripSendPhrase } from "../lib/sendPhrase";
import { dictationSupported, startDictation, type Dictation } from "../lib/voice";

type Phase = "idle" | "connecting" | "listening" | "finishing";

/** How long "thank you" must stay the last words before the request is sent, so "thank you for…" is not cut off. */
const SEND_PHRASE_PAUSE_MS = 700;

interface VoiceInputProps {
  /** The draft before the buyer started speaking; the transcript is added after it. */
  draft: string;
  onDraft: (text: string) => void;
  /** Called after the transcript is in the draft, so the buyer can read it and send. */
  onDone?: () => void;
  /** Sends the request when the buyer ends it with "thank you" or "kiitos". */
  onSend?: (text: string) => void;
  disabled?: boolean;
}

/**
 * The microphone button beside Send. Press it, say the request, and either
 * press it again to check the words before sending, or end with "thank you"
 * ("kiitos") to send at once. The words appear in the request box as they are
 * recognized. Hidden when the server has no Gemini key or the browser cannot
 * capture audio.
 */
export function VoiceInput({ draft, onDraft, onDone, onSend, disabled = false }: VoiceInputProps) {
  const { t, language } = useI18n();
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const base = useRef("");
  const sendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest send handler, since the timer that calls it was set during an earlier render.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  useEffect(() => {
    if (!dictationSupported()) return;
    const controller = new AbortController();
    fetchVoiceStatus(controller.signal)
      .then((status) => setAvailable(status.available))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, []);

  // A notice clears itself, so it does not sit over the request box.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Leaving the page stops the microphone.
  useEffect(
    () => () => {
      clearTimeout(sendTimer.current);
      dictation.current?.cancel();
    },
    [],
  );

  if (!available) return null;

  const join = (text: string) => [base.current.trimEnd(), text].filter(Boolean).join(" ");

  async function start() {
    setError(null);
    base.current = draft;
    setPhase("connecting");
    let heard = "";
    try {
      dictation.current = await startDictation({
        language,
        onTranscript: (text) => {
          // Gemini repeats the same words while the buyer is silent; only new words count.
          if (text === heard) return;
          heard = text;
          onDraft(join(text));
          // "Thank you" at the end sends the request, once no more words follow it.
          clearTimeout(sendTimer.current);
          if (onSendRef.current && endsWithSendPhrase(text)) sendTimer.current = setTimeout(() => void stop(true), SEND_PHRASE_PAUSE_MS);
        },
        onError: (caught) => {
          dictation.current = null;
          setPhase("idle");
          console.warn("Voice input stopped:", caught.message);
          setError(t("voice.failed"));
        },
      });
      setPhase("listening");
    } catch (caught) {
      dictation.current = null;
      setPhase("idle");
      const denied = caught instanceof DOMException && (caught.name === "NotAllowedError" || caught.name === "SecurityError");
      setError(denied ? t("voice.denied") : t("voice.failed"));
    }
  }

  /** Stops listening. With `send`, the buyer said "thank you": the request goes without the phrase. */
  async function stop(send = false) {
    clearTimeout(sendTimer.current);
    const current = dictation.current;
    if (!current) return;
    dictation.current = null;
    setPhase("finishing");
    const text = await current.stop();
    const request = send ? stripSendPhrase(text) : text;
    setPhase("idle");
    if (!request) {
      if (send) onDraft(base.current);
      setError(t("voice.nothingHeard"));
      onDone?.();
      return;
    }
    const full = join(request);
    onDraft(full);
    if (send && onSendRef.current) onSendRef.current(full);
    else onDone?.();
  }

  const listening = phase === "listening";
  const label =
    phase === "connecting" ? t("voice.connecting") : phase === "finishing" ? t("voice.finishing") : listening ? t("voice.stop") : t("voice.start");

  return (
    <>
      <button
        type="button"
        className={`button-secondary button-icon voice-input${listening ? " is-listening" : ""}`}
        aria-pressed={listening}
        title={listening ? t("voice.stopHint") : t("voice.startHint")}
        disabled={disabled || phase === "connecting" || phase === "finishing"}
        onClick={() => void (listening ? stop() : start())}
      >
        {phase === "connecting" || phase === "finishing" ? (
          <LoaderCircle size={18} aria-hidden="true" className="voice-input-spinner" />
        ) : listening ? (
          <Square size={16} aria-hidden="true" />
        ) : (
          <Mic size={18} aria-hidden="true" />
        )}
        <span className="voice-input-label">{label}</span>
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {listening ? t("voice.listening") : ""}
      </span>
      {error && (
        <span className="voice-input-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
