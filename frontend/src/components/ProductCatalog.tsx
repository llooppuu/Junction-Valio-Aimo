import { useEffect, useMemo, useState } from "react";
import {
  fetchOfferResult,
  productSearchPath,
  searchProducts,
  type Allergen,
  type Label,
  type Product,
  type ProductCategory,
  type RankBy,
} from "../lib/api";
import { useI18n } from "../lib/i18n";
import { ALLERGENS, CATEGORIES, LABELS, allergenName, categoryName, labelName } from "../lib/labels";
import type { MessageKey } from "../lib/messages";
import { productName } from "../lib/names";
import { serverPhrase } from "../lib/reasons";
import { ProductCard } from "./ProductCard";

type CatalogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      products: Product[];
      rankings: Map<string, { rank: number; reason: string }>;
      /** Matches Valio Aimo cannot deliver for the date, with the reasons. */
      excluded: { productId: string; name: string; reasons: string[] }[];
    };

const RANKINGS: { value: RankBy | ""; label: MessageKey }[] = [
  { value: "", label: "catalog.rank.none" },
  { value: "price", label: "catalog.rank.price" },
  { value: "delivery", label: "catalog.rank.delivery" },
  { value: "reliability", label: "catalog.rank.reliability" },
  { value: "labels", label: "catalog.rank.labels" },
  { value: "carbon", label: "catalog.rank.carbon" },
];

const SKELETON_CARDS = [1, 2, 3];

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((candidate) => candidate !== item) : [...list, item];
}

/**
 * The catalog with the same filters an agent uses. The filters become a query
 * to GET /api/products, shown under the filters.
 * `version` changes when stock may have changed; the catalog then refreshes without a loading state.
 */
