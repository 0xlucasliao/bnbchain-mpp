# BNB Chain MPP — Charge Method Implementation
### Product Requirements Document v0.1.0 (Draft)

| Field | Value |
|---|---|
| Version | 0.1.0 (Draft) |
| Status | In Review |
| Scope | Charge (one-shot payment) method only |
| Target Chain | BNB Chain (BSC / opBNB) |
| Protocol Reference | MPP Spec — paymentauth.org |

---

## 1. Overview

`@bnb/mpp` is a BNB Chain-native payment method for the Machine Payments Protocol (MPP) — an open protocol that lets any HTTP API accept payments using the `402 Payment Required` flow. The initial scope is limited to the **Charge method**: a one-shot, per-request payment using EVM-compatible primitives (viem, BEP-20 tokens, EIP-712 signatures).

### 1.1 Goals

- Implement the MPP Charge flow fully on BNB Chain (BSC mainnet, opBNB, and testnets)
- Publish `@bnb/mpp` as an npm package with `client` and `server` exports mirroring the `@solana/mpp` API surface
- Support native BNB and BEP-20 token payments (USDT, USDC, FDUSD, etc.)
- Enable optional fee sponsorship where the server covers gas on behalf of clients
- Provide replay protection via consumed transaction hash tracking
- Ensure protocol compatibility so any MPP-compliant client can pay a BNB-MPP-gated server

### 1.2 Non-Goals (v1)

- Session / metered / streaming payments (voucher channels) — deferred to v2
- Cross-chain payment routing
- Account abstraction or ERC-4337 session keys
- Swig-equivalent on-chain spend limits

### 1.3 Protocol Reference

This implementation follows the MPP HTTP Payment Authentication Scheme. Key protocol primitives:
- `HTTP 402` challenge/response cycle
- `WWW-Authenticate` and `Authorization` headers for payment negotiation
- `Payment-Receipt` header returned upon successful payment verification

---

## 2. Architecture

### 2.1 Package Structure

```
@bnb/mpp/
  src/
    Methods.ts          # Shared charge schemas (zod)
    constants.ts        # Token addresses, RPC URLs, chain IDs
    client/
      Charge.ts         # Client: build tx, sign, send
      index.ts          # Client entry point
    server/
      Charge.ts         # Server: challenge, verify, broadcast
      index.ts          # Server entry point
    utils/
      replay.ts         # Consumed tx hash store
      receipt.ts        # Payment-Receipt header builder
      simulate.ts       # Pre-broadcast simulation
```

### 2.2 Export Surface

| Export | Contents | Used by |
|---|---|---|
| `@bnb/mpp` | Shared schemas, charge types, constants | Both |
| `@bnb/mpp/client` | `Mppx` client factory, `bnb.charge()` client method, signer adapters | Client app |
| `@bnb/mpp/server` | `Mppx` server factory, `bnb.charge()` server method, `Store` interface | API server |

### 2.3 Dependencies

| Dependency | Role | Required? |
|---|---|---|
| `viem` | EVM tx building, signing, ABI encoding | Yes |
| `zod` | Schema validation for challenge/credential payloads | Yes |
| `mppx` | MPP protocol HTTP layer (shared with `@solana/mpp`) | Yes |
| `ethers` | Alternative signer adapter | Peer (optional) |

---

## 3. Charge Flow — Detailed Specification

### 3.1 Standard Flow (No Fee Sponsorship)

1. Client sends a normal HTTP request to a paid endpoint
2. Server checks for a valid `Authorization` header. Finding none, it generates a server nonce, builds a challenge payload, and returns `HTTP 402` with a `WWW-Authenticate` header
3. Client parses the challenge, builds an EVM transfer transaction (native BNB or BEP-20), signs it with the user's wallet, and broadcasts it
4. Client retries the original request with an `Authorization` header containing the transaction hash and signed credential
5. Server verifies the credential, confirms the transaction on-chain, checks transfer semantics, records the tx hash for replay protection, and returns the resource with a `Payment-Receipt` header

### 3.2 Fee Sponsorship Flow

1. Steps 1 and 2 are identical to the standard flow. The `402` challenge additionally signals `feeSponsor: true`
2. Client builds a transfer authorization (EIP-712 typed data) but does **not** broadcast
3. Client sends the signed authorization bytes in the `Authorization` header
4. Server reconstructs the full transaction, adds its own gas-paying account as the sender, broadcasts, and confirms
5. Server returns the resource with `Payment-Receipt`

### 3.3 Challenge Payload Schema

```json
{
  "method": "bnb-charge",
  "recipient": "0x...",
  "amount": "1000000",
  "currency": "USDT",
  "asset": {
    "kind": "bep20" | "native",
    "address": "0x...",
    "decimals": 18,
    "symbol": "USDT"
  },
  "chainId": 56 | 97 | 204,
  "serverNonce": "hex-string",
  "expiresAt": 1234567890,
  "feeSponsor": false,
  "rpcUrl": "https://..."
}
```

### 3.4 Client Authorization Credential Schema

```json
{
  "method": "bnb-charge",
  "txHash": "0x...",
  "signedAuth": "0x...",
  "from": "0x...",
  "serverNonce": "hex-string",
  "chainId": 56
}
```

