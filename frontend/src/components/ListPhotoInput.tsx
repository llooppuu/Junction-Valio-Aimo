import { ImagePlus, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchIntakeStatus, readListPhoto } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** The longest side the photo is scaled to before upload: enough to read handwriting, small enough to send quickly. */
const MAX_SIDE = 1600;

interface ListPhotoInputProps {
  /** The draft so far; the list is added after it. */
  draft: string;
  onDraft: (text: string) => void;
  /** Called after the list is in the draft, so the buyer can read it and send. */
  onDone?: () => void;
  disabled?: boolean;
}

/** Scales an image file down and encodes it as a JPEG data URL. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  // A white background, so a transparent screenshot does not turn black in the JPEG.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * The photo button beside the microphone. A photo or screenshot of a
 * purchasing list, chosen, taken with the phone's camera, or pasted into the
 * page, is read into the request box for the buyer to check and send. Hidden
 * when the server has no model that reads images.
 */
export function ListPhotoInput({ draft, onDraft, onDone, disabled = false }: ListPhotoInputProps) {
  const { t, language } = useI18n();
  const [available, setAvailable] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The latest values for the paste listener, which is attached once.
  const latest = useRef({ draft, disabled, reading, language });
  latest.current = { draft, disabled, reading, language };

  useEffect(() => {
    const controller = new AbortController();
    fetchIntakeStatus(controller.signal)
      .then((status) => setAvailable(status.available))
      .catch(() => setAvailable(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  async function read(file: File) {
    if (latest.current.disabled || latest.current.reading) return;
    setError(null);
    setReading(true);
    try {
      const text = await readListPhoto(await shrink(file), latest.current.language);
      const before = latest.current.draft.trimEnd();
      onDraft(before ? `${before}\n${text}` : text);
      onDone?.();
    } catch (caught) {
      const notAList = caught instanceof Error && /not look like a purchasing list/.test(caught.message);
      setError(notAList ? t("photo.notAList") : t("photo.failed"));
    } finally {
      setReading(false);
    }
  }

  // A screenshot pasted anywhere on the page is read like a chosen photo; text pastes are left alone.
  useEffect(() => {
    if (!available) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((candidate) => candidate.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void read(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // read uses refs for everything that changes, so the listener is attached once.
  }, [available]);

  if (!available) return null;

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void read(file);
        }}
      />
      <button
        type="button"
        className="button-secondary button-icon list-photo-input"
        title={t("photo.hint")}
        disabled={disabled || reading}
        onClick={() => fileInput.current?.click()}
      >
        {reading ? <LoaderCircle size={18} aria-hidden="true" className="voice-input-spinner" /> : <ImagePlus size={18} aria-hidden="true" />}
        <span className="voice-input-label">{reading ? t("photo.reading") : t("photo.button")}</span>
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {reading ? t("photo.reading") : ""}
      </span>
      {error && (
        <span className="voice-input-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
