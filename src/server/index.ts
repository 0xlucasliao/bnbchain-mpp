import type { PublicClient } from "viem";
import {
  createBnbChargeServerMethod,
  type BnbChargeServerMethod,
  type ChallengeResult,
  type HttpLikeRequest,
  type ServerChargeConfig,
  type ServerPublicClientAdapter,
  type VerifiedResult,
} from "./Charge.js";

export type { ChallengeResult, ServerPublicClientAdapter, VerifiedResult };

export interface MppxServerMethod {
  handle(req: HttpLikeRequest, params: { amount: string; currency: string }): Promise<unknown>;
}

export interface MppxServerOptions {
  methods: MppxServerMethod[];
}

export class Mppx {
  private constructor(private readonly methods: MppxServerMethod[]) {}

  public static create(options: MppxServerOptions): Mppx {
    return new Mppx(options.methods);
  }

  public charge(params: { amount: string; currency: string }) {
    return async (req: HttpLikeRequest): Promise<unknown> => {
      if (!this.methods[0]) {
        throw new Error("No payment methods were configured");
      }
      return this.methods[0].handle(req, params);
    };
  }
}

export const bnb = {
  charge(
    config: ServerChargeConfig,
    publicClient: PublicClient | ServerPublicClientAdapter,
  ): BnbChargeServerMethod {
    return createBnbChargeServerMethod(
      config,
      publicClient as ServerPublicClientAdapter,
    );
  },
};

export type { ServerChargeConfig };
