import { encodeFunctionData, type Hex } from "viem";
import { BNB_CHARGE_METHOD, challengePayloadSchema, type ChargeChallenge } from "../Methods.js";
import { BNB_MPP_EIP712_DOMAIN, ZERO_ADDRESS } from "../constants.js";
import {
  encodeAuthorizationCredential,
  parseAuthorizationHeader,
  parseWwwAuthenticateHeader,
} from "../utils/httpAuth.js";
import type { PaymentClientChallenge } from "../utils/paymentHttp.js";
import { simulateCall } from "../utils/simulate.js";

const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

const authorizationTypes = {
  ChargeAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "serverNonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface ClientWalletAdapter {
  account: { address: `0x${string}` };
  sendTransaction(args: {
    to: `0x${string}`;
    data?: Hex;
    value?: bigint;
  }): Promise<Hex>;
  signTypedData?(args: {
    domain: {
      name: string;
      version: string;
      chainId: number | bigint;
      verifyingContract: `0x${string}`;
    };
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

export interface ClientPublicAdapter {
  call(args: {
    account?: unknown;
    to?: `0x${string}` | null;
    data?: Hex;
    value?: bigint;
  }): Promise<unknown>;
}

export interface BnbClientChargeConfig {
  signer: ClientWalletAdapter;
  publicClient: ClientPublicAdapter;
  rpcUrl?: string;
  maxAmount?: string;
  acceptedCurrencies?: string[];
  /**
   * If set, called after a payment tx is broadcast so the client can wait for inclusion
   * before returning the Authorization header (avoids server `TX_NOT_FOUND` races).
   */
  waitForTransactionReceipt?(args: { hash: Hex }): Promise<void>;
}

export class BnbClientChargeMethod {
  public constructor(private readonly config: BnbClientChargeConfig) {}

  private async waitIfConfigured(txHash: Hex): Promise<void> {
    const w = this.config.waitForTransactionReceipt;
    if (w) {
      await w({ hash: txHash });
    }
  }

  public async handleChallenge(challengeInput: unknown): Promise<string> {
    let payment: PaymentClientChallenge | undefined;
    let challenge: ChargeChallenge;
    if (
      challengeInput !== null &&
      typeof challengeInput === "object" &&
      "inner" in challengeInput &&
      "wire" in challengeInput
    ) {
      payment = challengeInput as PaymentClientChallenge;
      challenge = payment.inner;
    } else {
      challenge = challengePayloadSchema.parse(challengeInput);
    }

    this.enforceClientGuards(challenge);

    if (challenge.feeSponsor) {
      if (!this.config.signer.signTypedData) {
        throw new Error("Fee-sponsored flow requires signer.signTypedData");
      }

      const signedAuth = await this.config.signer.signTypedData({
        domain: {
          ...BNB_MPP_EIP712_DOMAIN,
          chainId: challenge.chainId,
          verifyingContract:
            challenge.asset.kind === "native"
              ? (ZERO_ADDRESS as `0x${string}`)
              : (challenge.asset.address as `0x${string}`),
        },
        types: authorizationTypes,
        primaryType: "ChargeAuthorization",
        message: {
          from: this.config.signer.account.address,
          to: challenge.recipient as `0x${string}`,
          amount: BigInt(challenge.amount),
          serverNonce: challenge.serverNonce,
          deadline: BigInt(challenge.expiresAt),
        },
      });

      if (!payment) {
        throw new Error("Fee sponsor flow requires a Payment challenge (parse WWW-Authenticate via parseWwwAuthenticateHeader)");
      }
      return encodeAuthorizationCredential({
        challenge: payment.wire,
        payload: {
          type: "bnb-sponsor",
          signedAuth,
          from: this.config.signer.account.address,
        },
      });
    }

    if (challenge.asset.kind === "native") {
      await simulateCall(this.config.publicClient, {
        from: this.config.signer.account.address,
        to: challenge.recipient as `0x${string}`,
        value: BigInt(challenge.amount),
      });

      const txHash = await this.config.signer.sendTransaction({
        to: challenge.recipient as `0x${string}`,
        value: BigInt(challenge.amount),
      });

      await this.waitIfConfigured(txHash);

      if (!payment) {
        throw new Error("Client broadcast flow requires a Payment challenge (parse WWW-Authenticate via parseWwwAuthenticateHeader)");
      }
      return encodeAuthorizationCredential({
        challenge: payment.wire,
        payload: {
          type: "hash",
          hash: txHash,
          from: this.config.signer.account.address,
        },
      });
    }

    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [challenge.recipient as `0x${string}`, BigInt(challenge.amount)],
    });

    await simulateCall(this.config.publicClient, {
      from: this.config.signer.account.address,
      to: challenge.asset.address as `0x${string}`,
      data: transferData,
    });

    const txHash = await this.config.signer.sendTransaction({
      to: challenge.asset.address as `0x${string}`,
      data: transferData,
    });

    await this.waitIfConfigured(txHash);

    if (!payment) {
      throw new Error("Client broadcast flow requires a Payment challenge (parse WWW-Authenticate via parseWwwAuthenticateHeader)");
    }
    return encodeAuthorizationCredential({
      challenge: payment.wire,
      payload: {
        type: "hash",
        hash: txHash,
        from: this.config.signer.account.address,
      },
    });
  }

  public async fetchWithPayment(
    input: RequestInfo | URL,
    init?: RequestInit,
    fetchImpl: typeof fetch = fetch,
  ): Promise<Response> {
    const first = await fetchImpl(input, init);
    if (first.status !== 402) {
      return first;
    }

    const header =
      first.headers.get("WWW-Authenticate") ?? first.headers.get("www-authenticate");
    if (!header) {
      throw new Error("402 response missing WWW-Authenticate header");
    }

    const paymentChallenge = parseWwwAuthenticateHeader(header);
    const authorization = await this.handleChallenge(paymentChallenge);

    const headers = new Headers(init?.headers);
    headers.set("Authorization", authorization);

    return fetchImpl(input, {
      ...init,
      headers,
    });
  }

  public parseAuthorizationHeaderValue(authorization: string) {
    return parseAuthorizationHeader(authorization);
  }

  private enforceClientGuards(challenge: ChargeChallenge): void {
    if (
      this.config.acceptedCurrencies &&
      !this.config.acceptedCurrencies.includes(challenge.currency)
    ) {
      throw new Error(`Currency ${challenge.currency} is not in acceptedCurrencies`);
    }

    if (this.config.maxAmount && BigInt(challenge.amount) > BigInt(this.config.maxAmount)) {
      throw new Error(`Amount ${challenge.amount} exceeds configured maxAmount`);
    }
  }
}

export interface ClientMethodLike {
  fetchWithPayment(
    input: RequestInfo | URL,
    init?: RequestInit,
    fetchImpl?: typeof fetch,
  ): Promise<Response>;
}

export interface MppxClientOptions {
  methods: ClientMethodLike[];
}

export class Mppx {
  private constructor(private readonly methods: ClientMethodLike[]) {}

  public static create(options: MppxClientOptions): Mppx {
    return new Mppx(options.methods);
  }

  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!this.methods[0]) {
      throw new Error("No payment methods were configured");
    }
    return this.methods[0].fetchWithPayment(input, init, fetch);
  }
}

export const bnb = {
  charge(config: BnbClientChargeConfig): BnbClientChargeMethod {
    return new BnbClientChargeMethod(config);
  },
};
