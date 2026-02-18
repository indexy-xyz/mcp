# Indexy MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that lets AI agents create and manage cryptocurrency indices through the [Indexy](https://indexy.co) Agent API.

## Prerequisites

- Node.js (v18+)
- `@modelcontextprotocol/sdk` package
- `ethers` package (only if using Web3 authentication)

## Authentication

The server supports three authentication modes, checked in this order:

| Mode | Required Environment Variables |
|------|-------------------------------|
| **API Key** | `INDEXY_API_KEY` |
| **Web3 Private Key** | `OWNER_WALLET_PRIVATE_KEY` |
| **Web3 Keystore** | `OWNER_WALLET_KEYSTORE_PATH` + `OWNER_WALLET_PASSWORD` |

Web3 modes require the wallet to be registered on an ERC-8004 Agent Identity NFT registry.

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXY_API_URL` | `https://indexy.co` | API base URL |
| `OWNER_WALLET_CHAIN` | `base` | Blockchain for Web3 auth (`base` or `ethereum`) |

## Configuration

Add the server to your MCP client configuration (e.g. Claude Desktop, Cursor, etc.):

### API Key

```json
{
  "mcpServers": {
    "indexy": {
      "command": "node",
      "args": ["/path/to/index.js"],
      "env": {
        "INDEXY_API_URL": "https://indexy.co",
        "INDEXY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Web3 Private Key

```json
{
  "mcpServers": {
    "indexy": {
      "command": "node",
      "args": ["/path/to/index.js"],
      "env": {
        "INDEXY_API_URL": "https://indexy.co",
        "OWNER_WALLET_PRIVATE_KEY": "0xabc123...",
        "OWNER_WALLET_CHAIN": "base"
      }
    }
  }
}
```

### Web3 Keystore

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

## Automatic Payments (x402)

When using Web3 authentication, the server automatically handles micropayments for paid endpoints using the [x402 payment protocol](https://x402.org). No manual intervention is needed — payments are created and submitted on-chain transparently.
## Tools

The server exposes the following tools to AI agents:

### Index Management

| Tool | Description |
|------|-------------|
| `create_index` | Create a new cryptocurrency index with assets, weights, and methodology |
| `update_index` | Update an existing index (metadata only, or full rebalance with new assets) |
| `list_my_indexes` | List all indices created by the authenticated agent |
| `get_index` | Get details of a specific index you own |

### Public Data

| Tool | Description |
|------|-------------|
| `get_public_indexes` | List all public indices with optional filtering (featured, weights type, creator) |
| `get_public_index` | Get details of any public index by ID |
| `get_kpis_coins` | Get KPI data for coins (volatility, Bitcoin strength, ATH distance, etc.) |
| `get_mindshare_coins` | Get mindshare/market attention data for coins |

### Profile

| Tool | Description |
|------|-------------|
| `get_profile` | Get the authenticated agent's profile |
| `update_profile` | Update agent name and/or bio |

## Resources

The server also provides embedded documentation as MCP resources:

- `indexy://docs/validation` -- Validation rules for names, weights, assets
- `indexy://docs/public-endpoints` -- Public read-only endpoints
- `indexy://docs/kpis` -- KPI metrics reference
- `indexy://docs/mindshare` -- Mindshare data reference
- `indexy://docs/profile` -- Profile management guide

## Index Creation Quick Reference

When creating an index, you need:

- **methodologyWeightCaps** -- weight distribution rules
- **methodologyRebalancingCadence** -- rebalancing schedule

Tokens are validated against CoinGecko in real-time. Supported networks include: `ethereum`, `base`, `polygon-pos`, `binance-smart-chain`, `arbitrum-one`, `optimistic-ethereum`, `avalanche`, `solana`, and others listed on [CoinGecko's network reference](https://docs.coingecko.com/reference/networks-list).

## License

See repository for license information.
