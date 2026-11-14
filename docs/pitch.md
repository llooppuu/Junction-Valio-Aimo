# Pitch and live demo

A three-minute talk built around a live demo, in the order of the judging criteria's weight. Each beat says what to show and what to say. The [Scenarios](scenarios.md) page has the same flows in more detail, with the tests that prove them.

## Before going on stage

1. Run `npm run smoke -- <hosted URL>`. Every line should say `ok`, and voice input says `on` if it will be used.
2. Open the hosted app, press **Start over** in the agent workspace, and choose **Hotel chain**.
3. Open **Activity** in a second tab, to show calls arriving from outside agents.
4. If showing MCP, start the desktop client with its MCP entry pointed at the hosted app (see [MCP clients](mcp.md#pointing-it-at-the-hosted-app)), and check that it lists 16 tools.
5. Allow the microphone once beforehand, so the permission prompt does not appear on stage.

## The talk

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | The agent workspace, empty | Kitchens' AI agents will soon buy on their own. Whether an agent can place an order isn't the hard part. What matters is whether Valio Aimo and the head chef can trust what it orders. We built the interface and the rules that make that trust checkable. |
| 0:20 | Press **Speak** and say the brief's request: "We need 1,000 litres of lactose-free milk delivered on Monday. Thank you." | The head chef can type or speak, in English or Finnish, hands free: "thank you" or "kiitos" at the end sends it. Pressing Stop instead leaves the words in the box to check first. |
| 0:35 | The agent's steps as they appear | The agent first reads its own rules, then compares lactose-free milks that arrive by Monday, with live price and availability from Valio Aimo's APIs for only the best matches. Every step is a call to the same public API any outside agent would use. |
| 0:55 | The quote waiting for approval | €1,010 at Valio Aimo's fixed price. Every rule passes, but the server, not the agent, decides it waits: this agent hasn't earned milk yet. |
| 1:05 | The approval queue: rules checked, alternatives not chosen | The head chef sees why this milk, and why not the others. Approve. |
| 1:15 | Send the same request again; the agent orders by itself | Trust is earned one product category at a time, up to the largest total the head chef approved there. One rejection and the agent is supervised again. |
| 1:30 | **Orders**: download the PEPPOL order | There's no order API in the mock environment, so every order is a PEPPOL BIS Order 3.0 document, ready to forward or import. |
| 1:40 | Switch to **School kitchen**, send the example **The lactose-free trap** | A parent says lactose-free milk is fine. Lactose-free milk still contains milk protein, so the server blocks it outright. It can never reach approval, whatever the agent is told. |
| 2:00 | **Tamper** on a product card's signed offer, then verification failing | Every offer is signed. Change one cent and verification fails, so an agent quoting a forged price is refused. Eleven adversarial tests cover the rest, from self-approval to prompt injection in product data. |
| 2:15 | The stock alert in the workspace | Exceptions are handled without being asked: the agent noticed Valio Aimo can't deliver an ingredient for the next order and proposed a substitute that fits the recipe's role. |
| 2:30 | The desktop MCP client buying from the hosted app, then the same call in **Activity** | Any agent can use this. Over MCP it gets the same 16 tools, and the same rules, mandate and audit history apply. |
| 2:45 | The language switch | Everything is bilingual, down to the audit history. |
| 2:50 | | Open standards throughout: OpenAPI, signed offers with a published key, mandates as W3C Verifiable Credentials, MCP, and PEPPOL orders. The next step to production is Valio Aimo's order API, and the order documents are already in the format it would take. |

If the network or a key fails on stage, skip that beat: the rest of the demo does not depend on the AI agent or voice input. Approvals, signed offers, the PEPPOL download, and the activity history all work from the app's buttons.

## Questions to expect

**What stops the agent from approving its own order?** The agent's token has no route that approves or changes rules; approval needs the buyer's token. The adversarial tests try exactly this. See [Trust and controls](trust-and-controls.md).

**What if the model hallucinates a price?** Quotes are priced by the server from Valio Aimo's catalog price, never from what the agent says. A signed offer that was changed fails verification.

**What happens when Valio Aimo's API is slow or rate-limited?** The client paces itself, waits out the 30-second block on a 429, and otherwise answers 503 with when to retry. Nothing is quoted on a guessed price. See [Valio Aimo integration](valio-integration.md).

**Why not let the agent order everything once it's trusted?** Autonomy is per product category and capped by what the head chef has approved there, within the policy's limits. The judges' note that agents need human approval for now is the default: a new agent starts supervised.

**Is the data real?** The products, prices, and stock come from Valio Aimo's challenge material and mock APIs. The kitchens, their rules, recipes, and order history are made up for the demo.

**How would this reach production?** See [the path to production](standards-and-production.md#path-to-production): a database with a tamper-evident history, real identities for agents and people, managed signing keys, Valio Aimo's order API, and trust earned from delivery outcomes as well as approvals.
