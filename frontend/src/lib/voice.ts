import type { LiveServerMessage, Session } from "@google/genai";
import { createVoiceSession } from "./api";
import type { Language } from "./i18n";

/**
 * Dictation through Gemini Live. The microphone streams to Gemini as 16 kHz
 * PCM over a single-use token from our backend, and the transcript of what
 * the buyer says comes back as they speak. The buyer marks the start and end
 * of the request with the microphone button, so a pause to think does not cut
 * it short. Nothing is sent to the agent until the buyer presses Send.
 */

export interface Dictation {
  /** Stops listening and resolves with the full transcript once Gemini has caught up. */
  stop(): Promise<string>;
  /** Stops at once and drops the transcript. */
  cancel(): void;
}

export interface DictationOptions {
  language: Language;
  /** The transcript so far, each time it grows. */
  onTranscript: (text: string) => void;
  /** The session ended on its own, for example because the network dropped. */
  onError: (error: Error) => void;
}

const TARGET_RATE = 16_000;
/** How long to wait for the last words' transcript after the buyer stops. */
const FINISH_TIMEOUT_MS = 4_000;
/** Once the model starts its turn, the transcript of the buyer's turn is complete; a little grace for late chunks. */
const FINISH_GRACE_MS = 400;

// Collects the microphone's samples off the main thread and hands them over in blocks.
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = []; this.size = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      this.buffer.push(channel.slice());
      this.size += channel.length;
      if (this.size >= 2048) {
        const block = new Float32Array(this.size);
        let offset = 0;
        for (const part of this.buffer) { block.set(part, offset); offset += part.length; }
        this.port.postMessage(block, [block.buffer]);
        this.buffer = []; this.size = 0;
      }
    }
    return true;
  }
}
registerProcessor("tta-capture", Capture);
`;

/** Whether this browser can capture the microphone and run the capture worklet. */
export function dictationSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
}

/** Averages the input down to 16 kHz and encodes it as base64 little-endian 16-bit PCM. */
export function toPcm16Base64(samples: Float32Array, inputRate: number): string {
  const ratio = inputRate / TARGET_RATE;
  const length = Math.floor(samples.length / ratio);
  const pcm = new DataView(new ArrayBuffer(length * 2));
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < samples.length; j++) sum += samples[j]!;
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    pcm.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  let binary = "";
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function startDictation({ language, onTranscript, onError }: DictationOptions): Promise<Dictation> {
  // The permission prompt comes first, so a refusal costs no Gemini session.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const releaseMicrophone = () => stream.getTracks().forEach((track) => track.stop());

  let audio: AudioContext | undefined;
  let session: Session | undefined;
  let transcript = "";
  // Words still being recognized, shown until the final transcript of them arrives.
  let interim = "";
  let closedByUs = false;
  let finished: (() => void) | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  // Speech captured before the session is open, so the first words are not lost.
  const pending: string[] = [];

  const shutdown = () => {
    closedByUs = true;
    releaseMicrophone();
    void audio?.close().catch(() => undefined);
    session?.close();
  };

  try {
    audio = new AudioContext();
    const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
    try {
      await audio.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    const source = audio.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(audio, "tta-capture");
    const inputRate = audio.sampleRate;
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const data = toPcm16Base64(event.data, inputRate);
      if (session) session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${TARGET_RATE}` } });
      else pending.push(data);
    };
    source.connect(capture);

    const voice = await createVoiceSession(language);
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: voice.token, httpOptions: { apiVersion: voice.apiVersion } });
    session = await ai.live.connect({
      model: voice.model,
      config: { responseModalities: voice.responseModalities.map((modality) => (modality === "TEXT" ? Modality.TEXT : Modality.AUDIO)) },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          const content = message.serverContent;
          const text = content?.inputTranscription?.text;
          const partial = content?.interimInputTranscription?.text;
          if (text) {
            transcript += text;
            interim = "";
          } else if (partial !== undefined) {
            interim = partial;
          }
          if (text || partial !== undefined) onTranscript(`${transcript} ${interim}`.replace(/\s+/g, " ").trim());
          // The model answering means Gemini has heard the whole request.
          if (finished && (content?.modelTurn || content?.turnComplete || content?.generationComplete || content?.inputTranscription?.finished)) {
            clearTimeout(graceTimer);
            graceTimer = setTimeout(finished, FINISH_GRACE_MS);
          }
        },
        onerror: (event: ErrorEvent) => {
          if (!closedByUs) onError(new Error(event.message || "The voice connection failed."));
        },
        onclose: (event: CloseEvent) => {
          finished?.();
          if (!closedByUs) {
            releaseMicrophone();
            onError(new Error(event.reason || "The voice connection closed."));
          }
        },
      },
    });
    session.sendRealtimeInput({ activityStart: {} });
    for (const data of pending.splice(0)) session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${TARGET_RATE}` } });
  } catch (error) {
    shutdown();
    throw error;
  }

  return {
    async stop() {
      releaseMicrophone();
      void audio?.close().catch(() => undefined);
      const done = new Promise<void>((resolve) => {
        finished = resolve;
        setTimeout(resolve, FINISH_TIMEOUT_MS);
      });
      session?.sendRealtimeInput({ activityEnd: {} });
      await done;
      clearTimeout(graceTimer);
      shutdown();
      return transcript.replace(/\s+/g, " ").trim();
    },
    cancel() {
      clearTimeout(graceTimer);
      shutdown();
    },
  };
}
