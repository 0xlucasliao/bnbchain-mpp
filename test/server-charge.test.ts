import { describe, expect, it } from "vitest";
import { bnb } from "../src/server/index.js";
import { InMemoryStore } from "../src/utils/replay.js";
import { encodeAuthorizationCredential } from "../src/utils/httpAuth.js";

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
  it("issues a challenge when no authorization is present", async () => {
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
      expect(result.headers["WWW-Authenticate"]).toContain('challenge="');
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

    const authorization = encodeAuthorizationCredential({
      method: "bnb-charge",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "0x1111111111111111111111111111111111111111",
      serverNonce: first.challenge.serverNonce,
      chainId: 56,
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
