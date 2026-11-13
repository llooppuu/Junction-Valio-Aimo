import type { GuardrailCheck, Policy, ProductCategory } from "../lib/api";
import { formatEuroCents } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { allergenName, categoryName, labelName } from "../lib/labels";
import { attributeName, personName } from "../lib/names";

/** The buyer's standing rules for the agent, as the server enforces them. */
export function PolicyCard({ policy }: { policy: Policy | null }) {
  const { t } = useI18n();
  if (!policy) return null;

  const attributes = Object.entries(policy.requiredAttributes) as [ProductCategory, string[]][];
  const nutrition = Object.entries(policy.nutritionMinimums) as [ProductCategory, { calciumMg?: number; proteinG?: number; appliesTo?: string[] }][];

  return (
    <section aria-labelledby="policy-heading" className="policy-card">
      <div className="section-header">
        <h2 id="policy-heading">{t("policy.title", { buyer: personName(policy.buyerName) })}</h2>
      </div>
      <p className="section-muted policy-intro">{t("policy.intro")}</p>

      <h3 className="policy-group policy-group-blocked">{t("policy.blocked")}</h3>
      <ul className="policy-rules">
        <li>
          {policy.excludedAllergens.length > 0
            ? t("policy.allergens", { list: policy.excludedAllergens.map((allergen) => allergenName(allergen).toLowerCase()).join(", ") })
            : t("policy.noAllergens")}
          {policy.excludedAllergens.includes("milk") && (
            <span className="policy-note"> {t("policy.lactoseNote")}</span>
          )}
        </li>
      </ul>

      <h3 className="policy-group policy-group-approval">{t("policy.approval")}</h3>
      <ul className="policy-rules">
        <li>{t("policy.over", { amount: formatEuroCents(policy.spendingLimitEurCents) })}</li>
        <li>{t("policy.daily", { amount: formatEuroCents(policy.dailyLimitEurCents) })}</li>
        {attributes.map(([category, required]) => (
          <li key={category}>
            {t("policy.attributes", { category: categoryName(category), required: required.map(attributeName).join(", ") })}
          </li>
        ))}
        {policy.preferredSuppliers.length > 0 && <li>{t("policy.suppliers", { list: policy.preferredSuppliers.join(", ") })}</li>}
        {policy.requiredLabels.length > 0 && (
          <li>{t("policy.labels", { list: policy.requiredLabels.map(labelName).join(", ") })}</li>
        )}
        {nutrition.map(([category, minimum]) => (
          <li key={category}>
            {t("policy.nutrition", {
              category: minimum.appliesTo?.includes("drink") ? t("policy.drinksIn", { category: categoryName(category) }) : categoryName(category),
              parts: [
                ...(minimum.calciumMg !== undefined ? [t("policy.calcium", { amount: minimum.calciumMg })] : []),
                ...(minimum.proteinG !== undefined ? [t("policy.protein", { amount: minimum.proteinG })] : []),
              ].join(t("policy.or")),
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}

const OUTCOME_ICONS: Record<GuardrailCheck["outcome"], string> = { passed: "✓", needs_approval: "!", blocked: "✕" };

/** Every rule the server checked for one quote, with its outcome. */
export function GuardrailChecks({ checks }: { checks: GuardrailCheck[] }) {
  const { t, language } = useI18n();
  if (checks.length === 0) return null;
  return (
    <ul className="guardrail-checks" aria-label={t("rule.checked")}>
      {checks.map((check) => (
        <li key={check.rule} className={`guardrail guardrail-${check.outcome}`}>
          <span className="guardrail-icon" aria-hidden="true">
            {OUTCOME_ICONS[check.outcome]}
          </span>
          <span className="guardrail-rule">{t(`rule.${check.rule}`)}</span>
          {/* The server explains each check in English; in Finnish the verdict is shown, with the server's words on hover. */}
          <span className="guardrail-detail" title={language === "en" ? undefined : check.detail}>
            {language === "en" ? check.detail : t(`check.${check.outcome}`)}
          </span>
        </li>
      ))}
    </ul>
  );
}
