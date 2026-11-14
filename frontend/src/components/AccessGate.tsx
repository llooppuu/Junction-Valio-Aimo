import { KeyRound } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { fetchSession } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { BrandLogo } from "./BrandLogo";
import { LanguageSwitcher } from "./LanguageSwitcher";

type GateState = "checking" | "open" | "locked";

/**
 * The hosted demo opens only from its access link, /login?key=…. A browser
 * without the session cookie sees this screen instead of the app, where the
 * key can also be pasted. In development the Vite proxy signs every request
 * in, so the screen never shows.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<GateState>("checking");
  const [key, setKey] = useState("");
  const denied = new URLSearchParams(window.location.search).get("access") === "denied";

  useEffect(() => {
    fetchSession()
      .then((session) => setState(session.authenticated ? "open" : "locked"))
      // If the check itself fails, the app shows its own errors rather than a misleading sign-in screen.
      .catch(() => setState("open"));
  }, []);

  if (state === "checking") return null;
  if (state === "open") return <>{children}</>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (key.trim()) window.location.href = `/login?key=${encodeURIComponent(key.trim())}`;
  };

  return (
    <main className="access-gate">
      <div className="access-gate-top">
        <BrandLogo />
        <div className="access-gate-language">
          <LanguageSwitcher />
        </div>
      </div>
      <form className="access-gate-card" onSubmit={submit}>
        <KeyRound size={28} aria-hidden="true" className="access-gate-icon" />
        <h1>{t("access.title")}</h1>
        <p>{t("access.intro")}</p>
        {denied && (
          <p className="agent-error" role="alert">
            {t("access.denied")}
          </p>
        )}
        <label htmlFor="access-key">{t("access.keyLabel")}</label>
        <input id="access-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} />
        <button type="submit" className="button-cta" disabled={!key.trim()}>
          {t("access.open")}
        </button>
      </form>
    </main>
  );
}
