import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LANGUAGES, useI18n, type Language } from "../lib/i18n";

// Keep the same order as the Valio Aimo language menu.
const OPTIONS = ["fi", "en"] as const;

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const choose = (next: Language) => {
    setLanguage(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const current = items.current.findIndex((item) => item === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? OPTIONS.length - 1
        : event.key === "ArrowDown" ? (current + 1) % OPTIONS.length
        : (current < 0 ? OPTIONS.length - 1 : (current + OPTIONS.length - 1) % OPTIONS.length);
      setOpen(true);
      // The menu remains mounted so keyboard focus works as soon as it opens.
      requestAnimationFrame(() => items.current[next]?.focus());
    }
  };

  return (
    <div
      className="language-switch"
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="language-trigger"
        aria-label={`${t("top.language")}: ${language.toUpperCase()}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="language-menu"
        onClick={() => {
          setOpen(!open);
          if (!open) requestAnimationFrame(() => items.current[0]?.focus());
        }}
      >
        {language.toUpperCase()}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <ul id="language-menu" className="language-menu" role="menu" aria-label={t("top.language")} hidden={!open}>
        {OPTIONS.map((code, index) => (
          <li role="none" key={code}>
            <button
              ref={(element) => { items.current[index] = element; }}
              type="button"
              role="menuitemradio"
              aria-checked={language === code}
              className="language-option"
              lang={code}
              title={LANGUAGES.find((option) => option.code === code)?.name}
              tabIndex={open ? 0 : -1}
              onClick={() => choose(code)}
            >
              {code.toUpperCase()}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
