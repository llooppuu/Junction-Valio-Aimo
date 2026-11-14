import { Bot, Building2, ChartNoAxesCombined, Menu, Package, Search, ShoppingBasket, Store, Truck, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useI18n } from "../lib/i18n";
import { BUYER_VIEWS, VIEW_NAMES, type View } from "../lib/views";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { BrandLogo, BrandMark } from "./BrandLogo";
import { MobileNavigation } from "./MobileNavigation";

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
  const { t, language } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wholesaler = view === "wholesaler";

  // The menu closes whenever the view changes, so it never covers the page that just opened.
  useEffect(() => setMenuOpen(false), [view]);

  useEffect(() => {
    if (!menuOpen) return;
    const breakpoint = window.matchMedia("(max-width: 60rem)");
    const closeOnDesktop = () => { if (!breakpoint.matches) setMenuOpen(false); };
    closeOnDesktop();
    breakpoint.addEventListener("change", closeOnDesktop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const siblings = Array.from(header.current?.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== header.current);
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButton.current?.focus();
      }
      if (event.key === "Tab") {
        const controls = Array.from(header.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), [tabindex='0']") ?? [])
          .filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      breakpoint.removeEventListener("change", closeOnDesktop);
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = previousOverflow;
      siblings.forEach((element, index) => { element.inert = previousInert[index] ?? false; });
    };
  }, [menuOpen]);

  const select = (next: View) => {
    setMenuOpen(false);
    onSelect(next);
  };

  const go = (next: View) => (event: MouseEvent) => {
    event.preventDefault();
    select(next);
  };

  return (
    <header className={`site-header ${menuOpen ? "site-header-menu-open" : ""}`} ref={header}>
      <div className="topbar">
        <div className="container topbar-inner">
          <nav className="topbar-tabs desktop-services" aria-label={t("top.services")}>
            <a href="#dashboard" className={`topbar-tab ${wholesaler ? "" : "topbar-tab-on"}`} aria-current={wholesaler ? undefined : "true"} onClick={go("dashboard")}>
              <ShoppingBasket aria-hidden="true" size={16} />
              {t("top.purchasing")}
            </a>
            <a href="#wholesaler" className={`topbar-tab ${wholesaler ? "topbar-tab-on" : ""}`} aria-current={wholesaler ? "true" : undefined} onClick={go("wholesaler")}>
              <Building2 aria-hidden="true" size={16} />
              {t("top.wholesaler")}
            </a>
          </nav>
          <nav className="mobile-services" aria-label={t("top.services")}>
            <a href="#dashboard" className="mobile-service-home" onClick={go("dashboard")}>
              <BrandMark />
              <span>Valioaimo.fi</span>
            </a>
            <a className="mobile-service-icon" href={`https://pikatukku.valioaimo.fi/${language === "en" ? "en" : ""}`} aria-label="Cash & Carry" title="Cash & Carry"><Store aria-hidden="true" /></a>
            <a className="mobile-service-icon" href={`https://toimitustukku.valioaimo.fi/${language === "en" ? "en" : ""}`} aria-label={t("top.delivery")} title={t("top.delivery")}><Truck aria-hidden="true" /></a>
            <a className="mobile-service-icon" href={`https://valotilaus.fi/${language === "en" ? "en/all/" : ""}`} aria-label="VALO Tilauspalvelu" title="VALO Tilauspalvelu"><Package aria-hidden="true" /></a>
            <a className="mobile-service-icon" href={`https://minunaimo.valioaimo.fi/${language === "en" ? "en" : ""}`} aria-label={t("top.myAimo")} title={t("top.myAimo")}><ChartNoAxesCombined aria-hidden="true" /></a>
          </nav>
          <LanguageSwitcher />
        </div>
      </div>

      <div className="mainbar">
        <div className="container mainbar-inner">
          <a href="#dashboard" className="wordmark" onClick={go("dashboard")}>
            <BrandLogo />
            <span className="wordmark-tagline">{t("brand.tagline")}</span>
          </a>

          <button
            ref={menuButton}
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={t(menuOpen ? "nav.closeMenu" : "nav.menu")}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" size={32} strokeWidth={1.5} /> : <Menu aria-hidden="true" size={32} strokeWidth={1.5} />}
          </button>

          <nav id="main-nav" className="mainnav" aria-label={t("nav.label")}>
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

          <button type="button" className="mobile-search" aria-label={t("catalog.search")} onClick={() => {
            select("catalog");
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#view-catalog input[type="search"]')?.focus({ preventScroll: true }));
          }}>
            <Search aria-hidden="true" size={32} strokeWidth={1.5} />
          </button>

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
            <button type="button" className="button-cta button-icon" onClick={() => select("workspace")}>
              <Bot aria-hidden="true" size={18} />
              {t("header.cta")}
            </button>
          </div>
        </div>
      </div>
      <MobileNavigation open={menuOpen} view={view} onSelect={select} badges={badges} />
    </header>
  );
}
