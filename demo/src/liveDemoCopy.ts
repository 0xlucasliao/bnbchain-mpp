/** Delays (ms) so each beat is readable during “Run pipeline”. */
export const VIZ_BEAT_MS = 1250;
export const VIZ_BEAT_SHORT_MS = 900;

export const ENTITY_COPY = {
  agent: {
    title: "Agent (browser)",
    body:
      "This is the payer wallet you configured with the agent private key. It calls the demo API with ordinary fetch(), signs transactions with viem, and holds the Payment credential (Authorization: Payment …) after the chain confirms your transfer. Nothing leaves the browser except HTTPS and JSON-RPC to your chosen BNB RPC.",
  },
  server: {
    title: "Server (demo API)",
    body:
      "The demo server exposes a paid route protected by @bnb/mpp/server. It returns HTTP 402 with WWW-Authenticate: Payment when no credential is present, decodes the JCS-encoded request inside the challenge, verifies the transaction on BSC via RPC, and returns 200 with a Payment-Receipt header after a valid proof.",
  },
  chain: {
    title: "BNB Chain (via RPC)",
    body:
      "Public BNB Smart Chain (or your RPC_URL). The agent submits a native transfer (or ERC-20 transfer in other configs) to the merchant address from the challenge. The server later reads the tx + receipt to confirm amount, recipient, and that the payer matches the credential.",
  },
} as const;

export const STEP_VISUAL = [
  {
    outLabel: "GET paid resource (no Authorization)",
    outTip:
      "First access is a normal GET to the same URL you will retry later. The server runs bnb.charge().handle with no Authorization header, decides payment is missing, and must answer with 402 plus a fresh Payment challenge—not with 401, because this is a payment gate, not an identity failure.",
    backLabel: "402 Payment Required + WWW-Authenticate: Payment",
    backTip:
      "The response carries Cache-Control: no-store and a Payment scheme challenge: id, realm, method=bnb, intent=charge, request=(base64url JCS JSON), expires=RFC3339. That request blob includes amount, recipient, chainId, asset, serverNonce—everything the agent needs to build the correct on-chain payment.",
  },
  {
    outLabel: "Decode & validate challenge",
    outTip:
      "The browser parses the Payment header, base64url-decodes the credential envelope shape from the challenge’s request field, and runs challengePayloadSchema on the inner JSON. This pins the payment terms before any signature or broadcast—wrong chain, amount, or recipient is rejected here.",
    backLabel: "Challenge accepted — ready to pay",
    backTip:
      "After validation, the client holds a PaymentClientChallenge (inner + wire). The wire must be echoed byte-for-byte in the later Authorization header so the server can bind the proof to this exact challenge id.",
  },
  {
    outLabel: "Simulate + sign + broadcast native transfer",
    outTip:
      "handleChallenge runs simulateCall (eth_call) with the same from/to/value as the real tx to surface reverts early, then walletClient.sendTransaction to the merchant address for the challenged wei amount. waitForTransactionReceipt ensures the tx is mined before building the credential—reducing TX_NOT_FOUND races on retry.",
    backLabel: "Receipt confirmed — build Authorization: Payment",
    backTip:
      "Once included, the client packs payload.type=hash with the tx hash and payer from address, echoes the Payment challenge object, JCS-encodes the credential JSON, and prefixes Authorization: Payment for the retry GET.",
  },
  {
    outLabel: "GET same URL with Payment credential",
    outTip:
      "The retry is identical routing (same merchant & chainId query params) but adds Authorization: Payment <base64url>. The server looks up the challenge id, verifies the echoed request matches, loads the tx from RPC, checks native transfer semantics and replay store, then consumes the hash.",
    backLabel: "200 OK + Payment-Receipt (+ JSON body)",
    backTip:
      "Success returns Cache-Control: private, a base64url Payment-Receipt JSON (method, reference=tx hash, challengeId, chainId, timestamp, status=success), and the demo JSON payload. A 402 with a fresh challenge indicates verification failure or replay.",
  },
] as const;

/** Sequence diagram rows — two lanes (Agent ↔ Server); chain/RPC shown as Agent-internal steps. */
export const SEQUENCE_ROWS = [
  {
    from: "agent" as const,
    to: "server" as const,
    direction: "request" as const,
    label: "GET paid resource (no Authorization)",
    sdk: "fetch(resourcePath)\nServer path: bnb.charge() → BnbChargeServerMethod.handle (@bnb/mpp/server)",
    explainer: `${ENTITY_COPY.agent.title}\n\n${ENTITY_COPY.agent.body}\n\n—\n\nThis message is a plain GET. The demo API runs MPP charge middleware and, because there is no Payment credential yet, responds with HTTP 402 and a WWW-Authenticate challenge instead of the JSON body.`,
  },
  {
    from: "server" as const,
    to: "agent" as const,
    direction: "response" as const,
    label: "402 Payment Required + Payment challenge",
    sdk: "Express response + WWW-Authenticate: Payment\nBuilt by MPP server handler (e.g. BnbChargeServerMethod.handle)",
    explainer: `${ENTITY_COPY.server.title}\n\n${ENTITY_COPY.server.body}\n\n—\n\nThe 402 carries Cache-Control: no-store and Payment scheme parameters: id, realm, method=bnb, intent=charge, request=(base64url JCS), expires. The agent must treat that blob as authoritative payment terms.`,
  },
  {
    from: "agent" as const,
    to: "agent" as const,
    direction: "internal" as const,
    label: "Parse WWW-Authenticate · validate JCS payload",
    sdk: "parseWwwAuthenticateHeader(wwwAuthenticate)\nchallengePayloadSchema.parse(inner)\n(@bnb/mpp)",
    explainer: `${STEP_VISUAL[1].outTip}\n\n${STEP_VISUAL[1].backTip}`,
  },
  {
    from: "agent" as const,
    to: "agent" as const,
    direction: "internal" as const,
    label: "BNB Chain RPC: simulateCall · sendTransaction",
    sdk: "bnb.charge({ … }).handleChallenge(paymentChallenge)\n→ publicClient.call() / simulateCall · walletClient.sendTransaction()\n(@bnb/mpp/client · viem)",
    explainer: `${STEP_VISUAL[2].outTip}\n\n${ENTITY_COPY.chain.title}\n\n${ENTITY_COPY.chain.body}`,
  },
  {
    from: "agent" as const,
    to: "agent" as const,
    direction: "internal" as const,
    label: "Receipt included (waitForTransactionReceipt)",
    sdk: "waitForTransactionReceipt({ hash }) via chargeMethod wiring\n(publicClient.waitForTransactionReceipt — viem)",
    explainer: `${STEP_VISUAL[2].backTip}\n\nThe RPC layer confirms the transaction is mined before the client constructs Authorization: Payment, which reduces races where the server has not yet indexed the tx.`,
  },
  {
    from: "agent" as const,
    to: "server" as const,
    direction: "request" as const,
    label: "GET same URL + Authorization: Payment",
    sdk: "fetch(resourcePath, { headers: { Authorization } })\nAuthorization string built by handleChallenge() (@bnb/mpp/client)",
    explainer: STEP_VISUAL[3].outTip,
  },
  {
    from: "server" as const,
    to: "agent" as const,
    direction: "response" as const,
    label: "200 OK + Payment-Receipt (+ JSON)",
    sdk: "BnbChargeServerMethod.handle verifies proof + tx\nSets Payment-Receipt header · JSON body (@bnb/mpp/server)",
    explainer: STEP_VISUAL[3].backTip,
  },
] as const;
