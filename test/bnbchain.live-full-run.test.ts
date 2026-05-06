import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { SUPPORTED_CHAINS } from "../src/constants.js";
import { bnb as clientBnb } from "../src/client/index.js";
import { bnb as serverBnb } from "../src/server/index.js";
import { parseWwwAuthenticateHeader } from "../src/utils/httpAuth.js";
import { InMemoryStore } from "../src/utils/replay.js";
import { publicClientToServerAdapter } from "./helpers/viemServerAdapter.js";

const CHAIN_ID = 97;
const DEMO_CHARGE_AMOUNT = "1000000000000000";
const DEMO_CURRENCY = "tBNB";

function rpcUrl97(): string {
  const fromEnv = process.env.RPC_URL_97;
  if (fromEnv) return fromEnv;
  const row = SUPPORTED_CHAINS.find((c) => c.chainId === CHAIN_ID);
  if (!row) throw new Error("BSC Testnet RPC not configured");
  return row.defaultRpcUrl;
}

function liveEnv(): { agentPk: `0x${string}`; merchant: `0x${string}` } | null {
  const pk = process.env.BSC_TESTNET_AGENT_PK?.trim();
  const merchant = process.env.BSC_TESTNET_MERCHANT?.trim();
  if (!pk || !merchant) return null;
  const pkNorm = pk.startsWith("0x") ? pk : `0x${pk}`;
  if (!isHex(pkNorm) || pkNorm.length !== 66) return null;
  if (!/^0x[a-fA-F0-9]{40}$/i.test(merchant)) return null;
  return { agentPk: pkNorm as `0x${string}`, merchant: merchant as `0x${string}` };
}

const live = liveEnv();

describe("BNB Chain live full run — BSC Testnet (one primary chain query per cluster)", () => {
  if (!live) {
    it.skip("set BSC_TESTNET_AGENT_PK and BSC_TESTNET_MERCHANT (optional RPC_URL_97)", () => undefined);
    return;
  }

  const { agentPk, merchant } = live;
  const rpcUrl = rpcUrl97();
  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  });
  const agentAccount = privateKeyToAccount(agentPk);
  const adapter = publicClientToServerAdapter(publicClient);
  const serverCharge = serverBnb.charge(
    {
      recipient: merchant,
      asset: { kind: "native", decimals: 18, symbol: "tBNB" },
      rpcUrl,
      chainId: CHAIN_ID,
      confirmations: 1,
      nonceTtlSeconds: 600,
      store: new InMemoryStore(),
    },
    adapter,
  );

  describe("cluster 1 — chain tip (1× getBlockNumber)", () => {
    it("reaches BNB Chain testnet RPC", async () => {
      const n = await publicClient.getBlockNumber();
      expect(n).toBeGreaterThan(0n);
    });
  });

  describe("cluster 2 — agent balance (1× getBalance)", () => {
    it("reads agent native balance", async () => {
      const bal = await publicClient.getBalance({ address: agentAccount.address });
      expect(bal).toBeGreaterThanOrEqual(BigInt(DEMO_CHARGE_AMOUNT));
    });
  });

  describe("cluster 3 — MPP challenge (no on-chain read)", () => {
    it("returns 402 + Payment challenge (method bnb)", async () => {
      const first = await serverCharge.handle(
        { headers: {} },
        { amount: DEMO_CHARGE_AMOUNT, currency: DEMO_CURRENCY },
      );
      expect(first.status).toBe(402);
      if (first.status !== 402) return;
      expect(first.challenge.method).toBe("bnb-charge");
      expect(first.challenge.recipient.toLowerCase()).toBe(merchant.toLowerCase());
    });
  });

  describe("cluster 4 — pay + verify (full native MPP)", () => {
    it("402 → broadcast payment → 200 with Payment-Receipt semantics", async () => {
      const first = await serverCharge.handle(
        { headers: {} },
        { amount: DEMO_CHARGE_AMOUNT, currency: DEMO_CURRENCY },
      );
      expect(first.status).toBe(402);
      if (first.status !== 402) return;

      const www = first.headers["WWW-Authenticate"];
      expect(www).toBeTruthy();
      const challengeRaw = parseWwwAuthenticateHeader(www!);

      const walletClient = createWalletClient({
        account: agentAccount,
        chain: bscTestnet,
        transport: http(rpcUrl),
      });

      const clientCharge = clientBnb.charge({
        signer: {
          account: agentAccount,
          sendTransaction: async (args) =>
            walletClient.sendTransaction({
              account: agentAccount,
              chain: bscTestnet,
              to: args.to,
              data: args.data,
              value: args.value,
            }),
        },
        publicClient: {
          call: async (args) =>
            publicClient.call({
              account: agentAccount.address,
              to: args.to ?? undefined,
              data: args.data,
              value: args.value,
            }),
        },
        rpcUrl,
        waitForTransactionReceipt: async ({ hash }) => {
          await publicClient.waitForTransactionReceipt({
            hash,
            pollingInterval: 1_500,
            confirmations: 1,
          });
        },
      });

      const authorization = await clientCharge.handleChallenge(challengeRaw);

      const second = await serverCharge.handle(
        { headers: { authorization } },
        { amount: DEMO_CHARGE_AMOUNT, currency: DEMO_CURRENCY },
      );
      expect(second.status).toBe(200);
      if (second.status !== 200) return;
      expect(second.receiptHeader).toMatch(/^Payment-Receipt:/);
    });
  });
});
