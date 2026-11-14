import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { Modality } from "@google/genai";
import { liveSessionConfig, responseModalities, type VoiceLanguage, type VoiceTokens } from "../src/services/voice.js";
import { AGENT, BUYER, startTestServer } from "./helpers.js";

/** A stand-in for Gemini that records which languages it was asked for. */
function fakeTokens(fail = false): VoiceTokens & { asked: VoiceLanguage[] } {
  const asked: VoiceLanguage[] = [];
  return {
    model: "gemini-test-live",
    asked,
    async create(language) {
      asked.push(language);
      if (fail) throw new Error("quota exceeded");
      return {
        token: `auth_tokens/test-${language}`,
        model: "gemini-test-live",
        apiVersion: "v1alpha",
        languageCode: language === "fi" ? "fi-FI" : "en-US",
        responseModalities: [Modality.TEXT],
        connectBefore: "2026-11-14T12:01:00.000Z",
        expiresAt: "2026-11-14T12:05:00.000Z",
      };
    },
  };
}

describe("voice input", () => {
  const servers: { close(): void }[] = [];
  after(() => servers.forEach((server) => server.close()));
  const start = async (voiceTokens: VoiceTokens | null) => {
    const server = await startTestServer({ voiceTokens });
    servers.push(server);
    return server;
  };

  it("is off without a Gemini key, and says so instead of failing silently", async () => {
    const server = await start(null);
    const status = await server.request("GET", "/api/voice", { token: BUYER });
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { available: false, model: null });
    const token = await server.request("POST", "/api/voice/token", { token: BUYER, body: {} });
    assert.equal(token.status, 503);
    assert.match(token.body.error, /GEMINI_API_KEY/);
  });

  it("gives the buyer a single-use session in the language they speak", async () => {
    const tokens = fakeTokens();
    const server = await start(tokens);
    assert.deepEqual((await server.request("GET", "/api/voice", { token: BUYER })).body, { available: true, model: "gemini-test-live" });
    const fi = await server.request("POST", "/api/voice/token", { token: BUYER, body: { language: "fi" } });
    assert.equal(fi.status, 201);
    assert.equal(fi.body.session.token, "auth_tokens/test-fi");
    assert.equal(fi.body.session.languageCode, "fi-FI");
    const en = await server.request("POST", "/api/voice/token", { token: BUYER });
    assert.equal(en.status, 201);
    assert.deepEqual(tokens.asked, ["fi", "en"]);
  });

  it("is for the buyer only: an agent never gets a voice session", async () => {
    const tokens = fakeTokens();
    const server = await start(tokens);
    assert.equal((await server.request("POST", "/api/voice/token", { token: AGENT, body: {} })).status, 403);
    assert.equal((await server.request("GET", "/api/voice", { token: AGENT })).status, 403);
    assert.equal((await server.request("POST", "/api/voice/token", { body: {} })).status, 401);
    assert.deepEqual(tokens.asked, []);
  });

  it("rejects an unknown language and reports Gemini's failure as a bad gateway", async () => {
    const server = await start(fakeTokens(true));
    assert.equal((await server.request("POST", "/api/voice/token", { token: BUYER, body: { language: "sv" } })).status, 400);
    const failed = await server.request("POST", "/api/voice/token", { token: BUYER, body: {} });
    assert.equal(failed.status, 502);
    assert.doesNotMatch(failed.body.error, /quota/, "Gemini's own error stays in the server log");
  });

  it("asks each kind of Live model for the reply type it supports", () => {
    assert.deepEqual(responseModalities("gemini-3.5-transcribe-live"), [Modality.TEXT]);
    assert.deepEqual(responseModalities("gemini-2.5-flash-native-audio-latest"), [Modality.AUDIO]);
    assert.deepEqual(liveSessionConfig("en", "gemini-3.5-transcribe-live").responseModalities, [Modality.TEXT]);
  });

  it("fixes the session to transcription with manual turn-taking, biased to kitchen vocabulary", () => {
    const config = liveSessionConfig("fi");
    assert.deepEqual(config.inputAudioTranscription.languageCodes, ["fi-FI"]);
    assert.ok(config.inputAudioTranscription.customVocabulary.includes("laktoositon"));
    assert.equal(config.realtimeInputConfig.automaticActivityDetection.disabled, true);
  });
});
