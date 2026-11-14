import { ImagePlus, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchIntakeStatus, readListPhoto } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** The longest side the photo is scaled to before upload: enough to read handwriting, small enough to send quickly. */
const MAX_SIDE = 1600;
/** The longest side of the copy shown in the conversation. */
const THUMBNAIL_SIDE = 480;

interface ListPhotoInputProps {
  /** Called with the list as read, and a small copy of the photo for the conversation. */
  onRead: (text: string, thumbnail: string) => void;
  disabled?: boolean;
}

/** Draws the image at most maxSide pixels on its longest side and encodes it as a JPEG data URL. */
function encode(bitmap: ImageBitmap, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  // A white background, so a transparent screenshot does not turn black in the JPEG.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** The photo scaled down for reading, and a smaller copy for the conversation. */
async function prepare(file: File): Promise<{ upload: string; thumbnail: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { upload: encode(bitmap, MAX_SIDE, 0.85), thumbnail: encode(bitmap, THUMBNAIL_SIDE, 0.75) };
  } finally {
    bitmap.close();
  }
}

/**
 * The photo button beside the microphone. A photo or screenshot of a
 * purchasing list, chosen, taken with the phone's camera, or pasted into the
 * page, is read and handed straight to the agent, which restates the list and
 * asks the buyer to confirm it before doing anything. Hidden when the server
 * has no model that reads images.
 */
export function ListPhotoInput({ onRead, disabled = false }: ListPhotoInputProps) {
  const { t, language } = useI18n();
  const [available, setAvailable] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The latest values for the paste listener, which is attached once.
  const latest = useRef({ onRead, disabled, reading, language });
  latest.current = { onRead, disabled, reading, language };

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
      const { upload, thumbnail } = await prepare(file);
      const text = await readListPhoto(upload, latest.current.language);
      latest.current.onRead(text, thumbnail);
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
