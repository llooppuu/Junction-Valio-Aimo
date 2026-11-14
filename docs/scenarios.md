# Scenarios

This page is a demo script. Each scenario names what to do in the app, what the server does, and the test that proves it. Start the app with `npm run dev`, open <http://localhost:5173>, and use **Start over** in the agent workspace to reset between scenarios. The language switch (EN / FI) at the top works in every view.

## The brief's milk request, step by step

> "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability."

**In the app.** Open **Agent workspace**, choose **Hotel chain**, pick the brief's example request, and send it.

1. **The agent reads its rules.** Its first API call is `GET /api/policy`: €1,400 per quote, nut-free, milk must be lactose-free.
2. **It compares offers that meet the request.** `GET /api/offers` with lactose-free, delivery by Monday, at least 1,000 litres, ranked by price per litre. The server searches the 17,546 products and asks Valio Aimo for live price and availability for the best matches only.
3. **It quotes at Valio Aimo's fixed price.** The cheapest offer that meets every rule is Valio's lactose-free semi-skimmed milk drink at €1.01 per litre: 1,000 packages, €1,010.00, delivered Monday. Every step shows as an API call in the workspace.
4. **The server decides whether the agent may order it alone.** Every rule passes, but milk is not yet an earned category, so the quote waits for the head chef: "the agent has not yet earned autonomy in milk (1 more approval in a row needed)".
5. **The head chef approves it** in the approval queue, after seeing every rule checked and the alternatives the agent did not choose, each with the reason. The agent has now earned milk, up to €1,010.
6. **The same request again** is within the agent's earned authority, and it places the order itself. The server checks Valio Aimo's price and availability once more before committing, and the order can never be placed twice.
7. **Everything is in the activity history**, in English and Finnish: the request, each quote, the permission check, the approval, autonomy earned, and the order.

**Through the API.** The same flow with `curl` is in [API](api.md#the-briefs-request-step-by-step).

## The brief's example scenarios

| Scenario from the brief | What to do | What the server does | Proof |
| --- | --- | --- | --- |
| **Need → recipe → order** | Ask the agent to plan a menu around new-season beetroot | Suggests the recipes that use it, multiplies by portions, subtracts the kitchen's inventory, rounds up to whole sales units at Valio Aimo's prices, flags what cannot be delivered, and quotes the plan | `menu-plan.test.ts` |
| **Last-minute event** | Ask the agent to plan an unexpected booking for tomorrow, for example 60 portions each of tomato pasta sauce and garden salad | Flags what cannot arrive in time and substitutes by the ingredient's role: chopped tomatoes can replace cherry tomatoes in a sauce, never in a salad; salmon is topped up with salmon, never herring | `scenario-event.test.ts` |
| **Supplier stock-out** | Open the workspace: the stock alert is already there | The agent's stock watch noticed, without being asked, that Valio Aimo cannot deliver an ingredient for the next planned order, and proposes a substitute per recipe role with the trade-off | `scenario-stockout.test.ts` |
| **Proactive selling agent** | In the **Wholesaler** view, run the sales agent | Valio Aimo's agent suggests new and seasonal products to every buyer's agent; each screens them against its own kitchen's rules, so the nut-free hotel never sees the hazelnut chocolate | `scenario-proactive-selling.test.ts` |
| **Allergen-safe substitution under pressure** | Choose **School kitchen** and send the "trap" example: a parent says lactose-free milk is fine | Lactose-free milk still contains milk protein, so the quote is blocked outright and can never reach approval. Substitutes must also meet the calcium rule for drinks; when none does, the agent says to ask a person | `scenario-allergen.test.ts` |
| **Standing order drift** | Open the weekly standing order in the workspace | Each line and the total are compared with the last eight weeks; the Emmental that crept from two packages a week to three, with four on the renewal, is flagged, and the renewal waits for the buyer with the trend attached | `scenario-standing-order.test.ts` |

## Controls in action

| What to try | What happens |
| --- | --- |
| Ask for more than the earned limit, for example 1,300 litres of milk after earning €1,010 | The quote waits for the buyer: the amount is above what the agent has earned |
| Reject a quote | The agent loses its autonomy in that category and is supervised again |
| Revoke a category in **Earned autonomy**, or grant one | Takes effect on the agent's next quote, and is recorded |
| Revoke the agent's mandate | The agent is refused on its next request until a new mandate is issued |
| Edit a signed offer with the tamper button on a product card | Verification fails, and an agent quoting from it is refused |
| Ask the school agent what it may order alone | It reads its own policy and mandate through the API and explains them |
| Run `npm run test:adversarial` | Eleven attacks, from self-approval to prompt injection in product data, all stopped and recorded; see [Trust and controls](trust-and-controls.md#adversarial-tests) |

## When things go wrong

| Exception | How it is handled |
| --- | --- |
| Order cut-off passed for the date | The product is shown as unavailable for that date, with when the cut-off was |
| Sales blocked, no price, or not deliverable on any date | Shown with the reason; never quoted |
| Availability unknown (999,999 or more) | Any quantity can be ordered; a supplier-delivered product is confirmed by the supplier with the order |
| Partial stock | The quote uses what Valio Aimo can deliver and offers substitutes for the rest |
| Stock changes before ordering | The quote becomes out of date with the shortfall, and the options to cover it are ranked |
| Valio Aimo's rate limit | The client waits out the 30-second block and carries on, or answers 503 with when to retry |
| Valio Aimo does not answer | Nothing is quoted or ordered, and the reason is shown; no price is ever guessed |
