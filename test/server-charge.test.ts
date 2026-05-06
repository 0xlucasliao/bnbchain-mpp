import { describe, expect, it } from "vitest";
import { bnb } from "../src/server/index.js";
import { InMemoryStore } from "../src/utils/replay.js";
import {
  encodeAuthorizationCredential,
  parsePaymentChallengeFromWwwAuthenticate,
} from "../src/utils/httpAuth.js";

const okRpcClient = {
  async getTransaction() {
    return {
      to: "0x1111111111111111111111111111111111111111" as const,
      value: 1000n,
    };
  },
  async getTransactionReceipt() {
    return {
      status: "success" as const,
      logs: [],
      blockNumber: 100n,
    };
  },
  async getBlockNumber() {
    return 100n;
  },
};

describe("server charge flow", () => {
  it("issues a Payment challenge when no authorization is present", async () => {
    const method = bnb.charge(
      {
        recipient: "0x1111111111111111111111111111111111111111",
        asset: {
          kind: "native",
          decimals: 18,
          symbol: "BNB",
        },
        rpcUrl: "https://bsc-dataseed.binance.org",
        chainId: 56,
        realm: "test",
        store: new InMemoryStore(),
      },
      okRpcClient,
    );

    const result = await method.handle(
      {
        headers: {},
      },
      {
        amount: "1000",
        currency: "BNB",
      },
    );

    expect(result.status).toBe(402);
    if (result.status === 402) {
      expect(result.challenge.method).toBe("bnb-charge");
      const www = result.headers["WWW-Authenticate"] ?? "";
      expect(www.toLowerCase()).toContain("payment");
      expect(www).toContain("request=");
    }
  });

  it("detects replayed tx hash", async () => {
    const store = new InMemoryStore();
    const method = bnb.charge(
      {
        recipient: "0x1111111111111111111111111111111111111111",
        asset: {
          kind: "native",
          decimals: 18,
          symbol: "BNB",
        },
        rpcUrl: "https://bsc-dataseed.binance.org",
        chainId: 56,
        realm: "test",
        store,
      },
      okRpcClient,
    );

    const first = await method.handle(
      { headers: {} },
      {
        amount: "1000",
        currency: "BNB",
      },
    );
    expect(first.status).toBe(402);
    if (first.status !== 402) return;

    const www = first.headers["WWW-Authenticate"];
    expect(www).toBeTruthy();
    const { wire } = parsePaymentChallengeFromWwwAuthenticate(www!);

    const authorization = encodeAuthorizationCredential({
      challenge: wire,
      payload: {
        type: "hash",
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        from: "0x1111111111111111111111111111111111111111",
      },
    });

    const ok = await method.handle(
      { headers: { authorization } },
      {
        amount: "1000",
        currency: "BNB",
      },
    );
    expect(ok.status).toBe(200);

    const replay = await method.handle(
      { headers: { authorization } },
      {
        amount: "1000",
        currency: "BNB",
      },
    );
    expect(replay.status).toBe(402);
    if (replay.status === 402) {
      expect(replay.error?.code).toBe("REPLAY_DETECTED");
    }
  });
});
