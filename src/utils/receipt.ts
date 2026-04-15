import type { ChargeAsset, ChargeChallenge } from "../Methods.js";
import { ZERO_ADDRESS } from "../constants.js";

export interface ReceiptData {
  txHash: string;
  amount: string;
  chainId: number;
  currency?: string;
}

export function resolveCurrencyFromAsset(
  challenge: Pick<ChargeChallenge, "currency" | "asset">,
): string {
  return challenge.currency ?? challenge.asset.symbol;
}

export function buildPaymentReceiptHeader(data: ReceiptData): string {
  const currency = data.currency ?? "";
  const parts = [
    "method=bnb-charge",
    `txHash=${data.txHash}`,
    `amount=${data.amount}`,
    `currency=${currency}`,
    `chainId=${data.chainId}`,
  ];
  return parts.join("; ");
}

export function normalizeAssetAddress(asset: ChargeAsset): string {
  if (asset.kind === "native") {
    return ZERO_ADDRESS;
  }
  return (asset.address ?? ZERO_ADDRESS).toLowerCase();
}