`txHash` is used in standard flow. `signedAuth` is used in fee sponsorship flow.

### 3.5 Server Verification Steps

The server **must** perform all of the following checks before serving the resource:

1. Validate credential schema (zod)
2. Verify `serverNonce` matches the issued challenge
3. Verify `chainId` matches expected chain
4. Check `txHash` is not in the consumed set (replay protection)
5. Fetch transaction from RPC and assert `status === confirmed`
6. Assert `tx.to === recipient`
7. For BEP-20: decode `Transfer` event log, assert token address, from, to, and amount
8. For native BNB: assert `tx.value >= required amount`
9. Assert `amount >= required amount` (overpayment accepted; underpayment rejected)
10. Check `expiresAt` has not passed (±30s skew allowance)
11. Record `txHash` in consumed set
12. Attach `Payment-Receipt` header to response

### 3.6 Payment-Receipt Header

```
Payment-Receipt: method=bnb-charge; txHash=0x...; amount=1000000; currency=USDT; chainId=56
```

---

## 4. Replay Protection

### 4.1 Requirements

- Every successfully verified `txHash` must be recorded in a persistent store
- Any re-submission of the same `txHash` must be rejected with `HTTP 402` and error code `REPLAY_DETECTED`
- The store must survive server restarts

### 4.2 Store Interface

```typescript
interface ConsumedStore {
  has(txHash: string): Promise<boolean>;
  add(txHash: string, meta: TxMeta): Promise<void>;
}
```

Built-in adapters in v1:
- `InMemoryStore` — development/testing only
- `RedisStore` — production-ready, with TTL support
- Custom — any implementation of `ConsumedStore`

### 4.3 Server Nonce Binding

Each `402` challenge includes a `serverNonce` (32-byte random hex). The client must echo this in the credential. The server verifies the echo before querying the chain. This prevents an attacker from reusing a valid tx hash against a different challenge on the same server.

---

## 5. Fee Sponsorship

### 5.1 Mechanism

When `feeSponsor: true` is in the challenge, the client signs an EIP-712 typed data authorization encoding the transfer intent. The server holds a gas-paying EOA (or integrates a paymaster), constructs the actual EVM transaction with the client's signed authorization, and broadcasts.

### 5.2 EIP-712 Authorization Schema

```
Domain:
  name: "BNB-MPP"
  version: "1"
  chainId: <chainId>
  verifyingContract: <token address | zero address for native BNB>

Types:
  ChargeAuthorization {
    address from
    address to
    uint256 amount
    bytes32 serverNonce
    uint256 deadline
  }
```

### 5.3 Server Fee Payer Requirements

- The server must maintain a funded gas wallet or integrate a paymaster (e.g. Biconomy, Particle Network on opBNB)
- The server must validate the client's EIP-712 signature matches the `from` address before spending gas
- Underpayment must be rejected without broadcasting — simulate first

---

## 6. Supported Assets — v1

| Asset | Type | Contract (BSC Mainnet) | Decimals |
|---|---|---|---|
| BNB | Native | N/A | 18 |
| USDT | BEP-20 | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| USDC | BEP-20 | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |
| FDUSD | BEP-20 | `0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409` | 18 |
| ETH (Bridged) | BEP-20 | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` | 18 |

---

## 7. API Reference

### 7.1 Server-Side API

```typescript
import { Mppx, bnb } from '@bnb/mpp/server'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    bnb.charge({
      recipient: '0x...',
      asset: {
        kind: 'bep20',
        address: '0x55d398326f99059fF775485246999027B3197955', // USDT
        decimals: 18,
        symbol: 'USDT'
      },
      rpcUrl: 'https://bsc-dataseed.binance.org',
      store: new RedisStore(redisClient),
    })
  ]
})

// In your route handler:
const result = await mppx.charge({ amount: '1000000000000000000', currency: 'USDT' })(req)

if (result.status === 402) return res.status(402).json(result.challenge)
return result.withReceipt(res.json({ data: 'protected content' }))
```

**`bnb.charge()` — Server Config**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `recipient` | `string (0x)` | Yes | Address that receives the payment |
| `asset` | `AssetConfig` | Yes | Token spec: kind, address, decimals, symbol |
| `rpcUrl` | `string` | Yes | BNB Chain JSON-RPC endpoint |
| `store` | `ConsumedStore` | No | Replay protection store (default: InMemory) |
| `signer` | `WalletClient` | No | Fee sponsor signer (enables sponsorship mode) |
| `nonceTtlSeconds` | `number` | No | Challenge TTL (default: 120s) |
| `confirmations` | `number` | No | Required on-chain confirmations (default: 1) |

### 7.2 Client-Side API

```typescript
import { Mppx, bnb } from '@bnb/mpp/client'

const mppx = Mppx.create({
  methods: [
    bnb.charge({
      signer,   // viem WalletClient | ethers Signer
      rpcUrl: 'https://bsc-dataseed.binance.org',
    })
  ]
})

