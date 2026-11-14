import { ChevronRight } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { MessageKey } from "../lib/messages";
import { VIEW_NAMES, type View } from "../lib/views";
import { BrandLogo } from "./BrandLogo";

const GROUPS: { title: MessageKey; views: View[] }[] = [
  { title: "footer.purchasing", views: ["dashboard", "workspace", "catalog"] },
  { title: "footer.records", views: ["orders", "activity"] },
  { title: "footer.wholesaler", views: ["wholesaler"] },
];

/** The site's links again at the foot of every page. */
export function SiteFooter({ onSelect }: { onSelect: (view: View) => void }) {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="site-footer-brand">
          <BrandLogo className="brand-logo footer-logo" />
          <p className="wordmark-name">Trusted Trade Agents</p>
          <p className="site-footer-tagline">{t("footer.tagline")}</p>
        </div>
        {GROUPS.map((group) => (
          <nav key={group.title} className="site-footer-group" aria-label={t(group.title)}>
            <p className="site-footer-title">{t(group.title)}</p>
            <ul>
              {group.views.map((view) => (
                <li key={view}>
                  <a
                    href={`#${view}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onSelect(view);
                    }}
                  >
                    <ChevronRight aria-hidden="true" size={14} />
                    {t(VIEW_NAMES[view])}
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
