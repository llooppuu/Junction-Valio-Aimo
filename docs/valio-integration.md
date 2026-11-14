# Valio Aimo integration

The app works on Valio Aimo's challenge material: the 17,546-product data file, the delivery reliability and carbon footprint files, and the mock price and availability APIs. Nothing about the products, prices, or stock is invented. The kitchens, their rules, recipes, inventory, and order history are ours.

All calls to Valio Aimo go through one client on the server, `backend/src/services/valio.ts`. The API key is read only there and never reaches a browser or an agent.

## Lookup in two steps

The organizers ask that live price and availability are fetched only for products already narrowed down. Lookup therefore runs in two steps:

1. **Search the static data.** `npm run data` turns the organizers' product file into a compact catalog (`backend/data/catalog.json`), with each product's category, contents, allergens (GS1 codes), labels, nutrition, delivery reliability, and carbon footprint. Search runs over it in memory: every word of the query must appear in the product's names, brand, supplier, category, or attributes, in English or Finnish.
2. **Price the best matches only.** The best 20 matches (50 at most) are sent to `POST /api/price` and `POST /api/availability` for the requested delivery date. Long lists are split into batches of 1,000, the API's maximum.

**Search by meaning** is the other way to do step 1. `npm run embeddings` stores an embedding of every product (both names, brand, category, attributes, and descriptions in English and Finnish; OpenAI `text-embedding-3-small`, 512 dimensions). With `search=semantic`, the query is embedded once and the products that pass the filters are ranked by similarity, so "something plant-based for cooking instead of cream" finds oat and soya cooking products although no word matches. Without the index or an OpenAI key, the search falls back to matching words and says why.

Answers are cached briefly (price 5 minutes, availability 1 minute), and the client counts every call, product requested, cache hit, and failure.

## Reading Valio Aimo's answers

The Valio Aimo team clarified how the mock data should be read. The server follows each rule, and the tests pin each one down.

| Valio Aimo's data | How the server reads it |
| --- | --- |
| `closingTime` | The order cut-off for the related `availableDate`. Once it has passed, the product cannot be ordered for that date, and the reason says when the cut-off was. |
| Availability of 999,999 or more | Valio Aimo does not know the amount; its logic allows ordering any quantity. Typically a product delivered from a supplier's own warehouse. The status is `unconfirmed` for a supplier-delivered (terminal) product and `unknown` otherwise; neither limits the order. |
| An empty amount, or no schedule line | Not available. |
| A fraction below one, such as `0.01` | One sales unit. Fractions are a technical artefact: 0.01 crates is not a real quantity. |
| `salesBlock` | Sales are blocked; the product cannot be ordered. |
| No price, or an error in the price answer | The product cannot be ordered; the server never guesses a price. |

A product the agent cannot order still appears in results, with the reason, so the agent and the buyer can see why it was passed over.

## Rate limits

Valio Aimo answers HTTP 429 when a client calls too often, and then blocks it for 30 seconds. A few hundred calls a minute are fine; a burst of them within seconds is not. The client:

- **paces itself,** starting at most 25 calls in any 10 seconds, so it does not hit the limit in normal use;
- **honours a block:** after a 429 it pauses every call, not just the one that hit it, for the time in `Retry-After`, or 30 seconds when there is none, then retries;
- **gives up cleanly:** if the block persists after two waits, the API answers `503` with a `Retry-After` header and `upstream: "valio-aimo"`, so the caller knows when to try again;
- retries a network error or a server error once.

The client also counts the 429 answers it received and, during a block, records when it ends.

## When Valio Aimo does not answer

If the price and availability service is unreachable, the server says so plainly (`503`) and does not quote or order anything. It never fills in a price or stock figure of its own. Search over the static data still works.

## Orders wait for a person

Valio Aimo's mock environment has no order API, and today Valio Aimo enforces no approval gates: a kitchen controls spending with internal instructions or by letting only a manager order. In an agentic setup, a person should approve the order at first. So an order here is:

- created only from an authorized quote: one within the agent's earned authority, or one the buyer approved;
- checked against Valio Aimo's price and availability again, just before it is committed, with a fresh call that skips the cache; it is refused if stock, the delivery date, the order cut-off, or the agent's current authority no longer cover it, or if the quote has expired (see [Checked again at the moment of ordering](trust-and-controls.md#checked-again-at-the-moment-of-ordering));
- recorded once per quote, with its lines, fixed prices, delivery date, and who authorized it;
- available as a PEPPOL BIS Order 3.0 document (UBL 2.1 XML), with fixed prices, GTINs, VAT rates, and the delivery date, which a person forwards or any PEPPOL-capable system imports, until an order API exists. The Orders view has a download link on each order.

[Earned autonomy](trust-and-controls.md#earned-autonomy) is how the need for a person can be relaxed later, category by category, as the agent proves reliable.

## Stock that changes

Valio Aimo's stock and terms can change between a quote and an order. The server rechecks before committing. If a product now arrives later than quoted, is no longer orderable, or its cut-off has passed, the quote becomes `out_of_date` with `changedTerms`. If a line can no longer be filled, the quote becomes `out_of_date` with the shortfall, and `GET /api/quotes/{id}/shortfall-options` shows how much of the line current stock can still fill and ranks the products that can cover the rest, cheapest first, with the reasons others cannot. Orders placed here are subtracted from the stock Valio Aimo reports, since the mock APIs take no orders.

The agent's stock watch also checks every product a kitchen's recipes and next planned order depend on. When a supplier can no longer cover one, the agent raises an alert with a substitute for each ingredient role, before the kitchen notices the gap. Nothing is ordered until the buyer asks.

## Recorded answers for tests

The tests never call the live APIs. `backend/test/fixtures/valio.json` holds recorded answers for a slice of 780 products, and the tests replay them; they can change a product's stock or price to act out a stock-out. `npm run record-fixture --workspace backend` records a fresh fixture.
