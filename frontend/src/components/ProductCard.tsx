import type { Allergen, Product } from "../lib/api";
import {
  formatCutoff,
  formatDeliveryDate,
  formatEuroCents,
  formatNumber,
  formatPackages,
  formatPercent,
  formatQuantity,
  formatTime,
  formatTotalStock,
  formatUnitPrice,
  salesUnitName,
} from "../lib/format";
import { useI18n } from "../lib/i18n";
import { GS1_CODES, allergenName, categoryName, countryName, labelDescription, labelName } from "../lib/labels";
import { attributeName, productDescription, productName } from "../lib/names";
import { serverPhrase } from "../lib/reasons";
import { SignedOfferBadge } from "./SignedOffer";
import { SubstitutesPanel } from "./SubstitutesPanel";

interface ProductCardProps {
  product: Product;
  /** Set when the catalog is ranked: the position and the server's reason for it. */
  ranking?: { rank: number; reason: string } | undefined;
}

/** One Valio Aimo product, with the price and availability its APIs returned. */
export function ProductCard({ product, ranking }: ProductCardProps) {
  const { t } = useI18n();
  const { amount, unit } = product.packageSize;
  const available = !product.unavailableReason;
  const { nutrition } = product;
  const per = nutrition?.per === "100ml" ? "100 ml" : "100 g";
  const unitName = salesUnitName(product.salesUnit);
  const nutrients = nutrition
    ? ([
        ["product.energy", nutrition.energyKcal, "kcal"],
        ["product.fat", nutrition.fatG, "g"],
        ["product.saturated", nutrition.saturatedFatG, "g"],
        ["product.carbohydrate", nutrition.carbohydrateG, "g"],
        ["product.sugars", nutrition.sugarsG, "g"],
        ["product.protein", nutrition.proteinG, "g"],
        ["product.salt", nutrition.saltG, "g"],
        ["product.calcium", nutrition.calciumMg, "mg"],
      ] as const).filter(([, value]) => value !== undefined)
    : [];

  const stock =
    !available
      ? serverPhrase(product.unavailableReason!)
      : product.stockStatus === "plenty"
        ? t("stock.plenty")
        : product.stockStatus === "unconfirmed"
          ? t("stock.unconfirmed")
          : `${formatPackages(product.availablePackages)} (${formatTotalStock(product)})`;

  return (
    <article className={`product-card ${ranking?.rank === 1 ? "product-card-top" : ""}`} aria-labelledby={`product-${product.id}`}>
      {ranking && (
        <div className="product-ranking">
          <span className="rank-badge">#{ranking.rank}</span>
          <p className="rank-reason">{ranking.reason}</p>
        </div>
      )}
      <div className="product-topline">
        <span className="product-category">{categoryName(product.category)}</span>
        {product.labels.length > 0 && (
          <ul className="product-labels" aria-label={t("product.labels")}>
            {product.labels.map((label) => (
              <li key={label} className={`label label-${label}`} title={labelDescription(label)}>
                {labelName(label)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <h3 id={`product-${product.id}`} className="product-name">
        {productName(product.id, product.name)}
      </h3>
      <p className="product-supplier">
        {product.brand ? `${product.brand} · ` : ""}
        {product.supplier}
        {product.origin.country && <span className="product-origin"> · {countryName(product.origin.country)}</span>}
      </p>

      <p className="product-price">
        <span className="product-price-amount">{formatEuroCents(product.pricePerPackageEurCents)}</span> / {unitName}
        <span className="product-unit-price">{formatUnitPrice(product)}</span>
      </p>
      <p className="product-vat">{t(product.customerPrice ? "product.customerPrice" : "product.vat", { rate: formatNumber(product.vatRatePercent) })}</p>

      <dl className="product-details">
        <div>
          <dt>{t("product.package")}</dt>
          <dd>
            {product.packageSizeSource === "unknown" ? `1 ${unitName}` : t("product.contents", { unit: unitName, contents: formatQuantity(amount, unit) })}
          </dd>
        </div>
        <div>
          <dt>{t("product.stock")}</dt>
          <dd className={available ? undefined : "out-of-stock"}>{stock}</dd>
        </div>
        <div>
          <dt>{t("product.delivery")}</dt>
          <dd>
            {formatDeliveryDate(product.deliveryDate)}
            {available && product.orderCutoff && <span className="product-cutoff">{t("product.orderBy", { time: formatCutoff(product.orderCutoff) })}</span>}
          </dd>
        </div>
        <div>
          <dt>{t("product.reliability")}</dt>
          <dd className="product-reliability" title={t("product.reliabilityHelp")}>
            {product.deliveryReliability !== undefined ? (
              <>
                <span className="reliability-meter" role="img" aria-label={t("product.reliabilityAria", { rate: formatPercent(product.deliveryReliability) })}>
                  <span style={{ width: `${product.deliveryReliability * 100}%` }} />
                </span>
                {formatPercent(product.deliveryReliability)}
              </>
            ) : (
              <span className="section-muted">{t("product.noRecord")}</span>
            )}
          </dd>
        </div>
        {product.co2PerKg !== undefined && (
          <div>
            <dt>{t("product.carbon")}</dt>
            <dd title={t("product.carbonHelp")}>{t("product.carbonValue", { value: formatNumber(product.co2PerKg) })}</dd>
          </div>
        )}
      </dl>

      <div className="product-allergens" aria-label={t("product.allergens")}>
        {!product.allergensDeclared && <p className="allergen-undeclared">{t("product.undeclared")}</p>}
        {product.allergensDeclared && product.allergens.length === 0 && product.mayContain.length === 0 && product.freeFrom.length === 0 && (
          <p className="allergen-free">{t("product.noAllergens")}</p>
        )}
        {product.allergens.length > 0 && (
          <p>
            <span className="allergen-heading">{t("product.contains")}</span>
            {product.allergens.map((allergen) => (
              <AllergenChip key={allergen} allergen={allergen} level="CONTAINS" />
            ))}
          </p>
        )}
        {product.mayContain.length > 0 && (
          <p>
            <span className="allergen-heading">{t("product.mayContain")}</span>
            {product.mayContain.map((allergen) => (
              <AllergenChip key={allergen} allergen={allergen} level="MAY_CONTAIN" />
            ))}
          </p>
        )}
        {product.freeFrom.length === 14 ? (
          <p className="allergen-free">{t("product.freeFromAll")}</p>
        ) : (
          product.freeFrom.length > 0 && (
            <p>
              <span className="allergen-heading">{t("product.freeFrom")}</span>
              {product.freeFrom.map((allergen) => (
                <AllergenChip key={allergen} allergen={allergen} level="FREE_FROM" />
              ))}
            </p>
          )
        )}
      </div>

      {product.offer && <SignedOfferBadge offer={product.offer} />}

      {!available && <SubstitutesPanel product={product} />}

      <details className="product-more">
        <summary>{t("product.more")}</summary>
        {(product.description || product.descriptionFi) && <p className="product-description">{productDescription(product.id, product.description)}</p>}
        {nutrients.length > 0 && (
          <table className="nutrition-table">
            <caption>{t("product.per", { per })}</caption>
            <tbody>
              {nutrients.map(([key, value, suffix]) => (
                <tr key={key}>
                  <th scope="row">{t(key)}</th>
                  <td>
                    {formatNumber(value!)} {suffix}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="product-gtin">
          {t("product.code")} <code>{product.id}</code>
          {product.gtin && (
            <>
              {" "}
              · GTIN <code>{product.gtin}</code>
            </>
          )}
        </p>
        <p className="product-source">{t("product.source", { time: formatTime(product.liveAt) })}</p>
      </details>

      {product.attributes.length > 0 && (
        <ul className="product-attributes" aria-label={t("product.attributes")}>
          {product.attributes.map((attribute) => (
            <li key={attribute}>{attributeName(attribute)}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

const LEVEL_CLASSES = { CONTAINS: "allergen", MAY_CONTAIN: "allergen allergen-trace", FREE_FROM: "allergen allergen-freefrom" } as const;

/** One allergen with its GS1 code, so a person and an agent read the same statement. */
function AllergenChip({ allergen, level }: { allergen: Allergen; level: keyof typeof LEVEL_CLASSES }) {
  return (
    <span className={LEVEL_CLASSES[level]} title={`GS1 ${GS1_CODES[allergen]} · ${level}`}>
      {allergenName(allergen)}
      <span className="allergen-code">{GS1_CODES[allergen]}</span>
    </span>
  );
}
