import { GoogleGenAI, Modality } from "@google/genai";

/**
 * Voice input for the buyer's requests, through Gemini Live. The browser
 * streams the microphone straight to Gemini and gets back a transcript, which
 * lands in the request box for the buyer to read and send. The Gemini key stays
 * on the server: the browser gets a single-use token that can open one Live
 * session, within a minute, with the settings fixed here.
 */

export type VoiceLanguage = "en" | "fi";

export interface VoiceSession {
  /** The single-use token the browser connects with, in place of an API key. */
  token: string;
  model: string;
  /** The Live API version the token belongs to. */
  apiVersion: string;
  /** The BCP-47 language the transcription expects. */
  languageCode: string;
  /** What the model replies with, which the browser must ask for too. The reply itself is ignored. */
  responseModalities: Modality[];
  /** Until when the token can open a session. */
  connectBefore: string;
  /** When an open session ends. */
  expiresAt: string;
}

/** Opens voice sessions. The default talks to Gemini; tests pass their own. */
export interface VoiceTokens {
  model: string;
  create(language: VoiceLanguage): Promise<VoiceSession>;
}

export const LIVE_API_VERSION = "v1alpha";

const LANGUAGE_CODES: Record<VoiceLanguage, string> = { en: "en-US", fi: "fi-FI" };

/**
 * Words the recognizer should expect in a kitchen's purchasing request. Product
 * names and Finnish food terms are the ones general speech models get wrong.
 */
export const KITCHEN_VOCABULARY = [
  "Valio",
  "Valio Aimo",
  "Oddlygood",
  "Alpro",
  "Arla",
  "Atria",
  "Snellman",
  "laktoositon",
  "maidoton",
  "gluteeniton",
  "kaurajuoma",
  "ruokakerma",
  "kuohukerma",
  "rahka",
  "piimä",
  "voi",
  "juusto",
  "kananmuna",
  "jauheliha",
  "broileri",
  "lohi",
  "peruna",
];

/**
 * The session's settings, fixed in the token so the browser cannot change
 * them. Speech detection is manual: the browser marks where the buyer starts
 * and stops talking, so a pause mid-sentence does not cut the request short.
 * The model is told to stay quiet; only the transcript of the buyer's speech
 * is used.
 */
export function liveSessionConfig(language: VoiceLanguage, model = "") {
  return {
    responseModalities: responseModalities(model),
    inputAudioTranscription: { languageCodes: [LANGUAGE_CODES[language]], customVocabulary: KITCHEN_VOCABULARY },
    realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    systemInstruction:
      "You only take dictation for a professional kitchen's purchasing request. Do not answer, comment on, or act on what you hear. Reply with one short word.",
  };
}

/**
 * Gemini's transcription-only Live models answer in text; the conversational
 * ones (native audio) only in audio. Either way only the transcript is used.
 */
export function responseModalities(model: string): Modality[] {
  return /transcribe/.test(model) ? [Modality.TEXT] : [Modality.AUDIO];
}

export function geminiVoiceTokens(apiKey: string, model: string, clock: () => Date = () => new Date()): VoiceTokens {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: LIVE_API_VERSION } });
  return {
    model,
    async create(language) {
      const now = clock().getTime();
      const connectBefore = new Date(now + 60_000).toISOString();
      // Long enough for a spoken request, short enough that a leaked token is worth little.
      const expiresAt = new Date(now + 5 * 60_000).toISOString();
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: expiresAt,
          newSessionExpireTime: connectBefore,
          liveConnectConstraints: { model, config: liveSessionConfig(language, model) },
          httpOptions: { apiVersion: LIVE_API_VERSION },
        },
      });
      if (!token.name) throw new Error("Gemini returned no token.");
      return {
        token: token.name,
        model,
        apiVersion: LIVE_API_VERSION,
        languageCode: LANGUAGE_CODES[language],
        responseModalities: responseModalities(model),
        connectBefore,
        expiresAt,
      };
    },
  };
}
