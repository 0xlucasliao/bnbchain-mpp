import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isHex,
  parseEther,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { QRCodeSVG } from "qrcode.react";
import { bnb } from "@bnb/mpp/client";
import { challengePayloadSchema, parseWwwAuthenticateHeader } from "@bnb/mpp";
import { SEQUENCE_ROWS, VIZ_BEAT_MS, VIZ_BEAT_SHORT_MS } from "./liveDemoCopy";
import { Pipeline, type PipelineStep, type PipelineStepStatus } from "./Pipeline";
import { SequenceDiagram, type SeqMessage } from "./SequenceDiagram";

const LS_MERCHANT = "bnb-mpp-demo-merchant";
const LS_CHAIN = "bnb-mpp-demo-chainId";

function shortText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… (${s.length} chars total)`;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function initialSteps(): PipelineStep[] {
  return [
    {
      key: "get",
      intent:
        "The agent tries to use a paid feature or data through the API, the same way an app would request something that normally costs money.",
      sdk: "Client: browser fetch() — no client SDK call yet.\nServer: bnb.charge() + Mppx.charge() → BnbChargeServerMethod.handle (@bnb/mpp/server).",
      title: "Agent → paid resource",
      detail: "HTTP GET without Authorization (agent accesses API).",
      status: "pending",
    },
    {
      key: "402",
      intent:
        "The service says “not until you pay” and hands back clear payment details so the payer knows exactly what to do next.",
      sdk: "Client: parseWwwAuthenticateHeader() (Payment scheme) + challengePayloadSchema.parse(inner) (@bnb/mpp).",
      title: "Resource → 402",
      detail: "Server requires payment; WWW-Authenticate challenge issued.",
      status: "pending",
    },
    {
      key: "pay",
      intent:
        "The agent actually sends the agreed amount to the merchant on the blockchain so there is a real transaction the server can check.",
      sdk: "Client: BnbClientChargeMethod.handleChallenge() from bnb.charge() (@bnb/mpp/client) — simulateCall, sendTransaction, optional waitForTransactionReceipt.",
      title: "Agent → on-chain payment",
      detail: "Build transfer to merchant, simulate, sign, broadcast.",
      status: "pending",
    },
    {
      key: "retry",
      intent:
        "The agent goes back to the same door with proof of payment so the service can unlock the resource.",
      sdk: "Client: fetch() with Authorization header built by handleChallenge(). One-shot equivalent: Mppx.fetch() / fetchWithPayment() (@bnb/mpp/client).\nServer: BnbChargeServerMethod.handle verifies tx + issues Payment-Receipt.",
      title: "Agent → retry with proof",
      detail: "GET same URL with MPP Authorization (tx hash + nonce).",
      status: "pending",
    },
  ];
}

type DemoConfig = {
  networks: Array<{ chainId: number; name: string; nativeCurrency: string }>;
  defaultChainId: number;
  chargeAmountWei: string;
  chargeAmountLabel: string;
  paidResourcePath: string;
  defaultMerchant: Address;
  rpcUrlByChainId: Record<string, string>;
};

function chainForId(id: number): Chain | undefined {
  if (id === 97) return bscTestnet;
  if (id === 56) return bsc;
  return undefined;
}

function normalizePk(input: string): Hex | null {
  const t = input.trim();
  if (!t) return null;
  const with0x = t.startsWith("0x") ? t : `0x${t}`;
  if (!isHex(with0x) || with0x.length !== 66) return null;
  return with0x as Hex;
}

function generateNewAgentPrivateKey(): Hex {
  return generatePrivateKey();
}

const BSC_TESTNET_WALLET_PARAMS = {
  chainId: "0x61" as const,
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.binance.org:8545"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
} as const;

const BSC_MAINNET_WALLET_PARAMS = {
  chainId: "0x38" as const,
  chainName: "BNB Smart Chain Mainnet",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org"],
  blockExplorerUrls: ["https://bscscan.com"],
} as const;

const BROWSER_EXTENSION_FUND_TESTNET_ETHER = "0.005" as const;

async function ensureInjectedWalletOnBscTestnet(eth: NonNullable<Window["ethereum"]>): Promise<void> {
  const params = BSC_TESTNET_WALLET_PARAMS;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: params.chainId }],
    });
  } catch (switchErr: unknown) {
    const code = (switchErr as { code?: number })?.code;
    if (code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [params],
      });
      return;
    }
    throw switchErr;
  }
}

export function App() {
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [merchant, setMerchant] = useState("");
  const [agentPk, setAgentPk] = useState("");
  const [chainId, setChainId] = useState(97);
  const [steps, setSteps] = useState<PipelineStep[]>(initialSteps);
  const [pipelineRevealCount, setPipelineRevealCount] = useState(initialSteps().length);
  const [seqMessages, setSeqMessages] = useState<SeqMessage[]>([]);
  const seqIdRef = useRef(0);
  const [runBusy, setRunBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [addNetworkMsg, setAddNetworkMsg] = useState<string | null>(null);
  const [fundExtensionBusy, setFundExtensionBusy] = useState(false);
  const [fundExtensionTxHash, setFundExtensionTxHash] = useState<Hex | null>(null);
  const [fundExtensionError, setFundExtensionError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: DemoConfig) => {
        setConfig(c);
        const m = localStorage.getItem(LS_MERCHANT);
        const ch = localStorage.getItem(LS_CHAIN);
        setMerchant(m && /^0x[a-fA-F0-9]{40}$/.test(m) ? m : c.defaultMerchant);
        if (ch === "56" || ch === "97") setChainId(Number(ch));
      })
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (merchant && /^0x[a-fA-F0-9]{40}$/i.test(merchant)) {
      localStorage.setItem(LS_MERCHANT, merchant);
    }
  }, [merchant]);

  useEffect(() => {
    localStorage.setItem(LS_CHAIN, String(chainId));
  }, [chainId]);

  const agentAccount = useMemo(() => {
    const pk = normalizePk(agentPk);
    if (!pk) return null;
    try {
      return privateKeyToAccount(pk);
    } catch {
      return null;
    }
  }, [agentPk]);

  const chain = useMemo(() => chainForId(chainId), [chainId]);
  const rpcUrl = config?.rpcUrlByChainId[String(chainId)] ?? "";

  const merchantOk = useMemo(
    () => /^0x[a-fA-F0-9]{40}$/i.test(merchant.trim()),
    [merchant],
  );

  const setStepStatus = useCallback((index: number, status: PipelineStepStatus, output?: string) => {
    setSteps((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (!cur) return prev;
      next[index] = { ...cur, status, ...(output !== undefined ? { output } : {}) };
      return next;
    });
  }, []);

  const runAgenticDemo = useCallback(async () => {
    setLastError(null);
    if (!config || !chain || !rpcUrl) {
      setLastError("Config or RPC not loaded.");
      return;
    }
    const pk = normalizePk(agentPk);
    if (!pk || !agentAccount) {
      setLastError("Enter a valid 32-byte agent private key (0x + 64 hex).");
      return;
    }
    if (!merchantOk) {
      setLastError("Enter a valid merchant wallet address (0x + 40 hex).");
      return;
    }

    const merchantAddr = merchant.trim() as Address;
    const resourcePath = `/api/charge/ping?chainId=${chainId}&merchant=${encodeURIComponent(merchantAddr)}`;

    setRunBusy(true);
    setSteps(initialSteps());
    seqIdRef.current = 0;
    setPipelineRevealCount(1);
    setSeqMessages([]);
    await sleep(VIZ_BEAT_SHORT_MS);

    const pushSeqRow = (rowIndex: number) => {
      const row = SEQUENCE_ROWS[rowIndex];
      if (!row) return;
      setSeqMessages((prev) => [...prev, { ...row, id: `seq-${seqIdRef.current++}` }]);
    };

    // Public BSC testnet RPCs are often slow; default viem HTTP timeout is 10s.
    const transport = http(rpcUrl, { timeout: 90_000, retryCount: 4 });
    const publicClient = createPublicClient({
      chain,
      transport,
    });
    const walletClient = createWalletClient({
      account: agentAccount,
      chain,
      transport,
    });

    const chargeMethod = bnb.charge({
      signer: {
        account: agentAccount,
        sendTransaction: async (args) =>
          walletClient.sendTransaction({
            account: agentAccount,
            chain,
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

    try {
      setStepStatus(0, "active");
      pushSeqRow(0);
      await sleep(VIZ_BEAT_MS);

      const r1 = await fetch(resourcePath);
      const text1 = await r1.text();
      const body1 = tryParseJson(text1);
      const summary1 = [
        `URL: GET ${resourcePath}`,
        `HTTP ${r1.status}`,
        typeof body1 === "string" ? body1 : shortText(JSON.stringify(body1, null, 2), 2200),
      ].join("\n\n");

      pushSeqRow(1);
      await sleep(VIZ_BEAT_MS);

      setStepStatus(0, r1.status === 402 ? "ok" : r1.ok ? "ok" : "error", summary1);
      await sleep(VIZ_BEAT_SHORT_MS);

      if (r1.status !== 402) {
        setPipelineRevealCount(2);
        setStepStatus(1, "error", "Expected HTTP 402 from paid resource.");
        setLastError(`Expected 402, got ${r1.status}.`);
        return;
      }

      setPipelineRevealCount(2);
      setStepStatus(1, "active");
      pushSeqRow(2);
      await sleep(VIZ_BEAT_MS);

      const www = r1.headers.get("WWW-Authenticate") ?? r1.headers.get("www-authenticate");
      if (!www) {
        setStepStatus(1, "error", "No WWW-Authenticate header.");
        setLastError("Missing payment challenge.");
        return;
      }
      let paymentChallenge: ReturnType<typeof parseWwwAuthenticateHeader>;
      try {
        paymentChallenge = parseWwwAuthenticateHeader(www);
      } catch (e) {
        setStepStatus(1, "error", "Invalid Payment challenge (WWW-Authenticate).");
        setLastError(e instanceof Error ? e.message : String(e));
        return;
      }
      const challenge = challengePayloadSchema.parse(paymentChallenge.inner);
      const summary2 = shortText(
        JSON.stringify(
          {
            method: challenge.method,
            recipient: challenge.recipient,
            amount: challenge.amount,
            currency: challenge.currency,
            chainId: challenge.chainId,
            serverNonce: challenge.serverNonce,
            expiresAt: challenge.expiresAt,
          },
          null,
          2,
        ),
        2200,
      );

      await sleep(VIZ_BEAT_MS);

      setStepStatus(1, "ok", summary2);
      await sleep(VIZ_BEAT_SHORT_MS);

      setPipelineRevealCount(3);
      setStepStatus(2, "active");
      pushSeqRow(3);
      await sleep(VIZ_BEAT_MS);

      const authorization = await chargeMethod.handleChallenge(paymentChallenge);
      const credPreview = shortText(authorization, 400);

      pushSeqRow(4);
      await sleep(VIZ_BEAT_MS);

      setStepStatus(
        2,
        "ok",
        `Payment tx mined (waitForTransactionReceipt) before building credential.\n\nAuthorization: Payment (truncated):\n${credPreview}`,
      );
      await sleep(VIZ_BEAT_SHORT_MS);

      setPipelineRevealCount(4);
      setStepStatus(3, "active");
      pushSeqRow(5);
      await sleep(VIZ_BEAT_MS);

      let r2!: Response;
      let text2 = "";
      for (let attempt = 0; attempt < 12; attempt++) {
        r2 = await fetch(resourcePath, {
          headers: { Authorization: authorization },
        });
        text2 = await r2.text();
        if (r2.status === 200) break;
        const bodyAttempt = tryParseJson(text2) as {
          paymentError?: { code?: string };
        };
        if (
          r2.status === 402 &&
          bodyAttempt &&
          typeof bodyAttempt === "object" &&
          bodyAttempt.paymentError?.code === "TX_NOT_FOUND" &&
          attempt < 11
        ) {
          await sleep(2_000);
          continue;
        }
        break;
      }
      const body2 = tryParseJson(text2);
      const receipt = r2.headers.get("Payment-Receipt");
      const summary4 = [
        `HTTP ${r2.status}`,
        receipt ? `Payment-Receipt: ${receipt}` : "(no Payment-Receipt header)",
        typeof body2 === "string" ? body2 : shortText(JSON.stringify(body2, null, 2), 2200),
      ].join("\n\n");

      pushSeqRow(6);
      await sleep(VIZ_BEAT_MS);

      setStepStatus(3, r2.status === 200 ? "ok" : "error", summary4);
      if (r2.status !== 200) {
        setLastError(`Final GET returned ${r2.status}.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      setSteps((prev) => {
        const i = prev.findIndex((s) => s.status === "active");
        const idx = i >= 0 ? i : prev.length - 1;
        const next = [...prev];
        if (next[idx]) {
          next[idx] = {
            ...next[idx],
            status: "error",
            output: `${next[idx].output ?? ""}\n\n${msg}`.trim(),
          };
        }
        return next;
      });
    } finally {
      setPipelineRevealCount(initialSteps().length);
      setRunBusy(false);
    }
  }, [agentAccount, agentPk, chain, chainId, config, merchant, merchantOk, rpcUrl, setStepStatus]);

  const fundQrPayload = agentAccount ? `ethereum:${agentAccount.address}` : "";

  const addChainToInjectedWallet = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth?.request) {
      setAddNetworkMsg("No injected wallet in this tab.");
      return;
    }
    setAddNetworkMsg(null);
    const params = chainId === 97 ? BSC_TESTNET_WALLET_PARAMS : BSC_MAINNET_WALLET_PARAMS;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: params.chainId }],
      });
      setAddNetworkMsg("Switched network.");
    } catch (switchErr: unknown) {
      const code = (switchErr as { code?: number })?.code;
      if (code === 4902) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [params],
          });
          setAddNetworkMsg("Network added.");
        } catch (addErr) {
          setAddNetworkMsg(addErr instanceof Error ? addErr.message : String(addErr));
        }
      } else {
        setAddNetworkMsg(switchErr instanceof Error ? switchErr.message : String(switchErr));
      }
    }
  }, [chainId]);

  const fundAgentFromBrowserExtension = useCallback(async () => {
    setFundExtensionError(null);
    setFundExtensionTxHash(null);
    if (!agentAccount) {
      setFundExtensionError("Enter a valid agent private key first.");
      return;
    }
    if (chainId !== 97) {
      setFundExtensionError("Select BSC Testnet above.");
      return;
    }
    const eth = window.ethereum;
    if (!eth?.request) {
      setFundExtensionError("No injected wallet in this tab.");
      return;
    }
    setFundExtensionBusy(true);
    try {
      await ensureInjectedWalletOnBscTestnet(eth);
      const walletClient = createWalletClient({
        chain: bscTestnet,
        transport: custom(eth),
      });
      const [account] = await walletClient.requestAddresses();
      const hash = await walletClient.sendTransaction({
        account,
        chain: bscTestnet,
        to: agentAccount.address,
        value: parseEther(BROWSER_EXTENSION_FUND_TESTNET_ETHER),
      });
      setFundExtensionTxHash(hash);
    } catch (e) {
      setFundExtensionError(e instanceof Error ? e.message : String(e));
    } finally {
      setFundExtensionBusy(false);
    }
  }, [agentAccount, chainId]);

  if (!config) {
    return (
      <div className="shell">
        <h1>Agentic payments demo</h1>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="hero">
        <h1>@bnb/mpp — agentic payments demo</h1>
        <p className="lead">
          Configure merchant and agent, fund the agent, then run the <code>402</code> → pay → retry MPP flow against the
          demo API.
        </p>
      </header>

      <section className="panel">
        <h2>1 · Configure</h2>
        <div className="warn-banner">
          <strong>Demo only.</strong> Never paste a mainnet private key you care about. Prefer a disposable
          test wallet on BSC Testnet.
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Merchant wallet (receives payment)</span>
            <input
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="0x…"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </label>
          <label className="field field--wide">
            <span className="field-label">Agent private key (payer — stays in this browser)</span>
            <div className="field-row">
              <input
                type="password"
                spellCheck={false}
                autoComplete="off"
                placeholder="0x… (64 hex chars)"
                className="field-input-grow"
                value={agentPk}
                onChange={(e) => setAgentPk(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={runBusy}
                onClick={() => {
                  setAgentPk(generateNewAgentPrivateKey());
                  setLastError(null);
                }}
              >
                New wallet
              </button>
            </div>
          </label>
          <label className="field field--network">
            <span className="field-label">Network</span>
            <select value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
              {config.networks.map((n) => (
                <option key={n.chainId} value={n.chainId}>
                  {n.name} — {n.nativeCurrency}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          Charge: <strong>{config.chargeAmountLabel}</strong> ({config.chargeAmountWei} wei) per access.
          RPC: <code className="inline-code">{shortText(rpcUrl, 80)}</code>
        </p>

        <div className="fund-qr-block">
          <h3 className="h3">Fund the agent</h3>
          <p className="muted small">
            Native balance for charge ({config.chargeAmountLabel}) + gas. QR or extension on BSC Testnet.
          </p>
          <div className="info-callout" style={{ marginTop: "0.75rem" }}>
            <strong>Browser extension (BSC Testnet)</strong>
            <p className="muted small" style={{ margin: "0.4rem 0 0" }}>
              Sends <strong>{BROWSER_EXTENSION_FUND_TESTNET_ETHER} tBNB</strong> from the injected account to the agent.
            </p>
            {chainId !== 97 ? (
              <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
                Select BSC Testnet above.
              </p>
            ) : null}
            <div className="row" style={{ marginTop: "0.65rem" }}>
              <button
                type="button"
                className="btn-primary"
                disabled={!agentAccount || chainId !== 97 || fundExtensionBusy || runBusy}
                onClick={() => void fundAgentFromBrowserExtension()}
              >
                {fundExtensionBusy ? "Confirm in wallet…" : `Send ${BROWSER_EXTENSION_FUND_TESTNET_ETHER} tBNB via extension`}
              </button>
            </div>
            {fundExtensionTxHash ? (
              <p className="small" style={{ margin: "0.5rem 0 0", color: "var(--ok)" }}>
                Submitted:{" "}
                <a
                  href={`https://testnet.bscscan.com/tx/${fundExtensionTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {fundExtensionTxHash}
                </a>
              </p>
            ) : null}
            {fundExtensionError ? <p className="error-line" style={{ margin: "0.5rem 0 0" }}>{fundExtensionError}</p> : null}
          </div>
          <div className="info-callout">
            <div className="row" style={{ marginTop: 0 }}>
              <button type="button" className="btn-secondary" onClick={() => void addChainToInjectedWallet()}>
                Add / switch {chainId === 97 ? "BSC Testnet" : "BSC Mainnet"} in browser wallet
              </button>
            </div>
            {addNetworkMsg ? <p className="small" style={{ margin: "0.5rem 0 0", color: "var(--ok)" }}>{addNetworkMsg}</p> : null}
          </div>
          {agentAccount && fundQrPayload ? (
            <div className="qr-row">
              <div className="qr-frame">
                <QRCodeSVG value={fundQrPayload} size={176} level="M" />
              </div>
              <div>
                <p className="mono small break-all">
                  <strong>Agent</strong> {agentAccount.address}
                </p>
                <p className="mono small break-all" title={fundQrPayload}>
                  {fundQrPayload}
                </p>
              </div>
            </div>
          ) : (
            <p className="muted small">Enter a valid agent private key to show the deposit QR.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>2 · Run MPP pipeline</h2>
        <p className="muted small">
          <code className="inline-code">{config.paidResourcePath}</code>
        </p>
        <div className="row">
          <button
            type="button"
            className="btn-primary"
            disabled={runBusy || !merchantOk || !normalizePk(agentPk)}
            onClick={() => void runAgenticDemo()}
          >
            {runBusy ? "Running…" : "Run pipeline"}
          </button>
        </div>
        {lastError ? <p className="error-line">{lastError}</p> : null}
      </section>

      <section className="panel panel--wide">
        <h2>Live pipeline</h2>
        <p className="muted small live-panel-hint">
          During a run, the horizontal flow reveals one step at a time; the sequence diagram below draws Agent ↔ Server arrows (chain work
          appears as Agent-local self-calls). Pauses between beats give time to read. Use the ⓘ buttons to open full explainers in a modal.
        </p>
        <div className="live-stack">
          <div className="live-stack__block">
            <h3 className="live-stack__title">Flow</h3>
            <Pipeline steps={steps} revealedStepCount={pipelineRevealCount} />
          </div>
          <div className="live-stack__rule" aria-hidden />
          <div className="live-stack__block">
            <h3 className="live-stack__title">Sequence · Agent ↔ Server</h3>
            <SequenceDiagram messages={seqMessages} />
          </div>
        </div>
      </section>

      <footer className="footer">
        <a href="https://paymentauth.org" target="_blank" rel="noreferrer">
          paymentauth.org
        </a>
        {" · "}
        <a href="https://mpp.dev" target="_blank" rel="noreferrer">
          mpp.dev
        </a>
      </footer>
    </div>
  );
}
