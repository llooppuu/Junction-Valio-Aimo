/**
 * The spoken "send" command: a request that ends with "thank you" (or
 * "thanks", or the Finnish "kiitos") is sent as soon as the buyer says it.
 * Both languages are accepted whichever the app is in, since a Finnish chef
 * may well end an English sentence with "kiitos". Only the end of the request
 * counts, so "thank you for the quick delivery last week" mid-sentence does not.
 */
const SEND_PHRASE = /[\s,;:–—-]*\b(?:thank you(?: very much| so much)?|thanks(?: a lot)?|kiitos(?: paljon)?|kiitti)[\s.!?…]*$/iu;

export function endsWithSendPhrase(text: string): boolean {
  return SEND_PHRASE.test(text.trim());
}

/** The request without the closing "thank you", tidied to end like a sentence. */
export function stripSendPhrase(text: string): string {
  return text.trim().replace(SEND_PHRASE, "").replace(/[\s,;:–—-]+$/u, "").trim();
}
