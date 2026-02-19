# x402 Payment Protocol — Developer Guide

This guide explains how the x402 payment protocol works in this MCP server, what happens when you hit an HTTP 402 response, and how to make sure your setup handles payments automatically.

> **⚠️ This guide only applies if you are authenticating via API Key (`INDEXY_API_KEY`).**
>
> If you are running `index.js` with a Web3 wallet (`OWNER_WALLET_PRIVATE_KEY` or `OWNER_WALLET_KEYSTORE_PATH`options), the MCP already handles x402 payments automatically on your behalf and no additional setup is needed (apart of running the MCP in this repository and having USDC in the wallet associated). The ERC-8004 wallet identity is used to sign and submit payments transparently for every paid request.
>
> Only read on if you are calling the Indexy API directly with an API Key and need to handle 402 responses yourself.

---

## What is x402?

[x402](https://x402.org) is an HTTP-native payment protocol. When a client calls a paid API endpoint without sufficient funds or without a payment client configured, the server responds with:

```
HTTP 402 Payment Required
```

The x402 client intercepts this response, signs and submits an on-chain payment (USDC on Base), and retries the request automatically — all transparent to the caller.

---

## Which endpoints require payment?

| Endpoint | Cost | Notes |
|----------|------|-------|
| `POST /beta/indexes/agent` | 1.0 USDC | First 3 indices per agent are free; charged from the 4th onwards |
| `GET /beta/indexes/:indexId` | 0.5 USDC | Free for the index owner; charged for any other caller |

More endpoints may be added over time. If you receive a 402 from any endpoint, the same setup applies.

---

## How automatic payments work in this MCP

The MCP server wraps the native `fetch` function using `@x402/fetch`:

```js
paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:*",        // All EVM chains, including Base (8453)
      client: new ExactEvmScheme(viemAccount),
    },
  ],
});
```

Every outbound API request uses `paidFetch` when available. If the server returns a 402, the x402 client:

1. Reads the `X-Payment-Requirements` header from the 402 response
2. Builds and signs an on-chain payment transaction using your wallet
3. Retries the original request with the payment proof in the `X-Payment` header
4. Returns the successful response to the caller

**No manual intervention is required.** As long as your wallet has USDC on Base, payments are handled automatically.

---

## Prerequisites

### 1. Use Web3 authentication

x402 payments are **only available with Web3 auth**. API Key mode does not support payments.

| Auth mode | x402 support |
|-----------|-------------|
| `OWNER_WALLET_PRIVATE_KEY` | ✅ Yes |
| `OWNER_WALLET_KEYSTORE_PATH` | ✅ Yes |
| `INDEXY_API_KEY` | ❌ No |

### 2. Fund your wallet with USDC on Base

Your wallet needs USDC on **Base mainnet** (chain ID `8453`).

- Get USDC on Base via [Coinbase](https://www.coinbase.com), [Bridge](https://bridge.xyz), or any Base-compatible DEX
- Minimum recommended balance: **$5–10 USDC** to cover multiple operations
- Costs per operation: **1.00 USDC** to create an index (after the first 3 free ones), **0.50 USDC** to fetch a public index you don't own

### 3. Install required packages

```bash
npm install @x402/evm @x402/fetch viem ethers
```

These are already listed as dependencies in `package.json`.

---

## Configuration

### Option A — Private Key (recommended for agents)

```json
{
  "mcpServers": {
    "indexy": {
      "command": "node",
      "args": ["/path/to/index.js"],
      "env": {
        "INDEXY_API_URL": "https://indexy.co",
        "OWNER_WALLET_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY",
        "OWNER_WALLET_CHAIN": "base"
      }
    }
  }
}
```

### Option B — Encrypted Keystore (more secure)

```json
{
  "mcpServers": {
    "indexy": {
      "command": "node",
      "args": ["/path/to/index.js"],
      "env": {
        "INDEXY_API_URL": "https://indexy.co",
        "OWNER_WALLET_KEYSTORE_PATH": "/path/to/keystore.json",
        "OWNER_WALLET_PASSWORD": "your-keystore-password",
        "OWNER_WALLET_CHAIN": "base"
      }
    }
  }
}
```

---

## What happens if you get a 402 error

If the 402 is **not automatically resolved**, it means one of the following:

### Case 1: You are using API Key auth

x402 payments require a Web3 wallet. Switch to `OWNER_WALLET_PRIVATE_KEY` or `OWNER_WALLET_KEYSTORE_PATH`.

### Case 2: Wallet has no USDC on Base

The payment cannot be submitted without funds. Bridge or buy USDC on Base and ensure it is in the wallet configured via `OWNER_WALLET_PRIVATE_KEY`.

Check your balance:
```bash
# Using cast (Foundry)
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  "balanceOf(address)(uint256)" \
  YOUR_WALLET_ADDRESS \
  --rpc-url https://mainnet.base.org
```
> `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` is the USDC contract address on Base.

### Case 3: x402 packages failed to load

Check startup logs for:
```
[INDEXY-MCP] Warning: Could not initialize x402 client: ...
[INDEXY-MCP] Continuing without x402 support - paid endpoints will fail
```

Fix: ensure `@x402/evm`, `@x402/fetch`, and `viem` are installed.

```bash
npm install @x402/evm @x402/fetch viem
```

### Case 4: Network or timeout issues

The MCP uses a 60-second timeout to allow for on-chain payment settlement. If you are on a slow connection or the Base network is congested, the payment may time out.

The error will read:
```
Request timeout after 60 seconds: POST https://indexy.co/beta/indexes/agent
```

Wait and retry. No duplicate payment will be submitted.

---

## Implementing x402 in your own client (outside this MCP)

If you are building a custom client that calls Indexy endpoints directly, here is the minimal setup:

### Node.js / TypeScript

```ts
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY");

const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:8453", // Base mainnet
      client: new ExactEvmScheme(account),
    },
  ],
});

// Use paidFetch exactly like fetch — 402s are handled automatically

// Example 1: create an index (1.00 USDC, first 3 are free)
const res = await paidFetch("https://indexy.co/beta/indexes/agent", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_API_KEY",
  },
  body: JSON.stringify({ name: "My Index", selectedAssets: [...], ... }),
});

// Example 2: fetch a public index you don't own (0.50 USDC)
const res2 = await paidFetch("https://indexy.co/beta/indexes/42", {
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
  },
});

const data = await res.json();
console.log(data);
```

### How the payment flow works under the hood

```
Client                              Server
  |                                    |
  |-- POST /beta/indexes/agent ------> |
  |                                    |
  |<-- 402 Payment Required ---------- |
  |    X-Payment-Requirements:         |
  |    { amount: 1.00 USDC, chain: 8453, token: 0x833...}
  |                                    |
  | [x402 client signs tx]             |
  | [submits payment on Base]          |
  |                                    |
  |-- POST /beta/indexes/agent ------> |
  |   X-Payment: <proof>               |
  |                                    |
  |<-- 200 OK + index data ----------- |
```

---

## Summary checklist

Before calling a paid endpoint, verify:

- [ ] Using `OWNER_WALLET_PRIVATE_KEY` or `OWNER_WALLET_KEYSTORE_PATH` (not API Key)
- [ ] Wallet has USDC on **Base mainnet**
- [ ] `@x402/evm`, `@x402/fetch`, and `viem` are installed
- [ ] MCP startup log shows: `x402 payment client initialized - automatic payments enabled`
- [ ] `OWNER_WALLET_CHAIN` is set to `base`

If all of the above are met, 402 responses will be resolved automatically with no changes to your code.

---

## References

- [x402 Protocol Specification](https://x402.org)
- [Base Network — USDC](https://www.base.org)
- [@x402/fetch on npm](https://www.npmjs.com/package/@x402/fetch)
- [@x402/evm on npm](https://www.npmjs.com/package/@x402/evm)
- [USDC on Base — Contract](https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913)
