import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp, type ApiRoute } from "../src/app.js";
import { startTestServer, type TestServer, testStore } from "./helpers.js";

describe("GET /api/openapi.json", () => {
  let server: TestServer;
  let doc: any;
  before(async () => {
    server = await startTestServer();
    doc = (await server.request("GET", "/api/openapi.json")).body;
  });
  after(() => server.close());

  it("is an OpenAPI 3.1 document with bearer authentication", () => {
    assert.equal(doc.openapi, "3.1.0");
    assert.equal(doc.info.title, "Trusted Trade Agents API");
    assert.deepEqual(doc.components.securitySchemes.bearer, {
      type: "http",
      scheme: "bearer",
      description: "A demo token for the agent or buyer role",
    });
  });

  it("documents every route the app serves, and nothing it does not", () => {
    const routes: ApiRoute[] = createApp({ store: testStore(), agentModel: null }).locals.routes;
    assert.ok(routes.length >= 25, `only ${routes.length} routes found`);
    const served = new Set(routes.map((route) => `${route.method.toUpperCase()} ${route.path}`));
    const documented = new Set(
      Object.entries(doc.paths).flatMap(([path, operations]) =>
        Object.keys(operations as object).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );
    const missing = [...served].filter((route) => !documented.has(route));
    const extra = [...documented].filter((route) => !served.has(route));
    assert.deepEqual(missing, [], `routes missing from the document: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `documented routes the app does not serve: ${extra.join(", ")}`);
  });

  it("generates request schemas from the same Zod schemas the routes validate with", () => {
    const createQuote = doc.paths["/api/quotes"].post;
    const line = createQuote.requestBody.content["application/json"].schema.properties.lines.items;
    assert.ok("offerToken" in line.properties && "productId" in line.properties);
    assert.deepEqual(line.properties.quantity.properties.unit.enum, ["package", "litre", "kilogram", "piece"]);
    assert.deepEqual(createQuote.security, [{ bearer: [] }]);

    const search = doc.paths["/api/products"].get;
    const names = search.parameters.map((parameter: { name: string }) => parameter.name);
    assert.deepEqual(names, ["q", "category", "attributes", "labels", "excludeAllergens", "deliverBy", "minQuantity", "unit", "limit"]);
    assert.equal(search.security, undefined);

    const decision = doc.paths["/api/quotes/{id}/decision"].post;
    assert.deepEqual(decision.parameters[0], { name: "id", in: "path", required: true, schema: { type: "string" } });
    assert.match(decision.description, /Needs the buyer role/);
    assert.deepEqual(decision.requestBody.content["application/json"].schema.properties.decision.enum, ["approve", "reject"]);
  });

  it("gives every operation a unique ID and at least one success response", () => {
    const ids = new Set<string>();
    for (const operations of Object.values(doc.paths)) {
      for (const operation of Object.values(operations as Record<string, any>)) {
        assert.ok(!ids.has(operation.operationId), operation.operationId);
        ids.add(operation.operationId);
        assert.ok(Object.keys(operation.responses).some((status) => status.startsWith("2")), operation.operationId);
      }
    }
  });
});
