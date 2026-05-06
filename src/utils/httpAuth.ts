export {
  buildPaymentAuthorizationHeader,
  buildPaymentWwwAuthenticateHeader,
  chargeChallengeToRequestB64,
  challengeExpiresToRfc3339,
  decodeWwwAuthenticatePayload,
  encodeAuthorizationCredential,
  fromBase64Url,
  jcsCanonicalJson,
  newPaymentChallengeId,
  parseAuthorizationHeader,
  parsePaymentAuthParams,
  parsePaymentAuthorizationHeader,
  parsePaymentChallengeFromWwwAuthenticate,
  parsePaymentCredentialEnvelope,
  parseWwwAuthenticateHeader,
  PAYMENT_INTENT_CHARGE,
  PAYMENT_METHOD_BNB,
  PAYMENT_SCHEME,
  paymentCredentialToLegacyFields,
  requestB64ToChargeChallenge,
  toBase64UrlNoPad,
  toWwwAuthenticateHeader,
  type PaymentChallengeWire,
  type PaymentClientChallenge,
  type PaymentCredentialEnvelope,
} from "./paymentHttp.js";

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
