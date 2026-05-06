import canonicalize from "canonicalize";
import {
  BNB_CHARGE_METHOD,
  challengePayloadSchema,
  type ChargeChallenge,
} from "../Methods.js";

export const PAYMENT_SCHEME = "Payment";
export const PAYMENT_METHOD_BNB = "bnb";
export const PAYMENT_INTENT_CHARGE = "charge";

/** UTF-8 → base64 (browser-safe). */
function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

export function toBase64UrlNoPad(value: string): string {
  return utf8ToBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(padLength)}`;
  return base64ToUtf8(padded);
}

export function jcsCanonicalJson(value: unknown): string {
  const s = canonicalize(value);
  if (typeof s !== "string") {
    throw new Error("JCS canonicalization failed");
  }
  return s;
}

export function chargeChallengeToRequestB64(challenge: ChargeChallenge): string {
  return toBase64UrlNoPad(jcsCanonicalJson(challenge));
}

export function requestB64ToChargeChallenge(requestB64: string): ChargeChallenge {
  const json = JSON.parse(fromBase64Url(requestB64)) as unknown;
  return challengePayloadSchema.parse(json);
}

export type PaymentChallengeWire = {
  id: string;
  realm: string;
  method: string;
  intent: string;
  request: string;
  expires?: string;
};

export type PaymentClientChallenge = {
  inner: ChargeChallenge;
  wire: PaymentChallengeWire;
};

function escapeQuotes(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function quoteIfNeeded(s: string): string {
  if (/^[a-zA-Z0-9._~:-]+$/.test(s) && !s.includes(" ") && s.length < 2000) {
    return s;
  }
  return `"${escapeQuotes(s)}"`;
}

export function buildPaymentWwwAuthenticateHeader(wire: PaymentChallengeWire): string {
  const parts = [
    `${PAYMENT_SCHEME} id=${quoteIfNeeded(wire.id)}`,
    `realm=${quoteIfNeeded(wire.realm)}`,
    `method=${quoteIfNeeded(wire.method)}`,
    `intent=${quoteIfNeeded(wire.intent)}`,
    `request=${quoteIfNeeded(wire.request)}`,
  ];
  if (wire.expires !== undefined) {
    parts.push(`expires=${quoteIfNeeded(wire.expires)}`);
  }
  return parts.join(", ");
}

function skipWsComma(s: string, i: number): number {
  let j = i;
  while (j < s.length && (s[j] === " " || s[j] === "\t" || s[j] === ",")) j++;
  return j;
}

/** Parse `Payment` auth-params (RFC9110-style). */
export function parsePaymentAuthParams(headerValue: string): Record<string, string> {
  const trimmed = headerValue.trim();
  const schemeMatch = /^Payment\s+/i.exec(trimmed);
  if (!schemeMatch) {
    throw new Error("Expected WWW-Authenticate Payment scheme");
  }
  let i = schemeMatch[0].length;
  const out: Record<string, string> = {};
  while (i < trimmed.length) {
    i = skipWsComma(trimmed, i);
    if (i >= trimmed.length) break;
    const eq = trimmed.indexOf("=", i);
    if (eq < 0) break;
    const name = trimmed.slice(i, eq).trim();
    let j = eq + 1;
    j = skipWsComma(trimmed, j);
    if (j >= trimmed.length) break;
    let value: string;
    if (trimmed[j] === '"') {
      j++;
      let v = "";
      while (j < trimmed.length) {
        const c = trimmed[j];
        if (c === "\\") {
          j++;
          if (j < trimmed.length) v += trimmed[j];
          j++;
          continue;
        }
        if (c === '"') {
          j++;
          break;
        }
        v += c;
        j++;
      }
      value = v;
    } else {
      const start = j;
      while (j < trimmed.length && !/[\s,]/.test(trimmed[j]!)) j++;
      value = trimmed.slice(start, j);
    }
    out[name] = value;
    i = j;
  }
  return out;
}

export function parsePaymentChallengeFromWwwAuthenticate(headerValue: string): PaymentClientChallenge {
  const p = parsePaymentAuthParams(headerValue);
  const id = p.id;
  const realm = p.realm;
  const method = p.method;
  const intent = p.intent;
  const request = p.request;
  const expires = p.expires;
  if (!id || !realm || !method || !intent || !request) {
    throw new Error("Missing required Payment challenge parameter");
  }
  const inner = requestB64ToChargeChallenge(request);
  return {
    inner,
    wire: { id, realm, method, intent, request, expires },
  };
}

export type PaymentHashPayload = {
  type: "hash";
  hash: `0x${string}`;
  /** Payer address (required for BEP-20 verification; native uses tx sender). */
  from: `0x${string}`;
};

export type PaymentBnbSponsorPayload = {
  type: "bnb-sponsor";
  signedAuth: `0x${string}`;
  from: `0x${string}`;
};

export type PaymentCredentialEnvelope = {
  challenge: PaymentChallengeWire;
  payload: PaymentHashPayload | PaymentBnbSponsorPayload;
  source?: string;
};

export function buildPaymentAuthorizationHeader(envelope: PaymentCredentialEnvelope): string {
  const json = jcsCanonicalJson(envelope);
  return `${PAYMENT_SCHEME} ${toBase64UrlNoPad(json)}`;
}

export function parsePaymentAuthorizationHeader(headerValue: string): PaymentCredentialEnvelope {
  const trimmed = headerValue.trim();
  const m = /^Payment\s+(\S+)$/i.exec(trimmed);
  if (!m) {
    throw new Error("Expected Authorization Payment scheme with base64url credential");
  }
  const json = fromBase64Url(m[1]!);
  const raw = JSON.parse(json) as unknown;
  return parsePaymentCredentialEnvelope(raw);
}

export function parsePaymentCredentialEnvelope(raw: unknown): PaymentCredentialEnvelope {
  const o = raw as Record<string, unknown>;
  const ch = o.challenge as Record<string, unknown>;
  const pl = o.payload as Record<string, unknown>;
  if (!ch || !pl) {
    throw new Error("Invalid Payment credential: missing challenge or payload");
  }
  const wire: PaymentChallengeWire = {
    id: String(ch.id),
    realm: String(ch.realm),
    method: String(ch.method),
    intent: String(ch.intent),
    request: String(ch.request),
    expires: ch.expires !== undefined ? String(ch.expires) : undefined,
  };
  const t = String(pl.type);
  if (t === "hash") {
    return {
      challenge: wire,
      payload: {
        type: "hash",
        hash: String(pl.hash) as `0x${string}`,
        from: String(pl.from) as `0x${string}`,
      },
      ...(o.source !== undefined ? { source: String(o.source) } : {}),
    };
  }
  if (t === "bnb-sponsor") {
    return {
      challenge: wire,
      payload: {
        type: "bnb-sponsor",
        signedAuth: String(pl.signedAuth) as `0x${string}`,
        from: String(pl.from) as `0x${string}`,
      },
      ...(o.source !== undefined ? { source: String(o.source) } : {}),
    };
  }
  throw new Error(`Unsupported Payment payload type: ${t}`);
}

export function paymentCredentialToLegacyFields(
  envelope: PaymentCredentialEnvelope,
): { from: `0x${string}`; txHash?: `0x${string}`; signedAuth?: `0x${string}`; serverNonce: string; chainId: number } {
  const inner = requestB64ToChargeChallenge(envelope.challenge.request);
  if (envelope.payload.type === "hash") {
    return {
      from: envelope.payload.from,
      txHash: envelope.payload.hash,
      serverNonce: inner.serverNonce,
      chainId: inner.chainId,
    };
  }
  return {
    from: envelope.payload.from,
    signedAuth: envelope.payload.signedAuth,
    serverNonce: inner.serverNonce,
    chainId: inner.chainId,
  };
}

export function newPaymentChallengeId(): string {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `b${hex}`;
}

export function challengeExpiresToRfc3339(expiresAtMs: number): string {
  return new Date(expiresAtMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Parse `Payment` WWW-Authenticate into client challenge view. */
export function parseWwwAuthenticateHeader(headerValue: string): PaymentClientChallenge {
  return parsePaymentChallengeFromWwwAuthenticate(headerValue);
}

export function parseAuthorizationHeader(value: string): PaymentCredentialEnvelope {
  return parsePaymentAuthorizationHeader(value);
}

export function encodeAuthorizationCredential(envelope: PaymentCredentialEnvelope): string {
  return buildPaymentAuthorizationHeader(envelope);
}

export function toWwwAuthenticateHeader(wire: PaymentChallengeWire): string {
  return buildPaymentWwwAuthenticateHeader(wire);
}

export function decodeWwwAuthenticatePayload(headerValue: string): PaymentClientChallenge {
  return parsePaymentChallengeFromWwwAuthenticate(headerValue);
}
