import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { createGeminiModel } from "../src/agent/gemini-model.js";

type Request = Parameters<GoogleGenAI["models"]["generateContent"]>[0];

/** A fake Gemini client that answers from a script and records each request. */
function fakeClient(answers: object[]) {
  const requests: Request[] = [];
  const client = {
    models: {
      generateContent: async (request: Request) => {
        // A copy, since the model keeps adding to the same history arrays.
        requests.push(structuredClone(request));
        return { candidates: [{ content: answers[requests.length - 1] }] };
      },
    },
  } as unknown as Pick<GoogleGenAI, "models">;
  return { client, requests };
}

const TOOLS = [{ name: "get_my_policy", description: "Read the policy", parameters: { type: "object", properties: {} } }];

describe("the agent on Gemini", () => {
  it("declares the tools, returns calls with IDs, and sends each result back under its call's name with the turn it answered", async () => {
    const { client, requests } = fakeClient([
      { role: "model", parts: [{ functionCall: { name: "get_my_policy", args: {} }, thoughtSignature: "sig-1" }] },
      { role: "model", parts: [{ text: "Your limit is €1,400.", thought: false }] },
    ]);
    const model = createGeminiModel({ apiKey: "test", model: "gemini-test", reasoningEffort: "low", client });

    const first = await model.respond({ instructions: "Be careful.", tools: TOOLS, userMessage: "What is my limit?" });
    assert.equal(first.toolCalls.length, 1);
    assert.equal(first.toolCalls[0]!.name, "get_my_policy");
    const config = requests[0]!.config as { systemInstruction: string; tools: { functionDeclarations: { name: string; parametersJsonSchema: unknown }[] }[] };
    assert.equal(config.systemInstruction, "Be careful.");
    assert.equal(config.tools[0]!.functionDeclarations[0]!.name, "get_my_policy");
    assert.deepEqual(config.tools[0]!.functionDeclarations[0]!.parametersJsonSchema, TOOLS[0]!.parameters);

    const second = await model.respond({
      instructions: "Be careful.",
      tools: TOOLS,
      continuation: first.continuation,
      toolResults: [{ callId: first.toolCalls[0]!.id, output: JSON.stringify({ limit: 140000 }) }],
    });
    assert.equal(second.text, "Your limit is €1,400.");
    const contents = requests[1]!.contents as { role: string; parts: Record<string, unknown>[] }[];
    assert.equal(contents.length, 3, "the question, the model's call, and the result");
    assert.equal(contents[1]!.parts[0]!.thoughtSignature, "sig-1", "the model's turn goes back exactly as returned, with its thought signature");
    assert.deepEqual(contents[2]!.parts[0]!.functionResponse, { id: first.toolCalls[0]!.id, name: "get_my_policy", response: { output: { limit: 140000 } } });
  });

  it("sends no tools when a run has none, and leaves the model's thoughts out of the reply", async () => {
    const { client, requests } = fakeClient([{ role: "model", parts: [{ text: "thinking…", thought: true }, { text: "Is this list correct?" }] }]);
    const model = createGeminiModel({ apiKey: "test", model: "gemini-test", reasoningEffort: "minimal", client });
    const turn = await model.respond({ instructions: "Confirm first.", tools: [], userMessage: "- 20 L milk" });
    assert.equal(turn.text, "Is this list correct?");
    assert.equal(turn.toolCalls.length, 0);
    assert.equal((requests[0]!.config as { tools?: unknown }).tools, undefined);
  });

  it("starts afresh when it no longer knows the conversation, for example after a restart", async () => {
    const { client, requests } = fakeClient([{ role: "model", parts: [{ text: "Hello." }] }]);
    const model = createGeminiModel({ apiKey: "test", model: "gemini-test", reasoningEffort: "low", client });
    await model.respond({ instructions: "", tools: [], continuation: "gemini-unknown", userMessage: "Hi" });
    assert.equal((requests[0]!.contents as unknown[]).length, 1);
  });
});
