import { randomBytes } from "node:crypto";
import { decodeEventLog, parseAbiItem, type Hex } from "viem";
import {
  BNB_CHARGE_METHOD,
  challengePayloadSchema,
  credentialPayloadSchema,
  type ChargeAsset,
  type ChargeChallenge,
  type ChargeCredential,
  type PaymentError,
} from "../Methods.js";
import { buildWwwAuthenticateHeader, parseAuthorizationHeader } from "../utils/httpAuth.js";
import { buildPaymentReceiptHeader } from "../utils/receipt.js";
import { InMemoryStore, type ConsumedStore, type TxMeta } from "../utils/replay.js";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55aebf4eecb3f" as const;

export interface ServerPublicClientAdapter {
  getTransaction(args: { hash: Hex }): Promise<{
    to: `0x${string}` | null;
    value: bigint;
  }>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{
    status: "success" | "reverted";
    logs: Array<{
      address: `0x${string}`;
      topics: Hex[];
      data: Hex;
    }>;
    blockNumber: bigint;
  }>;
  getBlockNumber(): Promise<bigint>;
}

export interface ServerChargeConfig {
  recipient: `0x${string}`;
  asset: ChargeAsset;
  rpcUrl: string;
  chainId: number;
  confirmations?: number;
  nonceTtlSeconds?: number;
  store?: ConsumedStore;
  now?: () => number;
}

export interface HttpLikeRequest {
  headers: Record<string, string | undefined>;
}

export type ChallengeResult = {
  status: 402;
  challenge: ChargeChallenge;
  headers: Record<string, string>;
  error?: PaymentError;
};

export type VerifiedResult = {
  status: 200;
  receiptHeader: string;
  withReceipt<T extends { setHeader(name: string, value: string): unknown }>(
    response: T,
  ): T;
};

type NonceRecord = {
  challenge: ChargeChallenge;
};

export class BnbChargeServerMethod {
  private readonly store: ConsumedStore;
  private readonly nonceMap = new Map<string, NonceRecord>();
  private readonly ttlSeconds: number;
  private readonly confirmations: number;
  private readonly now: () => number;

  public constructor(
    private readonly config: ServerChargeConfig,
    private readonly rpcClient: ServerPublicClientAdapter,
  ) {
    this.store = config.store ?? new InMemoryStore();
    this.ttlSeconds = config.nonceTtlSeconds ?? 120;
    this.confirmations = config.confirmations ?? 1;
    this.now = config.now ?? (() => Date.now());
  }

  public createChallenge(amount: string, currency: string): ChargeChallenge {
    const now = this.now();
    const challenge = challengePayloadSchema.parse({
      method: BNB_CHARGE_METHOD,
      recipient: this.config.recipient,
      amount,
      currency,
      asset: this.config.asset,
      chainId: this.config.chainId,
      serverNonce: `0x${randomBytes(32).toString("hex")}`,
      expiresAt: now + this.ttlSeconds * 1000,
      feeSponsor: false,
      rpcUrl: this.config.rpcUrl,
    });
    this.nonceMap.set(challenge.serverNonce.toLowerCase(), { challenge });
    return challenge;
  }

  public async handle(
    req: HttpLikeRequest,
    params: { amount: string; currency: string },
  ): Promise<ChallengeResult | VerifiedResult> {
    const authorizationHeader = req.headers.authorization;
    if (!authorizationHeader) {
      return this.challengeResult(params.amount, params.currency);
    }

    let authorization: unknown;
    try {
      authorization = parseAuthorizationHeader(authorizationHeader);
    } catch {
      return this.challengeResult(params.amount, params.currency, {
        code: "INVALID_CREDENTIAL",
        message: "Authorization header format is invalid",
      });
    }

    const parsed = credentialPayloadSchema.safeParse(authorization);
    if (!parsed.success) {
      return this.challengeResult(params.amount, params.currency, {
        code: "INVALID_CREDENTIAL",
        message: parsed.error.issues.map((issue) => issue.message).join(", "),
      });
    }

    const credential = parsed.data;
    const nonceRecord = this.nonceMap.get(credential.serverNonce.toLowerCase());
    if (!nonceRecord) {
      return this.challengeResult(params.amount, params.currency, {
        code: "NONCE_MISMATCH",
        message: "Unknown challenge nonce",
      });
    }

    const challenge = nonceRecord.challenge;
    if (credential.chainId !== this.config.chainId) {
      return this.challengeResult(params.amount, params.currency, {
        code: "CHAIN_MISMATCH",
        message: "Credential was signed for a different chain",
      });
    }

    if (credential.serverNonce.toLowerCase() !== challenge.serverNonce.toLowerCase()) {
      return this.challengeResult(params.amount, params.currency, {
        code: "NONCE_MISMATCH",
        message: "Nonce mismatch",
      });
    }

    if (this.now() > challenge.expiresAt + 30_000) {
      return this.challengeResult(params.amount, params.currency, {
        code: "CHALLENGE_EXPIRED",
        message: "Challenge has expired",
      });
    }

    return this.verifyOnchainCredential(credential, challenge);
  }

