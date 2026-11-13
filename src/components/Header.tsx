import { useEffect, useId, useState } from 'react';
import { Bot, Building2, Menu, ShoppingBasket, X } from 'lucide-react';
import { hrefFor, type Route } from '../lib/router.ts';
import { useLang, type Lang } from '../lib/i18n.ts';
import { requestComposerFocus } from '../lib/composer.ts';
import '../styles/header.css';

interface HeaderProps {
  route: Route;
}

const NAV_ITEMS = ['dashboard', 'workspace', 'catalog', 'orders', 'activity'] as const satisfies readonly Route[];

const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'fi', label: 'FI', name: 'Suomi' },
];

export default function Header({ route }: HeaderProps) {
  const { lang, setLang, t } = useLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const isWholesaler = route === 'wholesaler';

  // Close the phone menu when the view changes or Escape is pressed.
  useEffect(() => setMenuOpen(false), [route]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const askAgent = () => requestComposerFocus();

  return (
    <div className="masthead">
      <a className="skip-link" href="#main">
        {t.skipToContent}
      </a>

      <div className="topbar">
        <div className="container topbar__inner">
          <nav className="topbar__tabs" aria-label={t.workspaceSwitcher}>
            <a
              className="topbar__tab"
              href={hrefFor('dashboard')}
              aria-current={!isWholesaler ? 'page' : undefined}
            >
              <ShoppingBasket size={16} aria-hidden="true" />
              {t.deskTab}
            </a>
            <a
              className="topbar__tab"
              href={hrefFor('wholesaler')}
              aria-current={isWholesaler ? 'page' : undefined}
            >
              <Building2 size={16} aria-hidden="true" />
              {t.wholesalerTab}
            </a>
          </nav>

          <div className="lang-toggle" role="group" aria-label={t.language}>
            {LANGS.map((item) => (
              <button
                key={item.code}
                type="button"
                className="lang-toggle__btn"
                aria-pressed={lang === item.code}
                aria-label={item.name}
                onClick={() => setLang(item.code)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <header className="site-header">
        <div className="container site-header__inner">
          <a className="brand" href={hrefFor('dashboard')}>
            <span className="brand__name">{t.brand}</span>
            <span className="brand__sub">{t.brandSub}</span>
          </a>

          <nav className="main-nav" aria-label={t.mainNav}>
            <ul className="main-nav__list" role="list">
              {NAV_ITEMS.map((item) => (
                <li key={item}>
                  <a
                    className="main-nav__link"
                    href={hrefFor(item)}
                    aria-current={route === item ? 'page' : undefined}
                  >
                    {t[item]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="site-header__actions">
            <div className="user-chip">
              <span className="user-chip__avatar" aria-hidden="true">
                HC
              </span>
              <span className="user-chip__name">
                <span className="visually-hidden">{t.signedInAs} </span>
                {t.headChef}
              </span>
            </div>
            <a className="btn btn--accent site-header__ask" href={hrefFor('workspace')} onClick={askAgent}>
              <Bot size={18} aria-hidden="true" />
              {t.askAgent}
            </a>
            <button
              type="button"
              className="menu-toggle"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? t.closeMenu : t.openMenu}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div id={menuId} className="mobile-menu" hidden={!menuOpen}>
          <nav className="container" aria-label={t.mainNav}>
            <ul className="mobile-menu__list" role="list">
              {NAV_ITEMS.map((item) => (
                <li key={item}>
                  <a
                    className="mobile-menu__link"
                    href={hrefFor(item)}
                    aria-current={route === item ? 'page' : undefined}
                  >
                    {t[item]}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mobile-menu__footer">
              <div className="user-chip">
                <span className="user-chip__avatar" aria-hidden="true">
                  HC
                </span>
                <span className="user-chip__name">
                  <span className="visually-hidden">{t.signedInAs} </span>
                  {t.headChef}
                </span>
              </div>
              <a className="btn btn--accent mobile-menu__ask" href={hrefFor('workspace')} onClick={askAgent}>
                <Bot size={18} aria-hidden="true" />
                {t.askAgent}
              </a>
            </div>
          </nav>
        </div>
      </header>
    </div>
  );
}
