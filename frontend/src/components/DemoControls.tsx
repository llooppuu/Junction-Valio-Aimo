import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { resetDemo } from "../lib/api";
import { useI18n } from "../lib/i18n";

/**
 * Starting over clears quotes, orders, alerts, and agent runs. It needs the
 * buyer role, so an agent can never use it. Prices and stock come from Valio
 * Aimo and cannot be set here.
 */
export function DemoControls({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  async function startOver() {
    setBusy(true);
    try {
      await resetDemo();
      setNotice({ text: t("demo.resetDone") });
      onReset();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : t("demo.failed"), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="demo-heading" className="demo-controls">
      <div className="section-header">
        <h2 id="demo-heading">{t("demo.title")}</h2>
      </div>
      <p className="section-muted demo-intro">{t("demo.intro")}</p>
      <div className="demo-actions">
        <button type="button" className="button-secondary button-icon button-danger" disabled={busy} onClick={() => void startOver()}>
          <RotateCcw aria-hidden="true" size={16} />
          {t("demo.reset")}
        </button>
      </div>
      {notice && (
        <p role={notice.error ? "alert" : "status"} className={notice.error ? "agent-error" : "approval-notice demo-notice"}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
