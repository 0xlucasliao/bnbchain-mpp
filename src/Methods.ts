import { z } from "zod";

export const BNB_CHARGE_METHOD = "bnb-charge" as const;

export const hexStringSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "Expected a 0x-prefixed hex string");

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte hex value");

export const txHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a transaction hash");

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected a 20-byte hex address");

export const amountSchema = z
  .string()
  .regex(/^\d+$/, "Expected integer amount encoded as string");

export const assetKindSchema = z.enum(["native", "bep20"]);

export const assetSchema = z.object({
  kind: assetKindSchema,
  address: addressSchema.optional(),
  decimals: z.number().int().min(0).max(36),
  symbol: z.string().min(1),
}).superRefine((asset, ctx) => {
  if (asset.kind === "bep20" && !asset.address) {
    ctx.addIssue({
      code: "custom",
      message: "BEP-20 assets require an address",
      path: ["address"],
    });
  }
});

export const challengePayloadSchema = z.object({
  method: z.literal(BNB_CHARGE_METHOD),
  recipient: addressSchema,
  amount: amountSchema,
  currency: z.string().min(1),
  asset: assetSchema,
  chainId: z.number().int().positive(),
  serverNonce: bytes32Schema,
  expiresAt: z.number().int().positive(),
  feeSponsor: z.boolean(),
  rpcUrl: z.string().url(),
});

export const credentialPayloadSchema = z.object({
  method: z.literal(BNB_CHARGE_METHOD),
  txHash: txHashSchema.optional(),
  signedAuth: hexStringSchema.optional(),
  from: addressSchema,
  serverNonce: bytes32Schema,
  chainId: z.number().int().positive(),
}).superRefine((credential, ctx) => {
  if (!credential.txHash && !credential.signedAuth) {
    ctx.addIssue({
      code: "custom",
      message: "Either txHash or signedAuth must be provided",
      path: ["txHash"],
    });
  }
});

export const chargeAuthorizationSchema = z.object({
  from: addressSchema,
  to: addressSchema,
  amount: amountSchema,
  serverNonce: bytes32Schema,
  deadline: z.number().int().positive(),
});

export type Asset = z.infer<typeof assetSchema>;
export type ChargeAsset = Asset;
export type ChallengePayload = z.infer<typeof challengePayloadSchema>;
export type ChargeChallenge = ChallengePayload;
export type CredentialPayload = z.infer<typeof credentialPayloadSchema>;
export type ChargeCredential = CredentialPayload;
export type ChargeAuthorization = z.infer<typeof chargeAuthorizationSchema>;

export type ErrorCode =
  | "CHALLENGE_EXPIRED"
  | "NONCE_MISMATCH"
  | "CHAIN_MISMATCH"
  | "REPLAY_DETECTED"
  | "TX_NOT_FOUND"
  | "TX_REVERTED"
  | "WRONG_RECIPIENT"
  | "WRONG_TOKEN"
  | "UNDERPAYMENT"
  | "SIMULATION_FAILED"
  | "INVALID_CREDENTIAL"
  | "INTERNAL_ERROR";

export interface PaymentError {
  code: ErrorCode;
  message: string;
}
