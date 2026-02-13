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
| **Web3 Private Key** (recommended for agents) | `INDEXY_WALLET_PRIVATE_KEY` |
| **Web3 Keystore** (encrypted, more secure on disk) | `INDEXY_WALLET_KEYSTORE_PATH` + `INDEXY_WALLET_PASSWORD` |
| **API Key** | `INDEXY_API_KEY` |

Web3 modes require the wallet to be registered on an ERC-8004 registry.

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXY_API_URL` | `https://indexy.co` | API base URL |
| `INDEXY_WALLET_CHAIN` | `base` | Blockchain for Web3 auth |

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
        "INDEXY_WALLET_PRIVATE_KEY": "0xabc123...",
        "INDEXY_WALLET_CHAIN": "base"
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
        "INDEXY_WALLET_KEYSTORE_PATH": "/path/to/keystore.json",
        "INDEXY_WALLET_PASSWORD": "your-keystore-password",
        "INDEXY_WALLET_CHAIN": "base"
      }
    }
  }
}
```

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

- `indexy://docs/overview` -- API overview and endpoint list
- `indexy://docs/create-index` -- Guide to creating indices
- `indexy://docs/update-index` -- Guide to rebalancing/updating indices
- `indexy://docs/validation` -- Validation rules for names, weights, assets
- `indexy://docs/public-endpoints` -- Public read-only endpoints
- `indexy://docs/kpis` -- KPI metrics reference
- `indexy://docs/mindshare` -- Mindshare data reference
- `indexy://docs/profile` -- Profile management guide

## Index Creation Quick Reference

When creating an index, you need:

- **name** -- up to 40 characters
- **selectedAssets** -- 1-50 assets, each with `contractAddress`, `network`, and `weight` (weights must sum to 100)
- **methodologyAssetEligibility** -- criteria for token inclusion
- **methodologyWeightCaps** -- weight distribution rules
- **methodologyRebalancingCadence** -- rebalancing schedule

Tokens are validated against CoinGecko in real-time. Supported networks include: `ethereum`, `base`, `polygon-pos`, `binance-smart-chain`, `arbitrum-one`, `optimistic-ethereum`, `avalanche`, `solana`, and others listed on [CoinGecko's network reference](https://docs.coingecko.com/reference/networks-list).

## License

See repository for license information.
