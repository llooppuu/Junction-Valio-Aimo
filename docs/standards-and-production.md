# Standards and the path to production

The brief asks for an interface defined on open, verifiable standards rather than one platform's black box. This page lists the standards used, every assumption made, what the prototype leaves out, and how it would grow into a production system.

## Open standards

| Need | Standard | How it is used |
| --- | --- | --- |
| Describing the interface | OpenAPI 3.1 | `GET /api/openapi.json`, generated from the same Zod schemas the routes validate with. A test fails if a route is missing from it. |
| Authenticating callers | OAuth 2.0 bearer tokens (RFC 6750) | Every caller sends `Authorization: Bearer`. The token maps to a role. |
| Signed claims on price, stock, origin, and allergens | JWS (RFC 7515) with EdDSA over Ed25519 (RFC 8037) | Every product and quote offer is a compact JWS any agent can verify. |
| Publishing the verification key | JWK Set (RFC 7517) at a well-known URI (RFC 8615) | `/.well-known/jwks.json`, with a key ID so keys can be rotated. |
| The buyer's permission for an agent | W3C Verifiable Credentials, as VC-JWT | Each mandate is a credential with the agent's scope and limits. |
| The buyer's identity | `did:key` (W3C Credentials Community Group) | The issuer's public key is inside its identifier, so a mandate verifies from the token alone. |
| Allergens | EU Regulation 1169/2011 and GS1 allergen type codes | The 14 EU allergens, with the GS1 codes Valio Aimo's product data uses, in every product and its signed offer. |
| Product identity | GTIN (GS1) | Each product carries its GTIN where Valio Aimo's data has one. |
| Order documents | PEPPOL BIS Order 3.0 (UBL 2.1), GTIN scheme 0160, UN/ECE Recommendation 20 units | `GET /api/orders/{id}/ubl`: each order as a standard document, since there is no order API to send it to. |
| Rate limiting | HTTP 429 and `Retry-After` (RFC 6585, RFC 9110) | Honoured towards Valio Aimo, and passed on to callers as `503` with `Retry-After`. |
| Dates, money, countries | ISO 8601, ISO 4217 (EUR), ISO 3166-1 | Delivery dates and cut-offs, prices in euro cents, countries of origin. |
| Agent interoperability | Model Context Protocol (MCP) | The agent's 16 tools, its policy, and a purchasing guide, over stdio and Streamable HTTP at `/api/mcp`. See [MCP clients](mcp.md). |

The agent's 16 tools are thin wrappers over the public endpoints, described with JSON Schema, and the MCP layer lists those same definitions, so an MCP client needs no custom code and is held to the same rules.

## Assumptions

| Assumption | Why |
| --- | --- |
| Products, prices, stock, delivery dates, cut-offs, delivery reliability, and carbon footprint are Valio Aimo's challenge data, unchanged. | Nothing about the products is invented. |
| The kitchens, their rules, recipes, inventory, planned orders, order history, track records, and the wholesaler's launches are ours. | The challenge provides products, not customers. |
| Prices are Valio Aimo's catalog price per sales unit, without VAT, for the requested delivery date. A quote fixes them. | The brief bases ordering on list prices; there is no bargaining step. |
| Availability of 999,999 or more means unknown, and any quantity can be ordered; an empty amount means not available; 0.01 means one unit; `closingTime` is the cut-off for `availableDate`. | Clarified by the Valio Aimo team. |
| There is no order API, so an order is recorded here for a person to hand on. | Clarified by the Valio Aimo team. |
| Human approval is needed at the order step at first, and can be relaxed per category as an agent proves reliable. | Valio Aimo enforces no approval gates today; in an agentic setup a person should approve until reliability is shown. |
| The daily limit equals the spending limit per quote. | Stops an agent splitting one purchase into several quotes under the limit. |
| Delivery days and cut-offs are in Helsinki time. | Valio Aimo delivers in Finland. |
| Earned autonomy needs 3 approvals in a row for the hotel and 5 for the school kitchen. | Children's allergies call for a longer track record. |

## What the prototype leaves out

- **State is saved as one snapshot.** With `DATABASE_URL`, the whole state is saved to MariaDB as a JSON document, with the audit history also in its own append-only table. Without it, everything is in memory. One server process owns the state, so the app does not scale out to several instances yet.
- **Signing keys are kept in the database** with the state, so offers and mandates survive a restart, but the keys are not in a key management service.
- **Tokens are demo tokens** set in configuration, and the browser app acts as the buyer.
- **One buyer organization with two kitchens**, and one wholesaler.
- **No order is sent to Valio Aimo**, as its mock environment has no order API; each order can be downloaded as a PEPPOL BIS Order document instead.

## Path to production

1. **Relational tables and a tamper-evident history.** Move from the MariaDB snapshot to a table per record type, so several server instances can share the state. Revoke UPDATE and DELETE on `tta_audit` for the app's database user, and chain each entry's hash to the previous one, so any edit is detectable.
2. **Real identities for agents and people.** Agents authenticate with OAuth 2.0 client credentials and sender-constrained tokens (DPoP or mutual TLS); people sign in with the buyer organization's identity provider (OpenID Connect).
3. **Key management.** Keep the signing keys in a key management service, rotate them, and keep old public keys in the JWK Set until their offers expire.
4. **Mandate revocation others can check.** Publish revocations in a W3C Bitstring Status List, so a supplier or another agent can see that a mandate was revoked without asking this server.
5. **An order API.** When Valio Aimo opens order intake, an approved quote is sent there directly. The PEPPOL BIS Order document the app already produces can then travel over the PEPPOL network, which also reaches other wholesalers.
6. **Discovery for any agent.** The MCP server exists; next, publish an agent card at a well-known URI, so a buyer's existing assistant can find and use Valio Aimo without being told where.
7. **Trust from outcomes, not only approvals.** Feed delivery outcomes, credit notes, and complaints into earned autonomy, so a category is earned on what actually arrived, and lost when it did not.
8. **Approvals where people are.** Notify the buyer on mobile or in the tools the kitchen already uses, with one-tap approve or reject and the reason attached.
9. **Many buyers and wholesalers.** Separate tenants, per-tenant policies and keys, and Valio Aimo's view across all of them.
10. **Operations.** Metrics on agent decisions, refusal rates, approval times, and Valio Aimo's API health; alerts when an agent's refusals spike.

## Technical choices

| Choice | Why |
| --- | --- |
| TypeScript throughout, strict mode | One language for API, agent, and interface; the type checker enforces that every audit entry and rule check has a Finnish sentence. |
| Express 5 and Zod 4 | Small, widely known, and the schemas produce both validation and the OpenAPI document. |
| Node's built-in crypto for Ed25519 | No third-party signing library to trust. |
| React 19 and Vite | A fast buyer interface; the dev proxy keeps tokens out of the browser bundle. |
| Gemini or OpenAI GPT-5.5 with tool use | The agent reasons over a plain-language request and calls the public API. Both providers sit behind one small interface (`backend/src/agent/model.ts`), so any tool-using model can replace them; `AI_PROVIDER` switches between the two. |
| Gemini Live with ephemeral tokens | Speech to text for the buyer's requests, in English and Finnish. The browser never holds the API key, each token opens one session within a minute, and the session's settings are fixed in the token. Speech goes to Google only while the buyer holds the microphone on. |
| Node's test runner on recorded answers | Fast tests that never call the live APIs, with scenarios and adversarial attacks as executable proof. |
| One Docker container | Runs on any host; see [Deployment](deployment.md). |
