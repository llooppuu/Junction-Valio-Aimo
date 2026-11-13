import { ChevronRight } from 'lucide-react';
import { hrefFor, type Route } from '../lib/router.ts';
import { useLang, type ShellStrings } from '../lib/i18n.ts';
import '../styles/footer.css';

interface FooterColumn {
  heading: keyof ShellStrings;
  links: { route: Route; label: keyof ShellStrings }[];
}

const COLUMNS: FooterColumn[] = [
  {
    heading: 'footerPurchasing',
    links: [
      { route: 'dashboard', label: 'dashboard' },
      { route: 'workspace', label: 'workspace' },
      { route: 'catalog', label: 'catalog' },
    ],
  },
  {
    heading: 'footerRecords',
    links: [
      { route: 'orders', label: 'orders' },
      { route: 'activity', label: 'activity' },
    ],
  },
  {
    heading: 'footerWholesaler',
    links: [{ route: 'wholesaler', label: 'wholesalerView' }],
  },
];

export default function Footer() {
  const { t } = useLang();

  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__brand">
          <p className="site-footer__name">{t.brand}</p>
          <p className="site-footer__tagline">{t.footerTagline}</p>
        </div>

        {COLUMNS.map((column) => (
          <nav key={column.heading} className="site-footer__col" aria-labelledby={`footer-${column.heading}`}>
            <h2 id={`footer-${column.heading}`} className="site-footer__heading">
              {t[column.heading]}
            </h2>
            <ul className="site-footer__links" role="list">
              {column.links.map((link) => (
                <li key={link.route}>
                  <a className="site-footer__link" href={hrefFor(link.route)}>
                    <ChevronRight size={14} aria-hidden="true" />
                    {t[link.label]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
