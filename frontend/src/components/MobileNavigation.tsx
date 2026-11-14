import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { VIEW_NAMES, type View } from "../lib/views";

const GROUPS = [
  { id: "purchasing", title: "footer.purchasing", views: ["dashboard", "workspace", "catalog"] },
  { id: "records", title: "footer.records", views: ["orders", "activity", "wholesaler"] },
] as const;

interface MobileNavigationProps {
  open: boolean;
  view: View;
  onSelect: (view: View) => void;
  badges: Partial<Record<View, { count: number; attention?: boolean }>>;
}

export function MobileNavigation({ open, view, onSelect, badges }: MobileNavigationProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { if (!open) setExpanded(null); }, [open]);

  return (
    <div id="mobile-navigation" className="mobile-navigation" hidden={!open}>
      <nav aria-label={t("nav.label")}>
        <ul className="mobile-menu-groups">
          {GROUPS.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className="mobile-menu-heading"
                aria-expanded={expanded === group.id}
                aria-controls={`mobile-menu-${group.id}`}
                onClick={() => setExpanded(expanded === group.id ? null : group.id)}
              >
                {t(group.title)}
                <ChevronDown size={24} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <ul id={`mobile-menu-${group.id}`} className="mobile-submenu" hidden={expanded !== group.id}>
                {group.views.map((item) => {
                  const badge = badges[item];
                  return (
                    <li key={item}>
                      <a href={`#${item}`} onClick={(event) => { event.preventDefault(); onSelect(item); }} aria-current={view === item ? "page" : undefined}>
                        {t(VIEW_NAMES[item])}
                        {badge && badge.count > 0 && <span className={`nav-badge ${badge.attention ? "nav-badge-attention" : ""}`}>{badge.count}</span>}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <button type="button" className="button-cta mobile-menu-cta" onClick={() => onSelect("workspace")}>
          {t("header.cta")}
        </button>
      </nav>
    </div>
  );
}