export function ProductCatalog({ version }: { version: number }) {
  const { t, tn } = useI18n();
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<ProductCategory | "">("");
  const [labels, setLabels] = useState<Label[]>([]);
  const [excluded, setExcluded] = useState<Allergen[]>([]);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [rankBy, setRankBy] = useState<RankBy | "">("");
  const [deliverBy, setDeliverBy] = useState("");
  // Search by meaning: the server ranks products by what the words mean, in English or Finnish.
  const [byMeaning, setByMeaning] = useState(false);
  const [fellBack, setFellBack] = useState(false);

  // Waits for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const query = useMemo(
    () => ({ q, category, labels, excludeAllergens: excluded, deliverBy, ...(rankBy ? { rankBy } : {}), ...(byMeaning && q ? { search: "semantic" } : {}) }),
    [q, category, labels, excluded, deliverBy, rankBy, byMeaning],
  );

  useEffect(() => {
    const controller = new AbortController();
    const load = rankBy
      ? fetchOfferResult(controller.signal, query).then(({ offers, unavailable }) => ({
          products: offers.map((offer) => offer.product),
          rankings: new Map(offers.map((offer) => [offer.product.id, { rank: offer.rank, reason: offer.reason }])),
          excluded: unavailable.map((item) => ({ productId: item.productId, name: item.name, reasons: [item.reason] })),
        }))
      : searchProducts(controller.signal, query).then(({ products, excluded, source }) => {
          setFellBack(query.search === "semantic" && source.search === "keyword");
          return { products, rankings: new Map(), excluded };
        });
    load
      .then(({ products, rankings, excluded }) => setState({ status: "ready", products, rankings, excluded }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : t("common.unknownError") });
      });
    return () => controller.abort();
    // t only changes with the language, which needs no reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, version, query, rankBy]);

  function reload() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  function clearFilters() {
    setText("");
    setQ("");
    setCategory("");
    setLabels([]);
    setExcluded([]);
    setInStockOnly(false);
    setRankBy("");
    setDeliverBy("");
  }

  const filtered =
    state.status === "ready" && (q || category || labels.length || excluded.length || inStockOnly || rankBy || deliverBy);
  const shown =
    state.status === "ready"
      ? state.products.filter((product) => !inStockOnly || !product.unavailableReason)
      : [];

  return (
    <section aria-labelledby="catalog-heading">
      <div className="catalog-header">
        <h2 id="catalog-heading">{t("catalog.products")}</h2>
        {state.status === "ready" && (
          <p className="catalog-count">{tn("catalog.count.one", shown.length)}</p>
        )}
      </div>
      <p className="section-muted catalog-intro">{t("catalog.intro")}</p>

      <div className="catalog-filters" role="search" aria-label={t("catalog.filter")}>
        <div className="filter-row">
          <label className="filter-search">
            <span className="visually-hidden">{t("catalog.search")}</span>
            <input
              type="search"
              placeholder={t("catalog.searchPlaceholder")}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="filter-check filter-meaning" title={t("catalog.byMeaningHint")}>
            <input type="checkbox" checked={byMeaning} onChange={(event) => setByMeaning(event.target.checked)} />
            {t("catalog.byMeaning")}
          </label>
          <label className="filter-select">
            <span className="visually-hidden">{t("catalog.category")}</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as ProductCategory | "")}>
              <option value="">{t("catalog.allCategories")}</option>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {categoryName(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-select filter-rank">
            <span className="filter-inline-label">{t("catalog.rankBy")}</span>
            <select value={rankBy} onChange={(event) => setRankBy(event.target.value as RankBy | "")}>
              {RANKINGS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-select filter-date">
            <span className="filter-inline-label">{t("catalog.deliverBy")}</span>
            <input type="date" value={deliverBy} onChange={(event) => setDeliverBy(event.target.value)} />
          </label>
          <label className="filter-check">
            <input type="checkbox" checked={inStockOnly} onChange={(event) => setInStockOnly(event.target.checked)} />
            {t("catalog.inStock")}
          </label>
        </div>

        {byMeaning && fellBack && <p className="section-muted catalog-fallback" role="status">{t("catalog.semanticFallback")}</p>}

        <div className="filter-group" role="group" aria-label={t("catalog.requiredLabels")}>
          <span className="filter-group-label">{t("catalog.labels")}</span>
          {LABELS.map((label) => (
            <button
              key={label}
              type="button"
              className={`chip ${labels.includes(label) ? "chip-on" : ""}`}
              aria-pressed={labels.includes(label)}
              onClick={() => setLabels((current) => toggle(current, label))}
            >
              {labelName(label)}
            </button>
          ))}
        </div>

        <div className="filter-group" role="group" aria-label={t("catalog.excludeAllergens")}>
          <span className="filter-group-label">{t("catalog.freeFrom")}</span>
          {ALLERGENS.map((allergen) => (
            <button
              key={allergen}
              type="button"
              className={`chip chip-allergen ${excluded.includes(allergen) ? "chip-on" : ""}`}
              aria-pressed={excluded.includes(allergen)}
              onClick={() => setExcluded((current) => toggle(current, allergen))}
            >
              {allergenName(allergen)}
            </button>
          ))}
        </div>

        <div className="filter-footer">
          <code className="api-query" title={t("catalog.querySame")}>
            GET {productSearchPath(query, rankBy ? "/api/offers" : "/api/products")}
          </code>
          {filtered && (
            <button type="button" className="button-secondary button-small" onClick={clearFilters}>
              {t("catalog.clear")}
            </button>
          )}
        </div>
      </div>

      {state.status === "loading" && (
        <>
          <p role="status" className="catalog-loading">
            {t("catalog.loading")}
          </p>
          <div className="product-grid" aria-hidden="true">
            {SKELETON_CARDS.map((card) => (
              <div key={card} className="product-card skeleton-card" />
            ))}
          </div>
        </>
      )}

      {state.status === "error" && (
        <div role="alert" className="catalog-message catalog-message-error">
          <h3>{t("catalog.loadFailed")}</h3>
          <p>{t("catalog.checkBackend")}</p>
          <p className="catalog-message-detail">{state.message}</p>
          <button type="button" onClick={reload}>
            {t("common.tryAgain")}
          </button>
        </div>
      )}

      {state.status === "ready" && shown.length === 0 && (
        <div className="catalog-message">
          <h3>{filtered ? t("catalog.noMatch") : t("catalog.noProducts")}</h3>
          <p>{filtered ? t("catalog.removeFilter") : t("catalog.empty")}</p>
          <button type="button" onClick={filtered ? clearFilters : reload}>
            {filtered ? t("catalog.clear") : t("catalog.checkAgain")}
          </button>
        </div>
      )}

      {state.status === "ready" && state.excluded.length > 0 && (
        <details className="alternatives catalog-excluded">
          <summary>{tn("catalog.excluded.one", state.excluded.length)}</summary>
          <ul>
            {state.excluded.map((item) => (
              <li key={item.productId}>
                <strong>{productName(item.productId, item.name)}</strong>: {item.reasons.map(serverPhrase).join("; ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      {state.status === "ready" && shown.length > 0 && (
        <ul className="product-grid">
          {shown.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} ranking={state.status === "ready" ? state.rankings.get(product.id) : undefined} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
