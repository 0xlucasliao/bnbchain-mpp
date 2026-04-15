export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type SupportedChain = {
  chainId: number;
  name: string;
  defaultRpcUrl: string;
};

export const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    chainId: 56,
    name: "bsc-mainnet",
    defaultRpcUrl: "https://bsc-dataseed.binance.org",
  },
  {
    chainId: 97,
    name: "bsc-testnet",
    defaultRpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
  },
  {
    chainId: 204,
    name: "opbnb-mainnet",
    defaultRpcUrl: "https://opbnb-mainnet-rpc.bnbchain.org",
  },
  {
    chainId: 5611,
    name: "opbnb-testnet",
    defaultRpcUrl: "https://opbnb-testnet-rpc.bnbchain.org",
  },
];

export type SupportedAsset = {
  symbol: string;
  address: `0x${string}` | null;
  decimals: number;
  kind: "native" | "bep20";
};

export const SUPPORTED_MAINNET_ASSETS: SupportedAsset[] = [
  { symbol: "BNB", address: null, decimals: 18, kind: "native" },
  {
    symbol: "USDT",
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
    kind: "bep20",
  },
  {
    symbol: "USDC",
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
    kind: "bep20",
  },
  {
    symbol: "FDUSD",
    address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
    decimals: 18,
    kind: "bep20",
  },
  {
    symbol: "ETH",
    address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    decimals: 18,
    kind: "bep20",
  },
];

export const BNB_MPP_EIP712_DOMAIN = {
  name: "BNB-MPP",
  version: "1",
} as const;

export const ERROR_CODES = {
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",
  NONCE_MISMATCH: "NONCE_MISMATCH",
  CHAIN_MISMATCH: "CHAIN_MISMATCH",
  REPLAY_DETECTED: "REPLAY_DETECTED",
  TX_NOT_FOUND: "TX_NOT_FOUND",
  TX_REVERTED: "TX_REVERTED",
  WRONG_RECIPIENT: "WRONG_RECIPIENT",
  WRONG_TOKEN: "WRONG_TOKEN",
  UNDERPAYMENT: "UNDERPAYMENT",
  SIMULATION_FAILED: "SIMULATION_FAILED",
  INVALID_CREDENTIAL: "INVALID_CREDENTIAL",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ConstantErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
