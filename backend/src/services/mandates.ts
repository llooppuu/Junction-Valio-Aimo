import { createPrivateKey, generateKeyPairSync, sign, verify, createPublicKey, type KeyObject } from "node:crypto";
import type { ProductCategory } from "../schemas/product.js";

/**
 * Buyer-signed mandates: the buyer authorises each agent with a W3C Verifiable
 * Credential in the JWT encoding (VC-JWT), signed with EdDSA over Ed25519. The
 * issuer is a did:key, so anyone can check a mandate from the token alone: the
 * buyer's public key is inside the issuer's DID. The server checks the active
 * mandate on every agent request, refuses anything outside it, and a revoked
 * mandate stops the agent at once.
 *
 * The buyer's key pair is created when the backend starts, as if it lived in
 * the buyer's wallet. Production would keep it with the buyer, not the server.
 */

export interface MandateScope {
  agentId: string;
  agentName: string;
  buyerName: string;
  spendingLimitEurCents: number;
  allowedCategories: ProductCategory[];
}

export interface Mandate extends MandateScope {
  id: string;
  token: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  /** active: in force. superseded: replaced by a newer mandate. revoked: withdrawn by the buyer. */
  status: "active" | "superseded" | "revoked";
  revokedAt?: string;
}

export interface MandateClaims {
  iss: string;
  sub: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
  vc: {
    "@context": string[];
    type: string[];
    credentialSubject: MandateScope & { id: string; currency: "EUR" };
  };
}

export type MandateCheck = { valid: true; claims: MandateClaims } | { valid: false; reason: string; claims?: MandateClaims };

// did:key encoding: multicodec ed25519-pub (0xed 0x01) and the raw key, in base58btc with a "z" prefix.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PUB = [0xed, 0x01];

function base58encode(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function base58decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new Error("not base58");
    value = value * 58n + BigInt(digit);
  }
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const leading = text.length - text.replace(/^1+/, "").length;
  return Uint8Array.from([...new Array(leading).fill(0), ...Buffer.from(value === 0n ? "" : hex, "hex")]);
}

/** The Ed25519 public key inside a did:key, or undefined if it is not one. */
export function publicKeyFromDid(did: string): KeyObject | undefined {
  const match = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)$/.exec(did.split("#")[0] ?? "");
  if (!match) return undefined;
  try {
    const bytes = base58decode(match[1]!);
    if (bytes[0] !== ED25519_PUB[0] || bytes[1] !== ED25519_PUB[1] || bytes.length !== 34) return undefined;
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(bytes.slice(2)).toString("base64url") }, format: "jwk" });
  } catch {
    return undefined;
  }
}

function createBuyerKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return buyerKeysFrom(publicKey, privateKey);
}

function buyerKeysFrom(publicKey: KeyObject, privateKey: KeyObject) {
  const raw = Buffer.from((publicKey.export({ format: "jwk" }) as { x: string }).x, "base64url");
  const did = `did:key:z${base58encode(Uint8Array.from([...ED25519_PUB, ...raw]))}`;
  return { privateKey, did };
}

let buyerKeys: ReturnType<typeof createBuyerKeys> | undefined;
const currentBuyerKeys = () => (buyerKeys ??= createBuyerKeys());

/** The buyer's signing key as PKCS #8 PEM, so saved mandates still verify after a restart. */
export function exportBuyerKey(): string {
  return currentBuyerKeys().privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

/** Issues mandates with a saved key from now on; the buyer's DID follows from it. */
export function importBuyerKey(pem: string) {
  const privateKey = createPrivateKey(pem);
  buyerKeys = buyerKeysFrom(createPublicKey(privateKey), privateKey);
}

/** The buyer's issuer DID, which carries its public key. */
export function buyerDid(): string {
  return currentBuyerKeys().did;
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const DAY = 24 * 60 * 60;

/** Signs a mandate as the buyer. */
export function issueMandate(id: string, scope: MandateScope, validDays: number, now: Date = new Date()): Mandate {
  const { privateKey, did } = currentBuyerKeys();
  const iat = Math.floor(now.getTime() / 1000);
  const subject = `urn:tta:agent:${scope.agentId}`;
  const claims: MandateClaims = {
    iss: did,
    sub: subject,
    jti: `urn:tta:mandate:${id}`,
    iat,
    nbf: iat,
    exp: iat + validDays * DAY,
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "PurchasingMandate"],
      credentialSubject: { id: subject, ...scope, currency: "EUR" },
    },
  };
  const header = { alg: "EdDSA", typ: "JWT", kid: `${did}#${did.slice("did:key:".length)}` };
  const signingInput = `${b64(header)}.${b64(claims)}`;
  const token = `${signingInput}.${sign(null, Buffer.from(signingInput), privateKey).toString("base64url")}`;
  return {
    id,
    token,
    issuer: did,
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    status: "active",
    ...scope,
  };
}

/**
 * Checks a mandate from the token alone: the signature against the key in the
 * issuer's DID, the credential type, and the validity period. Never throws.
 */
export function verifyMandate(token: string, now: Date = new Date()): MandateCheck {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "not a compact JWS with three parts" };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: MandateClaims;
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "the header or payload is not valid JSON" };
  }
  if (header.alg !== "EdDSA") return { valid: false, reason: `unsupported algorithm ${String(header.alg)}`, claims };
  const key = typeof claims.iss === "string" ? publicKeyFromDid(claims.iss) : undefined;
  if (!key) return { valid: false, reason: "the issuer is not an Ed25519 did:key", claims };
  if (!verify(null, Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, "base64url"))) {
    return { valid: false, reason: "the signature does not match the content, so it was changed", claims };
  }
  if (!claims.vc?.type?.includes("PurchasingMandate")) return { valid: false, reason: "not a purchasing mandate", claims };
  const seconds = now.getTime() / 1000;
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) return { valid: false, reason: "not valid yet", claims };
  if (typeof claims.exp !== "number" || claims.exp <= seconds) return { valid: false, reason: `expired at ${new Date((claims.exp ?? 0) * 1000).toISOString()}`, claims };
  return { valid: true, claims };
}

/** The agent's mandate in force, if any. */
export function activeMandate(mandates: Mandate[], agentId: string): Mandate | undefined {
  return mandates.find((mandate) => mandate.agentId === agentId && mandate.status === "active");
}

/**
 * Why an agent may not act right now, or undefined if its mandate holds. A
 * presented mandate (the X-Agent-Mandate header) must be the buyer's current one.
 */
export function mandateProblem(mandates: Mandate[], agentId: string, presented: string | undefined, buyerIssuer: string): string | undefined {
  const mandate = activeMandate(mandates, agentId);
  if (!mandate) {
    const last = mandates.filter((candidate) => candidate.agentId === agentId).at(-1);
    return last?.status === "revoked"
      ? `the buyer revoked mandate ${last.id} at ${last.revokedAt}, so this agent may not act until the buyer issues a new one`
      : "this agent has no mandate from the buyer";
  }
  if (presented && presented !== mandate.token) {
    const other = mandates.find((candidate) => candidate.token === presented);
    return other ? `mandate ${other.id} is ${other.status}; the buyer's current mandate is ${mandate.id}` : "the presented mandate is not one the buyer issued";
  }
  const check = verifyMandate(mandate.token);
  if (!check.valid) return `mandate ${mandate.id} is not valid: ${check.reason}`;
  if (check.claims.iss !== buyerIssuer) return `mandate ${mandate.id} was not issued by the buyer`;
  if (check.claims.sub !== `urn:tta:agent:${agentId}`) return `mandate ${mandate.id} names a different agent`;
  return undefined;
}