// Drop-in fetch replacement — handles 402 cycle automatically:
const response = await mppx.fetch('https://api.example.com/paid-endpoint')
```

**`bnb.charge()` — Client Config**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `signer` | `WalletClient \| Signer` | Yes | User's wallet (viem or ethers) |
| `rpcUrl` | `string` | No | Override RPC (falls back to server hint) |
| `maxAmount` | `string` | No | Refuse to pay above this amount (safety cap) |
| `acceptedCurrencies` | `string[]` | No | Whitelist of accepted currency tickers |

---

## 8. Transaction Simulation

Before broadcasting any transaction — client transfer or sponsored tx — the SDK must simulate the call using `eth_call`. If simulation reverts, the SDK throws a `SimulationError` and does not broadcast, preventing wasted gas.

Simulation is also used server-side when verifying sponsored transactions before committing gas. Simulation failure returns `HTTP 402` with error code `SIMULATION_FAILED`.

---

## 9. Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `CHALLENGE_EXPIRED` | 402 | Challenge nonce has passed its TTL |
| `NONCE_MISMATCH` | 402 | Client echoed the wrong `serverNonce` |
| `CHAIN_MISMATCH` | 402 | Client paid on the wrong `chainId` |
| `REPLAY_DETECTED` | 402 | `txHash` has already been consumed |
| `TX_NOT_FOUND` | 402 | Transaction not found or still pending |
| `TX_REVERTED` | 402 | Transaction reverted on-chain |
| `WRONG_RECIPIENT` | 402 | Transfer destination doesn't match config |
| `WRONG_TOKEN` | 402 | BEP-20 token address doesn't match config |
| `UNDERPAYMENT` | 402 | Transfer amount less than required |
| `SIMULATION_FAILED` | 402 | Transaction simulation reverted |
| `INVALID_CREDENTIAL` | 400 | Credential JSON failed schema validation |
| `INTERNAL_ERROR` | 500 | Unexpected server-side error |

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Challenge generation: assert nonce entropy, schema validity, TTL encoding
- Credential verification: mock RPC responses for each verification step; assert each error code triggers correctly
- Replay protection: assert duplicate `txHash` is rejected after first acceptance
- Schema validation: test malformed payloads against all zod schemas

### 10.2 Integration Tests

- Run against BSC Testnet (chainId 97) using funded test wallets
- Full charge flow: native BNB and USDT BEP-20
- Fee sponsorship flow end-to-end
- Replay attack: replay same `txHash`, assert `REPLAY_DETECTED`
- Expired challenge: assert `CHALLENGE_EXPIRED` after TTL

### 10.3 Demo Application

Express server + React frontend mirroring the Solana MPP demo:
- Charge flow demo at `/charges` — native BNB and USDT
- Error scenario demo — expired challenges, replays, wrong amounts
- Configurable chain selection (BSC mainnet / testnet / opBNB)

---

## 11. Network Support

| Network | Chain ID | Default RPC | Status |
|---|---|---|---|
| BSC Mainnet | 56 | `https://bsc-dataseed.binance.org` | v1 target |
| BSC Testnet | 97 | `https://data-seed-prebsc-1-s1.binance.org:8545` | v1 testing |
| opBNB Mainnet | 204 | `https://opbnb-mainnet-rpc.bnbchain.org` | v1 target |
| opBNB Testnet | 5611 | `https://opbnb-testnet-rpc.bnbchain.org` | v1 testing |

---

## 12. Milestone Plan

| Milestone | Deliverable | Target |
|---|---|---|
| M1 — Core Scaffold | Package structure, shared zod schemas, constants registry, CI setup | Week 1 |
| M2 — Server Charge | `bnb.charge()` server method, challenge generation, full verification pipeline, `InMemoryStore` | Week 2–3 |
| M3 — Client Charge | `bnb.charge()` client method, viem signer adapter, automatic 402 retry loop | Week 3–4 |
| M4 — Fee Sponsorship | EIP-712 authorization flow, sponsored tx broadcast, server gas wallet integration | Week 5–6 |
| M5 — Persistent Store | `RedisStore` adapter, TTL-based nonce expiry, replay protection hardening | Week 6 |
| M6 — Demo & Docs | Express + React demo app, README, API reference, npm publish | Week 7–8 |

---

## 13. Open Questions

- **opBNB finality**: opBNB has ~1s block times. Should default `confirmations` be higher to account for reorg risk?
- **Permit2 integration**: Uniswap's Permit2 is deployed on BSC. Should fee sponsorship use Permit2 instead of a custom EIP-712 schema for better wallet compatibility?
- **MPP spec finalization**: the upstream spec is not yet finalized. How tightly should `@bnb/mpp` track the Solana wire format vs define its own EVM-idiomatic schema?
- **Protocol registry**: should `@bnb/mpp` register as an official MPP payment method at paymentauth.org once the spec stabilizes?

---

## 14. References

- Machine Payments Protocol: https://mpp.dev
- HTTP Payment Authentication Scheme: https://paymentauth.org
- Solana MPP SDK (reference): https://github.com/solana-foundation/mpp-sdk
- BNB Chain RPC Docs: https://docs.bnbchain.org/bnb-smart-chain/developers/rpc
- viem: https://viem.sh
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
