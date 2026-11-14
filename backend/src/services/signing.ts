import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

/**
 * Signed offers: the server signs what it claims about a product or a quote as
 * a compact JWS (RFC 7515) with EdDSA over Ed25519 (RFC 8037). The public key
 * is published as a JWK Set, so any agent can check a claim on price, stock,
 * or origin without trusting us manually or calling us back.
 *
 * The key pair is created when the backend starts, so a restart invalidates
 * earlier tokens. That is fine for a demo; production would load a managed key.
 */

const ISSUER = "trusted-trade-agents";

export interface SignedClaims {
  iss: string;
  /** What the claim is about, for example "product:milk-lf-northlake-10l" or "quote:Q-0001". */
  sub: string;
  /** Issued at and expires at, in seconds since the epoch, as in JWT. */
  iat: number;
  exp: number;
  [claim: string]: unknown;
}

export interface SignedOffer {
  token: string;
  issuedAt: string;
  expiresAt: string;
}

export type VerifyResult =
  | { valid: true; claims: SignedClaims }
  | { valid: false; reason: string; claims?: SignedClaims };

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

function createKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string };
  // RFC 7638 thumbprint: the required members in lexicographic order.
  const kid = base64url(createHash("sha256").update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest());
  return { publicKey, privateKey, kid, jwk: { ...jwk, kid, alg: "EdDSA", use: "sig" } };
}

let keys: { publicKey: KeyObject; privateKey: KeyObject; kid: string; jwk: Record<string, string> } | undefined;
const currentKeys = () => (keys ??= createKeys());

/** The public JWK Set for /.well-known/jwks.json. */
export function jwks() {
  return { keys: [currentKeys().jwk] };
}

/** Signs claims about a subject, valid for ttlSeconds from now. */
export function signClaims(
  subject: string,
  claims: Record<string, unknown>,
  ttlSeconds: number,
  now: Date = new Date(),
): SignedOffer {
  const { privateKey, kid } = currentKeys();
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SignedClaims = { iss: ISSUER, sub: subject, iat, exp: iat + ttlSeconds, ...claims };
  const header = { alg: "EdDSA", typ: "JWT", kid };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign(null, Buffer.from(signingInput), privateKey);
  return {
    token: `${signingInput}.${base64url(signature)}`,
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: new Date((iat + ttlSeconds) * 1000).toISOString(),
  };
}

/** Checks a token's signature, issuer, and expiry, and returns its claims. Never throws. */
export function verifyToken(token: string, now: Date = new Date()): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "not a compact JWS with three parts" };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: SignedClaims;
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "the header or payload is not valid JSON" };
  }

  const { publicKey, kid } = currentKeys();
  if (header.alg !== "EdDSA") return { valid: false, reason: `unsupported algorithm ${String(header.alg)}`, claims };
  if (header.kid !== kid) return { valid: false, reason: "signed with an unknown key", claims };
  const signatureValid = verify(
    null,
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    Buffer.from(signaturePart, "base64url"),
  );
  if (!signatureValid) return { valid: false, reason: "the signature does not match the content, so it was changed", claims };
  if (claims.iss !== ISSUER) return { valid: false, reason: "issued by someone else", claims };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now.getTime()) {
    return { valid: false, reason: `expired at ${new Date((claims.exp ?? 0) * 1000).toISOString()}`, claims };
  }
  return { valid: true, claims };
}
