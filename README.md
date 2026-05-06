# @bnb/mpp

BNB Smart Chain (BSC / opBNB) **charge** flow for HTTP APIs: **`402 Payment Required`**, **`WWW-Authenticate: Payment`**, **`Authorization: Payment`**, and **`Payment-Receipt`**, built with [viem](https://viem.sh).

Normative HTTP behavior follows **[The Payment HTTP Authentication Scheme](https://paymentauth.org/draft-httpauth-payment-00.txt)** (`draft-httpauth-payment-00`). EVM token verification follows **[EVM Charge Intent for HTTP Payment Authentication](https://paymentauth.org/draft-evm-charge-00.txt)** (`draft-evm-charge-00`) where it applies.

## Install

```bash
npm install @bnb/mpp
```

Peer: `viem` ^2.

## Usage

**Server** — issue a `Payment` challenge and verify a client-broadcast transaction (credential type **`hash`**, same role as in the EVM charge draft):

```ts
import { bnb, Mppx } from "@bnb/mpp/server";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) });
const charge = bnb.charge(
  {
    recipient: merchant,
    asset: { kind: "native", decimals: 18, symbol: "tBNB" },
    rpcUrl,
    chainId: 97,
    realm: "https://api.example.com", // draft-httpauth `realm`
  },
  publicClient,
);

const mppx = Mppx.create({ methods: [charge] });
const paid = mppx.charge({ amount: "1000000000000000", currency: "tBNB" });
const result = await paid({ headers: normalizeHeaders(req) });
```

**Client** — parse `WWW-Authenticate`, pay, send `Authorization: Payment …`:

```ts
import { bnb, Mppx } from "@bnb/mpp/client";
import { parseWwwAuthenticateHeader } from "@bnb/mpp";

const chargeClient = bnb.charge({ signer, publicClient, rpcUrl, waitForTransactionReceipt: ... });
const mppx = Mppx.create({ methods: [chargeClient] });
// Or: parseWwwAuthenticateHeader(www) then chargeClient.handleChallenge(paymentChallenge)
await mppx.fetch(url);
```

## Standards compliance

| Area | Draft | What this package does |
|------|--------|---------------------------|
| Challenge scheme | [draft-httpauth-payment-00](https://paymentauth.org/draft-httpauth-payment-00.txt) | `WWW-Authenticate: Payment` with `id`, `realm`, `method`, `intent`, `request`, `expires` (RFC 3339). |
| `request` encoding | same + [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) | JSON **canonicalized with JCS** (`canonicalize`), then **base64url without padding**, as required for the `request` auth-param. |
| Credentials | draft-httpauth §5.2 | `Authorization: Payment <base64url(JSON)>` where JSON is `{ challenge, payload[, source] }` with `challenge` echoing the issued auth-params. |
| Successful proof | draft-httpauth §5.3 | `Payment-Receipt` is **base64url JSON** with at least `status`, `method`, `timestamp`, `reference` (tx hash), plus `chainId` and `challengeId` (EVM draft §7.6). |
| Caching | draft-httpauth §11.10 | Server challenges include `Cache-Control: no-store`; successful paid responses use `Cache-Control: private` (see demo server). |
| EVM `hash` credential | [draft-evm-charge-00](https://paymentauth.org/draft-evm-charge-00.txt) §5.5, §6.4 | For **BEP-20**, verifies `Transfer` logs on the challenged token contract, recipient, amount, and payer `from`, analogous to the draft’s hash path for ERC-20. |
| Native gas token | draft-evm-charge-00 §1 intro | The EVM charge draft is **ERC-20 only** and excludes native transfers. This package adds a **documented extension**: same `hash` credential and on-chain verification against the **native** `value` and `to` on the signed transaction. |
| HTTP Payment method id | draft-httpauth §6.1 (`1*LOWERALPHA`) | Wire parameter `method=bnb` (lowercase letters only). The inner JCS request body still uses `method: "bnb-charge"` for the existing zod schema. |

**Not yet aligned (optional hardening):** RFC 9457 `application/problem+json` bodies on every `402`, `Accept-Payment` negotiation, `digest` / `opaque` challenge params, Permit2 / EIP-3009 / `transaction` credential types from the EVM draft.

## Demo

```bash
npm run demo:dev
```

Optional: `DEMO_PAYMENT_REALM` sets the Payment `realm` (default `bnb-mpp-demo`). Set `RPC_URL_97` / `RPC_URL_56` in the demo server environment if the default Binance seed RPC is slow or times out from your network.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile `dist/` |
| `npm test` | Vitest (unit + wire round-trips) |
| `npm run test:live` | BSC Testnet live run (requires `BSC_TESTNET_AGENT_PK`, `BSC_TESTNET_MERCHANT`) |

## License

MIT
