import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { createPublicClient, http } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { bnb, Mppx, type ChallengeResult, type VerifiedResult } from "@bnb/mpp/server";
import { DEFAULT_DEMO_RECIPIENT, getRpcUrl } from "./config.js";
import { publicClientToServerAdapter } from "./viemAdapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.DEMO_PORT ?? 8787);
const isProd = process.env.NODE_ENV === "production";

/** Agentic payments demo: BSC Testnet + BSC Mainnet only. */
const BSC_CHAIN_IDS = new Set([56, 97]);

function chainById(id: number) {
  if (id === 97) return bscTestnet;
  if (id === 56) return bsc;
  return undefined;
}

const addressRe = /^0x[a-fA-F0-9]{40}$/;

function normalizeHeaders(req: express.Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

const mppxByMerchant = new Map<string, Mppx>();

function mppxCacheKey(chainId: number, merchant: string): string {
  return `${chainId}:${merchant.toLowerCase()}`;
}

function getOrCreateMppx(chainId: number, merchant: `0x${string}`): Mppx {
  const key = mppxCacheKey(chainId, merchant);
  const existing = mppxByMerchant.get(key);
  if (existing) return existing;

  const chain = chainById(chainId);
  if (!chain) {
    throw new Error(`Unsupported chainId ${chainId}`);
  }
  const rpcUrl = getRpcUrl(chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 90_000, retryCount: 4 }),
  });
  const adapter = publicClientToServerAdapter(publicClient);

  const chargeMethod = bnb.charge(
    {
      recipient: merchant,
      asset: { kind: "native", decimals: 18, symbol: chainId === 97 ? "tBNB" : "BNB" },
      rpcUrl,
      chainId,
      confirmations: 1,
      nonceTtlSeconds: 600,
      realm: process.env.DEMO_PAYMENT_REALM ?? "bnb-mpp-demo",
    },
    adapter,
  );

  const mppx = Mppx.create({ methods: [chargeMethod] });
  mppxByMerchant.set(key, mppx);
  return mppx;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  res.json({
    networks: [
      { chainId: 97, name: "BSC Testnet", nativeCurrency: "tBNB" },
      { chainId: 56, name: "BSC Mainnet", nativeCurrency: "BNB" },
    ],
    defaultChainId: 97,
    chargeAmountWei: "1000000000000000",
    chargeAmountLabel: "0.001 native",
    paidResourcePath: "/api/charge/ping",
    defaultMerchant: DEFAULT_DEMO_RECIPIENT,
    rpcUrlByChainId: {
      97: getRpcUrl(97),
      56: getRpcUrl(56),
    } as Record<string, string>,
  });
});

/**
 * Paid resource — merchant receives native transfer (tBNB on testnet, BNB on mainnet).
 * Query: merchant=0x...&chainId=97|56 (required).
 */
app.get("/api/charge/ping", async (req, res) => {
  const chainIdParam = req.query.chainId;
  const chainId =
    typeof chainIdParam === "string" && chainIdParam.length > 0
      ? Number(chainIdParam)
      : 97;

  if (!BSC_CHAIN_IDS.has(chainId)) {
    res.status(400).json({ error: "chainId must be 56 (BSC Mainnet) or 97 (BSC Testnet)" });
    return;
  }

  const merchantParam = req.query.merchant;
  const merchant =
    typeof merchantParam === "string" && merchantParam.length > 0
      ? merchantParam
      : String(DEFAULT_DEMO_RECIPIENT);

  if (!addressRe.test(merchant)) {
    res.status(400).json({ error: "Invalid or missing merchant (use merchant=0x…)" });
    return;
  }

  let handlerMppx: Mppx;
  try {
    handlerMppx = getOrCreateMppx(chainId, merchant as `0x${string}`);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "server init failed" });
    return;
  }

  const paid = handlerMppx.charge({
    amount: "1000000000000000",
    currency: chainId === 97 ? "tBNB" : "BNB",
  });

  const result = (await paid({
    headers: normalizeHeaders(req),
  })) as ChallengeResult | VerifiedResult;

  if (result.status === 402) {
    res.status(402);
    res.setHeader("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
    res.json({
      status: 402,
      paymentError: result.error ?? null,
      challenge: result.challenge,
    });
    return;
  }

  res.status(200);
  res.setHeader("Cache-Control", "private");
  res.setHeader("Payment-Receipt", result.receiptHeader);
  res.json({
    status: 200,
    message: "Payment verified. This response would be your protected API payload.",
    paymentReceipt: result.receiptHeader,
  });
});

if (isProd) {
  const staticDir = path.join(__dirname, "..", "dist");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`@bnb/mpp agentic demo API http://127.0.0.1:${PORT}`);
  if (!isProd) {
    // eslint-disable-next-line no-console
    console.log(`Open Vite UI at http://127.0.0.1:5173`);
  }
});