  private async verifyOnchainCredential(
    credential: ChargeCredential,
    challenge: ChargeChallenge,
  ): Promise<ChallengeResult | VerifiedResult> {
    if (!credential.txHash) {
      return this.challengeResult(challenge.amount, challenge.currency, {
        code: "INVALID_CREDENTIAL",
        message: "txHash is required for charge credential",
      });
    }

    const txHash = credential.txHash.toLowerCase();
    if (await this.store.has(txHash)) {
      return this.challengeResult(challenge.amount, challenge.currency, {
        code: "REPLAY_DETECTED",
        message: "Transaction hash already consumed",
      });
    }

    const [tx, receipt] = await Promise.all([
      this.rpcClient.getTransaction({ hash: txHash as Hex }).catch(() => null),
      this.rpcClient.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null),
    ]);

    if (!tx || !receipt) {
      return this.challengeResult(challenge.amount, challenge.currency, {
        code: "TX_NOT_FOUND",
        message: "Transaction not found",
      });
    }

    if (receipt.status !== "success") {
      return this.challengeResult(challenge.amount, challenge.currency, {
        code: "TX_REVERTED",
        message: "Transaction reverted",
      });
    }

    const latestBlock = await this.rpcClient.getBlockNumber();
    if (latestBlock - receipt.blockNumber + 1n < BigInt(this.confirmations)) {
      return this.challengeResult(challenge.amount, challenge.currency, {
        code: "TX_NOT_FOUND",
        message: "Transaction has insufficient confirmations",
      });
    }

    if (challenge.asset.kind === "native") {
      if (!tx.to || tx.to.toLowerCase() !== this.config.recipient.toLowerCase()) {
        return this.challengeResult(challenge.amount, challenge.currency, {
          code: "WRONG_RECIPIENT",
          message: "Native transfer recipient mismatch",
        });
      }
      if (tx.value < BigInt(challenge.amount)) {
        return this.challengeResult(challenge.amount, challenge.currency, {
          code: "UNDERPAYMENT",
          message: "Native transfer is under required amount",
        });
      }
    } else {
      const tokenAddress = challenge.asset.address!.toLowerCase();
      const transferLog = receipt.logs.find(
        (log) => log.address.toLowerCase() === tokenAddress && log.topics[0] === TRANSFER_TOPIC,
      );
      if (!transferLog) {
        return this.challengeResult(challenge.amount, challenge.currency, {
          code: "WRONG_TOKEN",
          message: "No matching token transfer log found",
        });
      }

      const decoded = decodeEventLog({
        abi: [transferEvent],
        topics: transferLog.topics as [Hex, ...Hex[]],
        data: transferLog.data,
      });
      const args = decoded.args as {
        from: `0x${string}`;
        to: `0x${string}`;
        value: bigint;
      };

      if (args.to.toLowerCase() !== this.config.recipient.toLowerCase()) {
        return this.challengeResult(challenge.amount, challenge.currency, {
          code: "WRONG_RECIPIENT",
          message: "Token transfer recipient mismatch",
        });
      }
      if (args.from.toLowerCase() !== credential.from.toLowerCase()) {
        return this.challengeResult(challenge.amount, challenge.currency, {
          code: "INVALID_CREDENTIAL",
          message: "Credential from does not match transfer sender",
        });
      }
      if (args.value < BigInt(challenge.amount)) {
        return this.challengeResult(challenge.amount, challenge.currency, {
          code: "UNDERPAYMENT",
          message: "Token transfer is under required amount",
        });
      }
    }

    await this.consumeTx(txHash, credential, challenge);
    return this.verifiedResult(txHash, challenge.amount, challenge.currency);
  }

  private async consumeTx(
    txHash: string,
    credential: ChargeCredential,
    challenge: ChargeChallenge,
  ): Promise<void> {
    const meta: TxMeta = {
      from: credential.from,
      to: this.config.recipient,
      amount: challenge.amount,
      currency: challenge.currency,
      chainId: challenge.chainId,
      consumedAt: this.now(),
    };
    await this.store.add(txHash, meta);
  }

  private challengeResult(
    amount: string,
    currency: string,
    error?: PaymentError,
  ): ChallengeResult {
    const challenge = this.createChallenge(amount, currency);
    return {
      status: 402,
      challenge,
      headers: {
        "WWW-Authenticate": buildWwwAuthenticateHeader(challenge),
      },
      error,
    };
  }

  private verifiedResult(txHash: string, amount: string, currency: string): VerifiedResult {
    const receiptHeader = buildPaymentReceiptHeader({
      txHash,
      amount,
      currency,
      chainId: this.config.chainId,
    });
    return {
      status: 200,
      receiptHeader,
      withReceipt<T extends { setHeader(name: string, value: string): unknown }>(response: T): T {
        response.setHeader("Payment-Receipt", receiptHeader);
        return response;
      },
    };
  }
}

export function createBnbChargeServerMethod(
  config: ServerChargeConfig,
  rpcClient: ServerPublicClientAdapter,
): BnbChargeServerMethod {
  return new BnbChargeServerMethod(config, rpcClient);
}
