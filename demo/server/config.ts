import { SUPPORTED_CHAINS } from "@bnb/mpp";

/** Default recipient for testnet demos (any valid address; override with DEMO_RECIPIENT). */
export const DEFAULT_DEMO_RECIPIENT =
  (process.env.DEMO_RECIPIENT as `0x${string}` | undefined) ??
  ("0x1111111111111111111111111111111111111111" as const);

export function getRpcUrl(chainId: number): string {
  const fromEnv = process.env[`RPC_URL_${chainId}`];
  if (fromEnv) return fromEnv;
  const row = SUPPORTED_CHAINS.find((c) => c.chainId === chainId);
  if (!row) {
    throw new Error(`Unsupported chainId ${chainId} — set RPC_URL_${chainId}`);
  }
  return row.defaultRpcUrl;
}
