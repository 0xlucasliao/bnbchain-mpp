const AUTH_SCHEME = "MPP";

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(padLength)}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

export function getHeaderValue(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }

  return undefined;
}

export function buildWwwAuthenticateHeader(challenge: unknown): string {
  const payload = toBase64Url(JSON.stringify(challenge));
  return `${AUTH_SCHEME} challenge="${payload}"`;
}

export function parseWwwAuthenticateHeader(value: string): unknown {
  const match = value.match(/^MPP\s+challenge="([^"]+)"$/i);
  if (!match) {
    throw new Error("Unsupported WWW-Authenticate header format");
  }

  return JSON.parse(fromBase64Url(match[1]));
}

export function buildAuthorizationHeader(credential: unknown): string {
  const payload = toBase64Url(JSON.stringify(credential));
  return `${AUTH_SCHEME} credential="${payload}"`;
}

export function parseAuthorizationHeader(value: string): unknown {
  const match = value.match(/^MPP\s+credential="([^"]+)"$/i);
  if (!match) {
    throw new Error("Unsupported Authorization header format");
  }

  return JSON.parse(fromBase64Url(match[1]));
}

export function toWwwAuthenticateHeader(challenge: unknown): string {
  return buildWwwAuthenticateHeader(challenge);
}

export function decodeWwwAuthenticatePayload(value: string): unknown {
  return parseWwwAuthenticateHeader(value);
}

export function encodeAuthorizationCredential(credential: unknown): string {
  return buildAuthorizationHeader(credential);
}

export function parsePaymentAuthHeader(value: string): unknown {
  return parseAuthorizationHeader(value);
}

