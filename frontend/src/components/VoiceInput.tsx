import { LoaderCircle, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchVoiceStatus } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { dictationSupported, startDictation, type Dictation } from "../lib/voice";

type Phase = "idle" | "connecting" | "listening" | "finishing";

interface VoiceInputProps {
  /** The draft before the buyer started speaking; the transcript is added after it. */
  draft: string;
  onDraft: (text: string) => void;
  /** Called after the transcript is in the draft, so the buyer can read it and send. */
  onDone?: () => void;
  disabled?: boolean;
}

/**
 * The microphone button beside Send. Press it, say the request, press it again:
 * the words appear in the request box as they are recognized, for the buyer to
 * check and send. Hidden when the server has no Gemini key or the browser
 * cannot capture audio.
 */
export function VoiceInput({ draft, onDraft, onDone, disabled = false }: VoiceInputProps) {
  const { t, language } = useI18n();
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const base = useRef("");

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
  useEffect(() => () => dictation.current?.cancel(), []);

  if (!available) return null;

  const join = (text: string) => [base.current.trimEnd(), text].filter(Boolean).join(" ");

  async function start() {
    setError(null);
    base.current = draft;
    setPhase("connecting");
    try {
      dictation.current = await startDictation({
        language,
        onTranscript: (text) => onDraft(join(text)),
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

  async function stop() {
    const current = dictation.current;
    if (!current) return;
    setPhase("finishing");
    const text = await current.stop();
    dictation.current = null;
    if (text) onDraft(join(text));
    else setError(t("voice.nothingHeard"));
    setPhase("idle");
    onDone?.();
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
