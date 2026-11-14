# Documentation

Trusted Trade Agents is the interface and operating model through which an external AI purchasing agent can work with Valio Aimo: look products up, compare offers, turn a fixed-price quote into an order, and hand anything outside its authority to a person.

## Read this first

If you have two minutes, read these in order:

1. [Scenarios](scenarios.md): the brief's request from plain language to an order for human approval, step by step, and the other scenarios the brief suggests.
2. [Trust and controls](trust-and-controls.md): what an agent may decide alone, what needs a person, how autonomy is earned, and how every decision is recorded.
3. [Standards and the path to production](standards-and-production.md): the open standards used, every assumption, and the next steps.

## All documents

| Document | What it covers |
| --- | --- |
| [Architecture](architecture.md) | The parts, how a request flows through them, and the main design choices |
| [API](api.md) | Authentication, the end-to-end flow with examples, every endpoint, and errors |
| [Trust and controls](trust-and-controls.md) | Signed offers, mandates, guardrails, earned autonomy, approvals, the audit history, and the adversarial tests |
| [Valio Aimo integration](valio-integration.md) | The two-step lookup, how Valio Aimo's data is read, rate limits, and why orders wait for approval |
| [Scenarios](scenarios.md) | A demo script for the judges and the brief's example scenarios |
| [Standards and the path to production](standards-and-production.md) | Open standards, assumptions, known limits, and next steps |
| [Deployment](deployment.md) | Running the app in one Docker container on any host |

## How the brief's criteria are met

| Criterion | Where it is met |
| --- | --- |
| Working end-to-end demo (30%) | The brief's milk request runs from plain language through lookup, a fixed-price quote, and the approval gate to an order, on Valio Aimo's live mock APIs. See [Scenarios](scenarios.md#the-briefs-request-end-to-end). |
| Solving the buyer's need precisely (20%) | Requirements are read from the request and checked on the server: lactose-free, allergens, delivery by the deadline, enough stock, and the cheapest offer per litre that meets them all. Each alternative the agent did not choose is recorded with the reason. |
| Autonomy and controls (20%) | Server-side rules the agent cannot change, a buyer-signed mandate, earned autonomy per product category, an approval queue, and an append-only audit history. Eleven adversarial tests show every attack stopped. See [Trust and controls](trust-and-controls.md). |
| Robustness to exceptions (15%) | Order cut-offs, sales blocks, unknown and partial availability, stock that changes before ordering, substitutes by recipe role, and Valio Aimo's rate limit and outages. See [Valio Aimo integration](valio-integration.md) and [Scenarios](scenarios.md). |
| Openness and a path to production (15%) | OpenAPI 3.1, JWS with a published JWK Set, W3C Verifiable Credentials on did:key, GS1 allergen codes, and a documented list of assumptions and next steps. See [Standards and the path to production](standards-and-production.md). |
