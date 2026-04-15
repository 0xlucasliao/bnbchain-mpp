import { describe, expect, it } from "vitest";
import {
  challengePayloadSchema,
  credentialPayloadSchema,
  type ChargeChallenge,
} from "../src/Methods.js";
import { buildPaymentReceiptHeader } from "../src/utils/receipt.js";
import { InMemoryStore, RedisStore, type TxMeta } from "../src/utils/replay.js";
import {
  decodeWwwAuthenticatePayload,
  encodeAuthorizationCredential,
  parseAuthorizationHeader,
  toWwwAuthenticateHeader,
} from "../src/utils/httpAuth.js";

const challengeFixture: ChargeChallenge = {
  method: "bnb-charge",
  recipient: "0x1111111111111111111111111111111111111111",
  amount: "1000",
  currency: "USDT",
  asset: {
    kind: "bep20",
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
    symbol: "USDT",
  },
  chainId: 56,
  serverNonce: `0x${"12".repeat(32)}`,
  expiresAt: Date.now() + 10_000,
  feeSponsor: false,
  rpcUrl: "https://bsc-dataseed.binance.org",
};

describe("schemas", () => {
  it("validates challenge payload shape", () => {
    expect(challengePayloadSchema.parse(challengeFixture)).toEqual(challengeFixture);
  });

  it("rejects malformed credential", () => {
    expect(() =>
      credentialPayloadSchema.parse({
        method: "bnb-charge",
        from: "not-an-address",
        serverNonce: `0x${"ab".repeat(32)}`,
        chainId: 56,
      }),
    ).toThrow();
  });
});

describe("headers", () => {
  it("encodes and decodes challenge header", () => {
    const header = toWwwAuthenticateHeader(challengeFixture);
    const decoded = decodeWwwAuthenticatePayload(header);
    expect(decoded).toEqual(challengeFixture);
  });

  it("encodes and decodes authorization credential", () => {
    const authorization = encodeAuthorizationCredential({
      method: "bnb-charge",
      txHash: `0x${"ab".repeat(32)}`,
      from: "0x1111111111111111111111111111111111111111",
      serverNonce: `0x${"12".repeat(32)}`,
      chainId: 56,
    });
    expect(parseAuthorizationHeader(authorization)).toMatchObject({
      txHash: `0x${"ab".repeat(32)}`,
    });
  });
});

describe("receipt", () => {
  it("builds payment receipt string", () => {
    const header = buildPaymentReceiptHeader({
      txHash: "0xabc",
      amount: "123",
      currency: "USDT",
      chainId: 56,
    });
    expect(header).toBe(
      "method=bnb-charge; txHash=0xabc; amount=123; currency=USDT; chainId=56",
    );
  });
});

describe("replay stores", () => {
  it("tracks consumed tx in memory store", async () => {
    const store = new InMemoryStore();
    const meta: TxMeta = {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount: "10",
      currency: "USDT",
      chainId: 56,
      consumedAt: Date.now(),
    };
    await store.add("0xabc", meta);
    await expect(store.has("0xAbC")).resolves.toBe(true);
  });

  it("uses redis adapter for persisted consumed keys", async () => {
    const calls: Array<{ key: string; value: string; options?: { EX?: number } }> = [];
    const fakeRedis = {
      async set(key: string, value: string, options?: { EX?: number }) {
        calls.push({ key, value, options });
      },
      async exists(key: string) {
        return key.includes("present") ? 1 : 0;
      },
    };

    const store = new RedisStore(fakeRedis, { prefix: "test", ttlSeconds: 60 });
    await store.add("0xabc", {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount: "99",
      currency: "USDT",
      chainId: 56,
      consumedAt: Date.now(),
    });
    expect(calls[0]?.key).toBe("test:0xabc");
    await expect(store.has("0xpresent")).resolves.toBe(true);
  });
});
