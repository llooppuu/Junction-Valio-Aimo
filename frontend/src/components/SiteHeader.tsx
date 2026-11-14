import { Bot, Building2, Menu, ShoppingBasket, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { LANGUAGES, useI18n } from "../lib/i18n";
import { BUYER_VIEWS, VIEW_NAMES, type View } from "../lib/views";

interface SiteHeaderProps {
  view: View;
  onSelect: (view: View) => void;
  /** Counts shown next to a view, such as quotes waiting for approval. */
  badges: Partial<Record<View, { count: number; attention?: boolean }>>;
}

/**
 * A service bar with the buyer's and the wholesaler's sides and the language,
 * then the main bar with the buyer's views and the call to action.
 */
export function SiteHeader({ view, onSelect, badges }: SiteHeaderProps) {
  const { t, language, setLanguage } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const wholesaler = view === "wholesaler";

  // The menu closes whenever the view changes, so it never covers the page that just opened.
  useEffect(() => setMenuOpen(false), [view]);

  const go = (next: View) => (event: MouseEvent) => {
    event.preventDefault();
    onSelect(next);
  };

  return (
    <header className="site-header">
      <div className="topbar">
        <div className="container topbar-inner">
          <nav className="topbar-tabs" aria-label={t("top.services")}>
            <a href="#dashboard" className={`topbar-tab ${wholesaler ? "" : "topbar-tab-on"}`} aria-current={wholesaler ? undefined : "true"} onClick={go("dashboard")}>
              <ShoppingBasket aria-hidden="true" size={16} />
              {t("top.purchasing")}
            </a>
            <a href="#wholesaler" className={`topbar-tab ${wholesaler ? "topbar-tab-on" : ""}`} aria-current={wholesaler ? "true" : undefined} onClick={go("wholesaler")}>
              <Building2 aria-hidden="true" size={16} />
              {t("top.wholesaler")}
            </a>
          </nav>
          <div className="language-switch" role="group" aria-label={t("top.language")}>
            {LANGUAGES.map((option) => (
              <button
                key={option.code}
                type="button"
                lang={option.code}
                title={option.name}
                aria-pressed={language === option.code}
                className={`language-option ${language === option.code ? "language-option-on" : ""}`}
                onClick={() => setLanguage(option.code)}
              >
                {option.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mainbar">
        <div className="container mainbar-inner">
          <a href="#dashboard" className="wordmark" onClick={go("dashboard")}>
            <span className="wordmark-name">Trusted Trade Agents</span>
            <span className="wordmark-tagline">{t("brand.tagline")}</span>
          </a>

          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
            {t("nav.menu")}
          </button>

          <nav id="main-nav" className={`mainnav ${menuOpen ? "mainnav-open" : ""}`} aria-label={t("nav.label")}>
            <ul>
              {BUYER_VIEWS.map((item) => {
                const badge = badges[item];
                return (
                  <li key={item}>
                    <a
                      href={`#${item}`}
                      className={`mainnav-link ${view === item ? "mainnav-link-on" : ""}`}
                      aria-current={view === item ? "page" : undefined}
                      onClick={go(item)}
                    >
                      {t(VIEW_NAMES[item])}
                      {badge && badge.count > 0 && (
                        <span
                          className={`nav-badge ${badge.attention ? "nav-badge-attention" : ""}`}
                          aria-label={t(item === "workspace" ? "nav.badgeWaiting" : "nav.badgeOrders", { count: badge.count })}
                        >
                          {badge.count}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mainbar-actions">
            <span className="user-chip" title={t("user.role")}>
              <span className="user-avatar" aria-hidden="true">
                {language === "fi" ? "KP" : "HC"}
              </span>
              <span className="user-chip-text">
                <span className="user-name">{t("user.name")}</span>
                <span className="user-role">{t("user.role")}</span>
              </span>
            </span>
            <button type="button" className="button-cta button-icon" onClick={() => onSelect("workspace")}>
              <Bot aria-hidden="true" size={18} />
              {t("header.cta")}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
