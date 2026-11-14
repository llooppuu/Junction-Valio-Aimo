import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { signProductOffer } from "../src/services/catalog.js";
import { signClaims } from "../src/services/signing.js";
import { AGENT, BUYER, recordedValio, startTestServer, type TestServer, testStore } from "./helpers.js";

let server: TestServer;
afterEach(() => server.close());

/** Changes one claim in a token's payload but keeps the old signature, as a tampering client would. */
function tamper(token: string, change: (claims: Record<string, unknown>) => void): string {
  const [header, payload, signature] = token.split(".") as [string, string, string];
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  change(claims);
  return `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
}

/** The product part of an API response, without the fields the API adds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const productOf = (body: any) => {
  const { availableQuantity: _quantity, allergenStatements: _statements, offer: _offer, ...product } = body.product;
  return product;
};

const decode = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));

describe("signed offers", () => {
  beforeEach(async () => {
    server = await startTestServer();
  });

  it("publishes the signing key as a JWK Set", async () => {
    for (const path of ["/.well-known/jwks.json", "/api/.well-known/jwks.json"]) {
      const { status, body } = await server.request("GET", path);
      assert.equal(status, 200);
      assert.equal(body.keys.length, 1);
      assert.deepEqual(
        { kty: body.keys[0].kty, crv: body.keys[0].crv, alg: body.keys[0].alg, use: body.keys[0].use },
        { kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" },
      );
    }
  });

  it("signs each product's price, stock, origin, and allergens, and anyone can verify it with the public key alone", async () => {
    const { body } = await server.request("GET", "/api/products/464306");
    const { token, expiresAt } = body.product.offer;
    const claims = decode(token);
    assert.equal(claims.sub, "product:464306");
    assert.equal(claims.pricePerPackageEurCents, 101);
    assert.equal(claims.stockStatus, "unknown");
    assert.equal(claims.deliveryDate, "2026-11-16");
    assert.equal(claims.orderCutoff, "2026-11-15T17:00:00+0200");
    assert.deepEqual(claims.origin, { country: "FI" });
    // The claim says where the price and stock came from, and when Valio Aimo answered.
    assert.deepEqual(claims.source, { system: "Valio Aimo price and availability APIs", answeredAt: "2026-11-13T23:36:28+0200" });
    assert.deepEqual(claims.allergenStatements, [{ allergenTypeCode: "AM", levelOfContainment: "CONTAINS" }]);
    assert.equal(claims.exp - claims.iat, 15 * 60);
    assert.equal(new Date(claims.exp * 1000).toISOString(), expiresAt);

    // Independent check: only the JWK Set and standard crypto, no call to our API.
    const jwks = (await server.request("GET", "/.well-known/jwks.json")).body;
    const [header, payload, signature] = token.split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).kid, jwks.keys[0].kid);
    const key = createPublicKey({ key: jwks.keys[0], format: "jwk" });
    assert.ok(verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, "base64url")));
  });

  it("verifies a genuine offer and explains why a tampered or expired one fails", async () => {
    const { body } = await server.request("GET", "/api/products/464306");
    const verifyToken = (token: string) => server.request("POST", "/api/offers/verify", { body: { token } });

    const genuine = await verifyToken(body.product.offer.token);
    assert.equal(genuine.body.valid, true);
    assert.equal(genuine.body.claims.sub, "product:464306");

    const cheaper = await verifyToken(tamper(body.product.offer.token, (claims) => (claims.pricePerPackageEurCents = 1)));
    assert.equal(cheaper.body.valid, false);
    assert.match(cheaper.body.reason, /signature does not match the content/);

    const old = signProductOffer(productOf(body), new Date(Date.now() - 60 * 60 * 1000));
    const expired = await verifyToken(old.token);
    assert.equal(expired.body.valid, false);
    assert.match(expired.body.reason, /^expired at /);

    assert.equal((await verifyToken("not.a-token")).body.valid, false);
  });

  it("builds a quote from a genuine offer and refuses a tampered or expired one", async () => {
    const { body } = await server.request("GET", "/api/products/464306");
    const quote = (offerToken: string) =>
      server.request("POST", "/api/quotes", {
        token: AGENT,
        body: { lines: [{ offerToken, quantity: { amount: 1000, unit: "litre" } }] },
      });

    const genuine = await quote(body.product.offer.token);
    assert.equal(genuine.status, 201);
    assert.equal(genuine.body.quote.totalEurCents, 101000);

    const tampered = await quote(tamper(body.product.offer.token, (claims) => (claims.pricePerPackageEurCents = 1)));
    assert.equal(tampered.status, 422);
    assert.match(tampered.body.error, /product offer is not valid: the signature does not match/);

    const old = signProductOffer(productOf(body), new Date(Date.now() - 60 * 60 * 1000));
    const expired = await quote(old.token);
    assert.equal(expired.status, 422);
    assert.match(expired.body.error, /expired at/);

    const both = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ productId: "464306", offerToken: body.product.offer.token, quantity: { amount: 10, unit: "litre" } }] },
    });
    assert.equal(both.status, 400);
  });

  it("refuses a genuine offer once Valio Aimo's price has changed", async () => {
    await server.close();
    const valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
    const { body } = await server.request("GET", "/api/products/464306");
    valio.setPrice("464306", 1.11);
    const stale = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ offerToken: body.product.offer.token, quantity: { amount: 10, unit: "litre" } }] },
    });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /price of 464306 changed after the offer was issued/);
  });

  it("signs each quote and refuses an order that cites a tampered, expired, or wrong quote offer", async () => {
    const created = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ productId: "464306", quantity: { amount: 100, unit: "litre" } }] },
    });
    const { id, offer } = created.body.quote;
    assert.equal(decode(offer.token).sub, `quote:${id}`);
    assert.equal(decode(offer.token).totalEurCents, 10100);
    const order = (offerToken: string) => server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: id, offerToken } });

    const cheaper = await order(tamper(offer.token, (claims) => (claims.totalEurCents = 100)));
    assert.equal(cheaper.status, 422);
    assert.match(cheaper.body.error, /signed offer is not valid: the signature does not match/);

    const expired = signClaims(`quote:${id}`, { totalEurCents: 10100 }, 60, new Date(Date.now() - 60 * 60 * 1000));
    assert.equal((await order(expired.token)).status, 422);

    const other = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ productId: "463982", quantity: { amount: 1, unit: "package" } }] },
    });
    const wrong = await order(other.body.quote.offer.token);
    assert.equal(wrong.status, 422);
    assert.match(wrong.body.error, /signed offer is for quote:Q-0002, not quote:Q-0001/);

    assert.equal((await server.request("GET", "/api/orders", { token: BUYER })).body.orders.length, 0);
    const audit = await server.request("GET", "/api/audit", { token: BUYER });
    assert.equal(audit.body.entries.filter((entry: { action: string }) => entry.action === "order.refused").length, 3);

    const genuine = await order(offer.token);
    assert.equal(genuine.status, 201);
  });
});
