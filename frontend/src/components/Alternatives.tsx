import type { Alternative } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { productName } from "../lib/names";
import { localized } from "../lib/reasons";

/** What the agent could have chosen instead, and why each option was or was not used. */
export function AlternativesList({ alternatives }: { alternatives: Alternative[] | undefined }) {
  const { t } = useI18n();
  if (!alternatives || alternatives.length === 0) return null;
  const rejected = alternatives.filter((alternative) => alternative.verdict !== "chosen").length;
  return (
    <details className="alternatives">
      <summary>{t("alt.summary", { chosen: alternatives.length - rejected, rejected })}</summary>
      <ul className="alternatives-list">
        {alternatives.map((alternative) => (
          <li key={alternative.productId} className={`alternative alternative-${alternative.verdict}`}>
            <span className="alternative-verdict">{t(`alt.${alternative.verdict}`)}</span>
            <span className="alternative-product">
              {alternative.supplier}
              <span className="approval-supplier">{productName(alternative.productId, alternative.productName)}</span>
            </span>
            <span className="alternative-reason">{localized(alternative.reason, alternative.reasonFi).replace(/^(Chosen|Not chosen|Excluded|Valittu|Ei valittu|Pois suljettu): /, "")}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
