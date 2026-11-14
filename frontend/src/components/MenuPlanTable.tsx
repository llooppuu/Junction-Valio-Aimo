import { Fragment } from "react";
import type { MenuPlan, Substitution } from "../lib/api";
import { formatEuroCents, formatQuantity } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { dishName, productName, roleName } from "../lib/names";

const dishesText = (plan: MenuPlan) => plan.dishes.map((dish) => `${dish.portions} × ${dishName(dish.name)}`).join(", ");

/** The server's menu calculation: needed, on hand, to order, and whole packages, for each product. */
export function MenuPlanTable({ plan }: { plan: MenuPlan }) {
  const { t } = useI18n();
  return (
    <div className="menu-plan">
      <p className="menu-plan-title">
        {plan.id}: {dishesText(plan)}
      </p>
      <div className="menu-plan-wrap">
        <table className="menu-plan-table">
          <thead>
            <tr>
              <th scope="col">{t("col.product")}</th>
              <th scope="col">{t("plan.needed")}</th>
              <th scope="col">{t("plan.onHand")}</th>
              <th scope="col">{t("plan.toOrder")}</th>
              <th scope="col">{t("plan.packages")}</th>
              <th scope="col">{t("plan.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <Fragment key={row.productId}>
                <tr className={row.problem ? "menu-plan-problem" : row.packages === 0 ? "menu-plan-covered" : undefined}>
                  <th scope="row">
                    {productName(row.productId, row.productName)}
                    <span className="approval-supplier">
                      {row.problem ? t("plan.problem", { problem: row.problem }) : row.dishes.map(dishName).join(", ")}
                    </span>
                  </th>
                  <td>{formatQuantity(row.needed, row.unit)}</td>
                  <td>{formatQuantity(row.onHand, row.unit)}</td>
                  <td>{row.toOrder > 0 ? formatQuantity(row.toOrder, row.unit) : t("plan.covered")}</td>
                  <td>{row.packages > 0 ? `${row.packages} × ${formatQuantity(row.packageSize, row.unit)}` : "–"}</td>
                  <td>{row.packages > 0 && !row.problem ? formatEuroCents(row.costEurCents) : "–"}</td>
                </tr>
                {row.substitutions?.map((substitution) => (
                  <SubstitutionRow key={substitution.dish} substitution={substitution} />
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={5}>
                {t("plan.total")}
                {plan.problems.length > 0 ? t("plan.toResolve", { count: plan.problems.length }) : ""}
              </th>
              <td>{formatEuroCents(plan.totalEurCents)}</td>
            </tr>
            {plan.resolutions && plan.resolutions.length > 0 && plan.totalWithSubstitutesEurCents !== undefined && (
              <tr className="menu-plan-with-subs">
                <th scope="row" colSpan={5}>
                  {t("plan.withSubs")}
                </th>
                <td>{formatEuroCents(plan.totalWithSubstitutesEurCents)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** One dish's substitute for a problem ingredient, chosen for the ingredient's role in that dish. */
function SubstitutionRow({ substitution }: { substitution: Substitution }) {
  const { t } = useI18n();
  const { choice } = substitution;
  return (
    <tr className={`menu-plan-sub${choice ? "" : " menu-plan-sub-none"}`}>
      <td colSpan={6}>
        <p className="menu-plan-sub-head">
          <span className="menu-plan-role">{roleName(substitution.role)}</span>
          {t("plan.short", { dish: dishName(substitution.dish), amount: formatQuantity(substitution.shortfall, substitution.unit) })}
          {choice && (
            <>
              {" → "}
              <strong>{productName(choice.productId, choice.productName)}</strong>
              {choice.source === "stock" ? t("plan.fromStock") : t("plan.fromSupplier", { supplier: choice.supplier })}
            </>
          )}
        </p>
        <p className="menu-plan-sub-note">{substitution.note}</p>
        {substitution.ruledOut.map((entry) => (
          <p key={entry.productId} className="menu-plan-sub-ruled">
            {t("plan.ruledOut", { name: productName(entry.productId, entry.productName), reason: entry.reason })}
          </p>
        ))}
      </td>
    </tr>
  );
}

/** The calculation behind a quote, folded away until the buyer opens it. */
export function QuotePlan({ plan }: { plan: MenuPlan | undefined }) {
  const { t } = useI18n();
  if (!plan) return null;
  return (
    <details className="alternatives">
      <summary>{t("plan.calculation", { dishes: dishesText(plan) })}</summary>
      <MenuPlanTable plan={plan} />
    </details>
  );
}
