import type { ChargeChallenge } from "../Methods.js";
import { ZERO_ADDRESS } from "../constants.js";
import { jcsCanonicalJson, toBase64UrlNoPad } from "./paymentHttp.js";

export interface ReceiptData {
  txHash: string;
  amount: string;
  chainId: number;
  currency?: string;
  /** IANA-style method id on the wire (`bnb`); see README. */
  paymentMethod?: string;
  /** `id` from `WWW-Authenticate: Payment` (draft-httpauth-payment). */
  challengeId?: string;
}

export function resolveCurrencyFromAsset(
  challenge: Pick<ChargeChallenge, "currency" | "asset">,
): string {
  return challenge.currency ?? challenge.asset.symbol;
}

/**
 * Payment-Receipt header per draft-httpauth-payment §5.3 (base64url JSON, no padding).
 * Adds draft-evm-charge §7.6 fields `challengeId` and `chainId` where applicable.
 */
export function buildPaymentReceiptHeader(data: ReceiptData): string {
  const body: Record<string, unknown> = {
    status: "success",
    method: data.paymentMethod ?? "bnb",
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    reference: data.txHash,
    chainId: data.chainId,
  };
  if (data.challengeId !== undefined) {
    body.challengeId = data.challengeId;
  }
  if (data.currency !== undefined && data.currency !== "") {
    body.currency = data.currency;
  }
  body.amount = data.amount;
  return toBase64UrlNoPad(jcsCanonicalJson(body));
}

export function normalizeAssetAddress(asset: ChargeChallenge["asset"]): string {
  if (asset.kind === "native") {
    return ZERO_ADDRESS;
  }
  return (asset.address ?? ZERO_ADDRESS).toLowerCase();
}
