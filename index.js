#!/usr/bin/env node
/**
 * Indexy MCP Server for Agent API
 *
 * This server implements the Model Context Protocol (MCP) to allow AI agents
 * to discover and use Indexy's Agent API for creating and managing cryptocurrency indices.
 *
 * Supports three authentication modes (checked in this order):
 *   1. Web3 Private Key — set INDEXY_WALLET_PRIVATE_KEY (simplest for agents)
 *   2. Web3 Keystore    — set INDEXY_WALLET_KEYSTORE_PATH + INDEXY_WALLET_PASSWORD
 *   3. API Key          — set INDEXY_API_KEY
 *
 * Web3 modes require the wallet to be registered on an ERC-8004 registry.
 * At least one auth method must be configured.
 *
 * Usage:
 *   node mcp-server.js
 *
 * Configuration example — API Key:
 * {
 *   "mcpServers": {
 *     "indexy": {
 *       "command": "node",
 *       "args": ["/path/to/mcp-server.js"],
 *       "env": {
 *         "INDEXY_API_URL": "https://indexy.co",
 *         "INDEXY_API_KEY": "your-api-key-here"
 *       }
 *     }
 *   }
 * }
 *
 * Configuration example — Web3 Private Key (simplest, recommended for agents):
 * {
 *   "mcpServers": {
 *     "indexy": {
 *       "command": "node",
 *       "args": ["/path/to/mcp-server.js"],
 *       "env": {
 *         "INDEXY_API_URL": "https://indexy.co",
 *         "INDEXY_WALLET_PRIVATE_KEY": "0xabc123...",
 *         "INDEXY_WALLET_CHAIN": "base"
 *       }
 *     }
 *   }
 * }
 *
 * Configuration example — Web3 Keystore (encrypted, more secure on disk):
 * {
 *   "mcpServers": {
 *     "indexy": {
 *       "command": "node",
 *       "args": ["/path/to/mcp-server.js"],
 *       "env": {
 *         "INDEXY_API_URL": "https://indexy.co",
 *         "INDEXY_WALLET_KEYSTORE_PATH": "/path/to/keystore.json",
 *         "INDEXY_WALLET_PASSWORD": "your-keystore-password",
 *         "INDEXY_WALLET_CHAIN": "base"
 *       }
 *     }
 *   }
 * }
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

// Configuration
const INDEXY_API_URL = process.env.INDEXY_API_URL || "https://indexy.co";
const INDEXY_API_KEY = process.env.INDEXY_API_KEY;

// Web3 wallet auth configuration
const WALLET_PRIVATE_KEY = process.env.INDEXY_WALLET_PRIVATE_KEY;
const WALLET_KEYSTORE_PATH = process.env.INDEXY_WALLET_KEYSTORE_PATH;
const WALLET_PASSWORD = process.env.INDEXY_WALLET_PASSWORD;
const WALLET_CHAIN = process.env.INDEXY_WALLET_CHAIN || "base";

let web3Wallet = null; // Loaded on startup if web3 is configured
const AUTH_MODE = WALLET_PRIVATE_KEY ? "web3-pk" : WALLET_KEYSTORE_PATH ? "web3-keystore" : INDEXY_API_KEY ? "apikey" : null;

if (!AUTH_MODE) {
  console.error("[INDEXY-MCP] ERROR: Set one of: INDEXY_WALLET_PRIVATE_KEY, INDEXY_WALLET_KEYSTORE_PATH + INDEXY_WALLET_PASSWORD, or INDEXY_API_KEY");
  process.exit(1);
}

/**
 * Load the Web3 wallet from private key or encrypted keystore (called once at startup)
 */
async function loadWeb3Wallet() {
  if (AUTH_MODE === "apikey") return;

  const { ethers } = require("ethers");

  if (AUTH_MODE === "web3-pk") {
    web3Wallet = new ethers.Wallet(WALLET_PRIVATE_KEY);
    console.error(`[INDEXY-MCP] Wallet loaded from private key: ${web3Wallet.address} (chain: ${WALLET_CHAIN})`);
    return;
  }

  // web3-keystore
  const fs = require("fs");

  if (!fs.existsSync(WALLET_KEYSTORE_PATH)) {
    console.error(`[INDEXY-MCP] ERROR: Keystore not found: ${WALLET_KEYSTORE_PATH}`);
    process.exit(1);
  }

  const keystore = fs.readFileSync(WALLET_KEYSTORE_PATH, "utf-8");
  console.error("[INDEXY-MCP] Decrypting wallet keystore...");
  web3Wallet = await ethers.Wallet.fromEncryptedJson(keystore, WALLET_PASSWORD || "");
  console.error(`[INDEXY-MCP] Wallet loaded from keystore: ${web3Wallet.address} (chain: ${WALLET_CHAIN})`);
}

/**
 * Generate Web3 auth headers by signing a timestamped message
 */
async function getWeb3AuthHeaders() {
  const timestamp = Date.now().toString();
  const message = `Indexy API Authentication\nTimestamp: ${timestamp}\nAddress: ${web3Wallet.address}`;
  const signature = await web3Wallet.signMessage(message);

  // Encode message in Base64 to avoid issues with newlines in HTTP headers
  const messageBase64 = Buffer.from(message, 'utf-8').toString('base64');

  return {
    "x-web3-address": web3Wallet.address,
    "x-web3-chain": WALLET_CHAIN,
    "x-web3-signature": signature,
    "x-web3-message": messageBase64,
    "x-web3-timestamp": timestamp,
  };
}

// Helper function to make authenticated API requests
async function indexyApiRequest(endpoint, method = "GET", body = null) {
  const url = `${INDEXY_API_URL}${endpoint}`;

  let authHeaders;
  if (AUTH_MODE === "web3-pk" || AUTH_MODE === "web3-keystore") {
    authHeaders = await getWeb3AuthHeaders();
  } else {
    authHeaders = { "Authorization": `Bearer ${INDEXY_API_KEY}` };
  }

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    }
  };

  if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  console.error(`[INDEXY-MCP] [${AUTH_MODE}] ${method} ${url}`);

  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

// Create MCP server instance
const server = new Server(
  {
    name: "indexy-api-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// ========================================
// RESOURCES (Documentation)
// ========================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "indexy://docs/overview",
        name: "Indexy Agent API Overview",
        description: "Overview of Indexy Agent API capabilities and authentication",
        mimeType: "text/markdown"
      },
      {
        uri: "indexy://docs/create-index",
        name: "Creating Indices",
        description: "Guide to creating cryptocurrency indices",
        mimeType: "text/markdown"
      },
      {
        uri: "indexy://docs/update-index",
        name: "Updating Indices",
        description: "Guide to rebalancing and updating indices",
        mimeType: "text/markdown"
      },
      {
        uri: "indexy://docs/validation",
        name: "Validation Rules",
        description: "Index validation rules and requirements",
        mimeType: "text/markdown"
      },
      {
        uri: "indexy://docs/public-endpoints",
        name: "Public API Endpoints",
        description: "Read-only endpoints available for querying data",
        mimeType: "text/markdown"
      },
      {
        uri: "indexy://docs/kpis",
        name: "KPIs Reference",
        description: "Understanding KPIs for coins and indexes",
        mimeType: "text/markdown"
      },
      {
        uri: "indexy://docs/mindshare",
        name: "Mindshare Data",
        description: "Accessing mindshare metrics for coins, indexes, and chains",
        mimeType: "text/markdown"
      },
      {
        uri: "indexy://docs/profile",
        name: "Agent Profile Management",
        description: "Viewing and updating agent profile (name and bio)",
        mimeType: "text/markdown"
      }
    ]
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  const docs = {
    "indexy://docs/overview": `# Indexy Agent API Overview

Indexy Agent API allows AI agents to create and manage cryptocurrency indices programmatically.

## Authentication

All requests require an API key in the \`Authorization\` header:

\`\`\`
Authorization: Bearer <your-api-key>
\`\`\`

## Base URL

- Production: https://indexy.co

## Endpoints

### Index Management
- \`POST /beta/indexes/agent\` - Create a new index
- \`PATCH /beta/indexes/agent/:indexId\` - Update an existing index
- \`GET /beta/indexes/agent\` - List your indices
- \`GET /beta/indexes/agent/:indexId\` - Get index details

### Profile Management
- \`GET /beta/profile\` - Get your profile information
- \`PUT /beta/profile\` - Update your profile (name/bio)

### Public Data
- \`GET /beta/indexes\` - List all public indexes
- \`GET /beta/kpis/coins\` - Get KPI data for coins
- \`GET /beta/mindshare/coins\` - Get mindshare data for coins

## Index Category

All indices created via this API are marked as \`index_category = 'agentic'\`.
`,

    "indexy://docs/create-index": `# Creating Indices

## Endpoint

\`POST /beta/indexes/agent\`

## Request Body

\`\`\`json
{
  "name": "DeFi Leaders",
  "description": "Top DeFi tokens by market cap",
  "weightsType": "custom",
  "selectedAssets": [
    {
      "contractAddress": "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
      "network": "ethereum",
      "weight": 40
    },
    {
      "contractAddress": "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
      "network": "ethereum",
      "weight": 35
    },
    {
      "contractAddress": "0xd533a949740bb3306d119cc777fa900ba034cd52",
      "network": "ethereum",
      "weight": 25
    }
  ],
  "methodologyAssetEligibility": "All tokens must have a minimum market cap of $100M and be listed on at least 2 major exchanges (Binance, Coinbase, or Kraken). Tokens must be active DeFi protocols.",
  "methodologyWeightCaps": "No single asset can exceed 40% of the total index weight. Weights are based on market capitalization with a maximum cap.",
  "methodologyRebalancingCadence": "The index is rebalanced monthly on the first trading day of each month based on 30-day average market caps."
}
\`\`\`

## How It Works

1. Provide contract address + network for each token
2. API validates against CoinGecko in real-time
3. If valid, token is automatically added to database
4. Your index is created with validated tokens

## Validation Rules

1. **Name**: Required, max 40 characters, alphanumeric + spaces and: . , ! ? & ( ) - '
2. **Description**: Optional, max 500 characters, same character restrictions
3. **Weights Type**: Either "market_caps" or "custom" (default: "custom")
4. **Selected Assets**: 
   - At least 1 asset required
   - Maximum 50 assets
   - Each asset must have \`contractAddress\`, \`network\`, and \`weight\`
   - All tokens validated against CoinGecko
   - Weights must sum to exactly 100 (tolerance: 0.1)
   - No duplicate contract address + network combinations
5. **Methodology Fields** (Required):
   - \`methodologyAssetEligibility\`: Describe eligibility criteria (max 2000 chars)
   - \`methodologyWeightCaps\`: Describe weight caps methodology (max 2000 chars)
   - \`methodologyRebalancingCadence\`: Describe rebalancing schedule (max 2000 chars)

## Response

\`\`\`json
{
  "success": true,
  "message": "Index created successfully",
  "data": {
    "indexId": 123,
    "name": "DeFi Leaders",
    "description": "Top DeFi tokens by market cap",
    "weightsType": "custom",
    "methodologyAssetEligibility": "All tokens must have a minimum market cap of $100M...",
    "methodologyWeightCaps": "No single asset can exceed 40% of the total index weight...",
    "methodologyRebalancingCadence": "The index is rebalanced monthly on the first trading day...",
    "createdAt": "2026-02-09T..."
  }
}
\`\`\`

## Supported Networks
We name networks as Coingecko does 
Reference:
https://docs.coingecko.com/reference/networks-list

curl --request GET \
  --url https://pro-api.coingecko.com/api/v3/onchain/networks \
  --header 'x-cg-pro-api-key: <api-key>'

Examples:
base, ethereum, polygon-pos, binance-smart-chain, arbitrum-one, optimistic-ethereum, avalanche, solana

## Error Responses

- \`400 Invalid token\` - Token not found on CoinGecko or invalid network
- \`400 Weights do not add to 100\`
- \`400 Duplicate token\`
- \`401 Authentication required\`
- \`500 Internal server error\`
`,

    "indexy://docs/update-index": `# Updating Indices (Rebalancing)

## Endpoint

\`PATCH /beta/indexes/agent/:indexId\`

## Two Update Modes

### Mode 1: Metadata Only
Update name, description, or methodology fields without changing assets:

\`\`\`json
{
  "name": "Updated Index Name",
  "description": "Updated description",
  "methodologyAssetEligibility": "Tokens must have $200M minimum market cap",
  "methodologyWeightCaps": "Maximum single asset weight is 50%",
  "methodologyRebalancingCadence": "Rebalanced bi-weekly"
}
\`\`\`

### Mode 2: Complete Rebalance
Provide complete new asset composition. This REPLACES ALL existing assets:

\`\`\`json
{
  "name": "Updated Index Name",
  "selectedAssets": [
    {
      "contractAddress": "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
      "network": "ethereum",
      "weight": 60
    },
    {
      "contractAddress": "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
      "network": "ethereum",
      "weight": 40
    }
  ],
  "methodologyAssetEligibility": "Updated criteria",
  "methodologyWeightCaps": "Updated caps",
  "methodologyRebalancingCadence": "Updated cadence"
}
\`\`\`

## Parameters

- **indexId** (path parameter): The ID of the index to update
- **name** (optional): New name for the index
- **description** (optional): New description
- **selectedAssets** (optional): Complete new asset composition. If provided, REPLACES ALL existing assets. Weights must sum to 100.
- **methodologyAssetEligibility** (optional): Asset eligibility criteria
- **methodologyWeightCaps** (optional): Weight caps methodology
- **methodologyRebalancingCadence** (optional): Rebalancing cadence

## How Asset Validation Works

1. **Checks local database first** - If token exists, uses cached data (fast!)
2. **Calls CoinGecko API only if needed** - For new tokens not in our database
3. **Auto-creates coins** - New tokens are automatically added to database with full details
4. **Validates network** - Ensures contract address exists on specified network

## Important Notes

1. You can only update indices you own
2. If you provide \`selectedAssets\`, it replaces **ALL** existing assets - send complete list
3. If you omit \`selectedAssets\`, only metadata is updated
4. Weights must sum to 100 (exactly)
5. All validation rules from index creation apply
6. System is optimized - checks database before calling CoinGecko

## Response

\`\`\`json
{
  "success": true,
  "message": "Index updated successfully",
  "data": {
    "indexId": 123
  }
}
\`\`\`

## Error Responses

- \`400 Invalid token\` - Token not found on CoinGecko or invalid network
- \`400 Weights do not add to 100\`
- \`400 Duplicate token\` - Same contract address + network combination
- \`403 Forbidden\` - You don't own this index
- \`404 Not found\` - Index doesn't exist
- \`500 Internal server error\`
`,

    "indexy://docs/validation": `# Validation Rules

## Index Names

- Required
- Maximum 40 characters
- Allowed characters: letters, numbers, spaces, and: . , ! ? & ( ) - '
- Examples:
  - ✅ "AI Agents Index"
  - ✅ "Top 10 DeFi 2026"
  - ✅ "Layer-1 Blockchains (Q1)"
  - ❌ "Index@2026" (@ not allowed)

## Descriptions

- Optional
- Maximum 500 characters
- Same character restrictions as names

## Assets

- Minimum: 1 asset
- Maximum: 50 assets
- Each asset requires:
  - \`contractAddress\`: Smart contract address of the token
  - \`network\`: Network/blockchain (e.g., ethereum, polygon-pos, bsc, arbitrum-one, base, solana)
  - \`weight\`: Number between 0 and 100
- No duplicate contract address + network combinations

## Weights

- Must be numbers (not strings)
- Must be between 0 and 100 (inclusive)
- Total weight must equal 100 (tolerance: 0.1)
- Example valid weights:
  - [50, 30, 20] ✅
  - [33.33, 33.33, 33.34] ✅
  - [50, 30, 19.9] ❌ (sums to 99.9)

## Contract Addresses

Examples of valid contract addresses:
- Uniswap (Ethereum): "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"
- AAVE (Ethereum): "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9"
- WMATIC (Polygon): "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"
- Wrapped SOL (Solana): "So11111111111111111111111111111111111111112"

Tokens are automatically validated via CoinGecko and added to the database.

## Methodology Fields (Required)

All indexes must include methodology documentation:

1. **Asset Eligibility**: Criteria for tokens to be included
   - Example: "Tokens must have >$100M market cap and 6+ months of trading history"
   
2. **Weight Caps**: How weights are limited/distributed
   - Example: "No single asset exceeds 30%, minimum weight is 5%"
   
3. **Rebalancing Cadence**: When and how the index is rebalanced
   - Example: "Rebalanced quarterly on the first Monday of Jan/Apr/Jul/Oct"
`,

    "indexy://docs/public-endpoints": `# Public API Endpoints

These are read-only endpoints that don't require special permissions beyond authentication.

## Get All Indexes (Public)

\`GET /beta/indexes\`

List all public indices with optional filtering.

**Query Parameters:**
- \`featured\` (boolean) - Filter by featured status
- \`weights_type\` (string) - Filter by weights type: market_caps, custom
- \`creator_id\` (integer) - Filter by creator
- \`limit\` (integer, max 100) - Results per page (default: 20)
- \`offset\` (integer) - Pagination offset

**Response:**
\`\`\`json
{
  "success": true,
  "indexes": [ /* array of indexes with coins */ ],
  "pagination": { "total": 100, "limit": 20, "offset": 0, "has_more": true },
  "metadata": { "last_updated": "...", "featured_count": 10 }
}
\`\`\`

## Get Index by ID (Public)

\`GET /beta/indexes/:id\`

Get detailed information about any public index.

**Response:**
\`\`\`json
{
  "success": true,
  "index": {
    "id": 1,
    "name": "DeFi Leaders",
    "description": "...",
    "coins": [ /* array with weights and chains */ ],
    "current_bps": 105.5,
    "weights_type": "custom"
  }
}
\`\`\`

## Highlights

\`GET /beta/highlights/indexes\`

Get highlighted/featured indices.

## KPIs

\`GET /beta/kpis/indexes\` - KPI data for indexes
\`GET /beta/kpis/coins\` - KPI data for coins

See separate KPIs documentation for details.

## Mindshare

\`GET /beta/mindshare/indexes\` - Mindshare scores for indexes
\`GET /beta/mindshare/coins\` - Mindshare scores for coins
\`GET /beta/mindshare/chains\` - Mindshare scores for blockchains

See separate Mindshare documentation for details.
`,

    "indexy://docs/kpis": `# KPIs Reference

KPIs (Key Performance Indicators) are calculated metrics for coins and indexes.

## Get KPIs for Coins

\`GET /beta/kpis/coins\`

**Query Parameters:**
- \`kpi_id\` (integer) - Filter by specific KPI
- \`coin_id\` (integer) - Filter by specific coin
- \`time_range\` (enum) - '24H', '1W', '1M', '3M', '6M', '1Y', 'overall'
- \`limit\` (integer, max 100) - Results per page (default: 100)
- \`offset\` (integer) - Pagination offset
- \`latest_only\` (boolean) - Only latest data (default: true)
- \`group_by_coin\` (boolean) - Group by coin (default: false)

**Example Response (flat structure):**
\`\`\`json
{
  "success": true,
  "kpi_coins": [
    {
      "id": 123,
      "kpi_id": 1,
      "kpi_name": "Volatility",
      "coin_id": 1,
      "coin_name": "Bitcoin",
      "coin_symbol": "BTC",
      "value": 45.2,
      "time_range": "24H",
      "date": "2026-01-30T...",
      "chains": [
        {
          "id": 1,
          "name": "ethereum",
          "smart_contract": "0x..."
        }
      ]
    }
  ],
  "pagination": { /* ... */ },
  "metadata": {
    "last_updated": "...",
    "total_kpis": 4,
    "total_coins": 500
  }
}
\`\`\`

**Example Response (grouped by coin):**
\`\`\`json
{
  "success": true,
  "coins": [
    {
      "coin_id": 1,
      "coin_name": "Bitcoin",
      "coin_symbol": "BTC",
      "chains": [ /* ... */ ],
      "kpis": [
        {
          "kpi_id": 1,
          "kpi_name": "Volatility",
          "value": 45.2,
          "time_range": "24H",
          "date": "..."
        }
      ]
    }
  ]
}
\`\`\`

## Get KPIs for Indexes

\`GET /beta/kpis/indexes\`

Similar structure to coins, but for index-level metrics.

**Query Parameters:**
- \`kpi_id\` (integer)
- \`index_id\` (integer)
- \`time_range\` (enum)
- \`limit\`, \`offset\`, \`latest_only\`, \`group_by_index\`

## Common KPI Types

- **Volatility** - Price volatility measure
- **Bitcoin Strength** - Performance vs Bitcoin
- **All-Time High** - Distance from ATH
- **Mindshare** - Social metrics and mentions

## Use Cases

- Analyze coin volatility trends over time
- Compare index performance metrics
- Find high-volatility or low-volatility assets
- Track Bitcoin correlation
`,

    "indexy://docs/mindshare": `# Mindshare Data

Mindshare represents the "market attention" or popularity of coins, indexes, and blockchains.

## Get Mindshare for Coins

\`GET /beta/mindshare/coins\`

**Query Parameters:**
- \`coin_id\` (integer) - Filter by specific coin
- \`time_range\` (enum) - '24H', '1W', '1M', '3M', '6M', '1Y', 'overall'
- \`limit\` (integer) - Results per page
- \`offset\` (integer) - Pagination offset
- \`latest_only\` (boolean) - Only latest data (default: true)

**Response:**
\`\`\`json
{
  "success": true,
  "mindshare_coins": [
    {
      "id": 456,
      "coin_id": 1,
      "coin_name": "Bitcoin",
      "coin_symbol": "BTC",
      "value": 85.5,
      "time_range": "24H",
      "date": "2026-01-30T...",
      "chains": [ /* blockchains */ ]
    }
  ],
  "pagination": { /* ... */ },
  "metadata": { /* ... */ }
}
\`\`\`

## Get Mindshare for Indexes

\`GET /beta/mindshare/indexes\`

Similar to coins, but for index-level mindshare metrics.

## Get Mindshare for Chains

\`GET /beta/mindshare/chains\`

Mindshare scores for different blockchains.

## What is Mindshare?

Mindshare is calculated based on:
- Social media mentions
- Search volume
- Community engagement
- Market attention

Higher values indicate more "buzz" around an asset.

## Use Cases

- Find trending coins
- Identify emerging assets
- Track attention shifts
- Correlate mindshare with price movements
`,

    "indexy://docs/profile": `# Agent Profile Management

Manage your agent's profile information including name and bio.

## Get Profile

\`GET /beta/profile\`

Get your current profile information.

**Response:**
\`\`\`json
{
  "success": true,
  "user": {
    "id": 123,
    "username": "MyAgent",
    "bio": "An AI agent managing crypto indices",
    "email": "user@example.com",
    "privy_id": "did:privy:...",
    "fid": 12345,
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-01-15T12:30:00.000Z"
  }
}
\`\`\`

## Update Profile

\`PUT /beta/profile\` or \`POST /beta/profile\`

Update your agent's name and/or bio. At least one field must be provided.

**Request Body:**
\`\`\`json
{
  "name": "DeFi Index Agent",
  "bio": "Automated DeFi index management with daily rebalancing"
}
\`\`\`

**Parameters:**
- **name** (optional): Agent name (1-30 characters)
- **bio** (optional): Agent bio (max 250 characters)

**Validation:**
- Name: 1-30 characters, alphanumeric + basic punctuation (.,!?&()'-) 
- Bio: Max 250 characters, same character restrictions
- Empty bio string converts to null
- At least one field must be provided

**Response:**
\`\`\`json
{
  "success": true,
  "message": "Profile updated successfully",
  "user": {
    "id": 123,
    "username": "DeFi Index Agent",
    "bio": "Automated DeFi index management with daily rebalancing",
    "updated_at": "2026-02-05T10:30:00.000Z"
  }
}
\`\`\`

## Use Cases

- Set your agent's name when first deployed
- Update your bio to reflect current strategy
- Keep profile information current
- Retrieve profile info for display or logging
`
  };

  const content = docs[uri];
  if (!content) {
    throw new Error(`Resource not found: ${uri}`);
  }

  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text: content
      }
    ]
  };
});

// ========================================
// TOOLS (Executable Actions)
// ========================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_index",
        description: "Create a new cryptocurrency index. The index will be marked as 'agentic' automatically.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Index name (max 40 characters)",
              maxLength: 40
            },
            description: {
              type: "string",
              description: "Index description (optional, max 500 characters)",
              maxLength: 500
            },
            weightsType: {
              type: "string",
              enum: ["market_caps", "custom"],
              description: "Weight calculation type",
              default: "custom"
            },
            selectedAssets: {
              type: "array",
              description: "Array of assets with their contract addresses, networks, and weights (must sum to 100). Tokens are validated via CoinGecko.",
              items: {
                type: "object",
                properties: {
                  contractAddress: {
                    type: "string",
                    description: "Contract address of the token (e.g., '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984')"
                  },
                  network: {
                    type: "string",
                    description: "Network/blockchain (e.g., 'ethereum', 'polygon', 'bsc', 'arbitrum', 'optimism', 'base', 'avalanche', 'solana')"
                  },
                  weight: {
                    type: "number",
                    description: "Weight percentage (0-100, must sum to 100)",
                    minimum: 0,
                    maximum: 100
                  }
                },
                required: ["contractAddress", "network", "weight"]
              },
              minItems: 1,
              maxItems: 50
            },
            methodologyAssetEligibility: {
              type: "string",
              description: "Describe the asset eligibility criteria for this index (e.g., 'Tokens must have >$100M market cap and be listed on major exchanges')",
              maxLength: 2000
            },
            methodologyWeightCaps: {
              type: "string",
              description: "Describe the weight caps methodology (e.g., 'No single asset can exceed 30% of the index')",
              maxLength: 2000
            },
            methodologyRebalancingCadence: {
              type: "string",
              description: "Describe the rebalancing cadence (e.g., 'Rebalanced monthly on the first day of each month')",
              maxLength: 2000
            }
          },
          required: ["name", "selectedAssets", "methodologyAssetEligibility", "methodologyWeightCaps", "methodologyRebalancingCadence"]
        }
      },
      {
        name: "update_index",
        description: "Update an existing index. You can update metadata only, or provide a complete new asset composition. You can only update indices you own.",
        inputSchema: {
          type: "object",
          properties: {
            indexId: {
              type: "number",
              description: "ID of the index to update"
            },
            name: {
              type: "string",
              description: "New name (optional)",
              maxLength: 40
            },
            description: {
              type: "string",
              description: "New description (optional)",
              maxLength: 500
            },
            selectedAssets: {
              type: "array",
              description: "Complete new asset composition (optional). If provided, REPLACES ALL existing assets. If omitted, only metadata is updated. Weights must sum to 100. System checks DB first before calling CoinGecko API.",
              items: {
                type: "object",
                properties: {
                  contractAddress: {
                    type: "string",
                    description: "Contract address of the token (e.g., '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984')"
                  },
                  network: {
                    type: "string",
                    description: "Network/blockchain where the token exists (e.g., 'ethereum', 'polygon', 'bsc', 'arbitrum', 'optimism', 'base', 'avalanche')"
                  },
                  weight: {
                    type: "number",
                    description: "Weight percentage (must sum to 100 across all assets)",
                    minimum: 0,
                    maximum: 100
                  }
                },
                required: ["contractAddress", "network", "weight"]
              },
              minItems: 1,
              maxItems: 50
            },
            methodologyAssetEligibility: {
              type: "string",
              description: "Update asset eligibility criteria (optional)",
              maxLength: 2000
            },
            methodologyWeightCaps: {
              type: "string",
              description: "Update weight caps methodology (optional)",
              maxLength: 2000
            },
            methodologyRebalancingCadence: {
              type: "string",
              description: "Update rebalancing cadence (optional)",
              maxLength: 2000
            }
          },
          required: ["indexId"]
        }
      },
      {
        name: "list_my_indexes",
        description: "List all indices created by this agent",
        inputSchema: {
          type: "object",
          properties: {
            page: {
              type: "number",
              description: "Page number (default: 1)",
              default: 1,
              minimum: 1
            },
            limit: {
              type: "number",
              description: "Results per page (default: 10, max: 50)",
              default: 10,
              minimum: 1,
              maximum: 50
            }
          }
        }
      },
      {
        name: "get_index",
        description: "Get details of a specific index you own, including composition",
        inputSchema: {
          type: "object",
          properties: {
            indexId: {
              type: "number",
              description: "ID of the index to retrieve"
            }
          },
          required: ["indexId"]
        }
      },
      {
        name: "get_public_indexes",
        description: "Get all public indices with optional filtering. This shows indices created by anyone.",
        inputSchema: {
          type: "object",
          properties: {
            featured: {
              type: "boolean",
              description: "Filter by featured status (optional)"
            },
            weights_type: {
              type: "string",
              enum: ["market_caps", "custom"],
              description: "Filter by weights type (optional)"
            },
            creator_id: {
              type: "number",
              description: "Filter by creator ID (optional)"
            },
            limit: {
              type: "number",
              description: "Results per page (default: 20, max: 100)",
              default: 20,
              minimum: 1,
              maximum: 100
            },
            offset: {
              type: "number",
              description: "Pagination offset (default: 0)",
              default: 0,
              minimum: 0
            }
          }
        }
      },
      {
        name: "get_public_index",
        description: "Get details of any public index by ID (not restricted to your own indices)",
        inputSchema: {
          type: "object",
          properties: {
            indexId: {
              type: "number",
              description: "ID of the index to retrieve"
            }
          },
          required: ["indexId"]
        }
      },
      {
        name: "get_kpis_coins",
        description: "Get KPI (Key Performance Indicator) data for coins. Includes metrics like volatility, Bitcoin strength, etc.",
        inputSchema: {
          type: "object",
          properties: {
            kpi_id: {
              type: "number",
              description: "Filter by specific KPI ID (optional)"
            },
            coin_id: {
              type: "number",
              description: "Filter by specific coin ID (optional)"
            },
            time_range: {
              type: "string",
              enum: ["24H", "1W", "1M", "3M", "6M", "1Y", "overall"],
              description: "Time range for the data (optional)"
            },
            limit: {
              type: "number",
              description: "Results per page (default: 100)",
              default: 100,
              minimum: 1,
              maximum: 100
            },
            offset: {
              type: "number",
              description: "Pagination offset (default: 0)",
              default: 0,
              minimum: 0
            },
            latest_only: {
              type: "boolean",
              description: "Only return latest data (default: true)",
              default: true
            },
            group_by_coin: {
              type: "boolean",
              description: "Group results by coin (default: false)",
              default: false
            }
          }
        }
      },
      {
        name: "get_mindshare_coins",
        description: "Get mindshare (market attention/popularity) data for coins",
        inputSchema: {
          type: "object",
          properties: {
            coin_id: {
              type: "number",
              description: "Filter by specific coin ID (optional)"
            },
            time_range: {
              type: "string",
              enum: ["24H", "1W", "1M", "3M", "6M", "1Y", "overall"],
              description: "Time range for the data (optional)"
            },
            limit: {
              type: "number",
              description: "Results per page (default: 100)",
              default: 100,
              minimum: 1,
              maximum: 100
            },
            offset: {
              type: "number",
              description: "Pagination offset (default: 0)",
              default: 0,
              minimum: 0
            },
            latest_only: {
              type: "boolean",
              description: "Only return latest data (default: true)",
              default: true
            }
          }
        }
      },
      {
        name: "get_profile",
        description: "Get your agent's profile information (name, bio, etc.)",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "update_profile",
        description: "Update your agent's profile (name and/or bio). At least one field must be provided.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Agent name (1-30 characters, alphanumeric + basic punctuation)",
              minLength: 1,
              maxLength: 30
            },
            bio: {
              type: "string",
              description: "Agent bio (max 250 characters, alphanumeric + basic punctuation)",
              maxLength: 250
            }
          }
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "create_index": {
        const result = await indexyApiRequest(
          "/beta/indexes/agent",
          "POST",
          args
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "update_index": {
        const { indexId, ...body } = args;
        const result = await indexyApiRequest(
          `/beta/indexes/agent/${indexId}`,
          "PATCH",
          body
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "list_my_indexes": {
        const { page = 1, limit = 10 } = args;
        const result = await indexyApiRequest(
          `/beta/indexes/agent?page=${page}&limit=${limit}`,
          "GET"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_index": {
        const { indexId } = args;
        const result = await indexyApiRequest(
          `/beta/indexes/agent/${indexId}`,
          "GET"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_public_indexes": {
        const { featured, weights_type, creator_id, limit = 20, offset = 0 } = args;
        const params = new URLSearchParams();
        if (featured !== undefined) params.append('featured', featured);
        if (weights_type) params.append('weights_type', weights_type);
        if (creator_id) params.append('creator_id', creator_id);
        params.append('limit', limit);
        params.append('offset', offset);

        const result = await indexyApiRequest(
          `/beta/indexes?${params.toString()}`,
          "GET"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_public_index": {
        const { indexId } = args;
        const result = await indexyApiRequest(
          `/beta/indexes/${indexId}`,
          "GET"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_kpis_coins": {
        const { kpi_id, coin_id, time_range, limit = 100, offset = 0, latest_only = true, group_by_coin = false } = args;
        const params = new URLSearchParams();
        if (kpi_id) params.append('kpi_id', kpi_id);
        if (coin_id) params.append('coin_id', coin_id);
        if (time_range) params.append('time_range', time_range);
        params.append('limit', limit);
        params.append('offset', offset);
        params.append('latest_only', latest_only);
        params.append('group_by_coin', group_by_coin);

        const result = await indexyApiRequest(
          `/beta/kpis/coins?${params.toString()}`,
          "GET"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_mindshare_coins": {
        const { coin_id, time_range, limit = 100, offset = 0, latest_only = true } = args;
        const params = new URLSearchParams();
        if (coin_id) params.append('coin_id', coin_id);
        if (time_range) params.append('time_range', time_range);
        params.append('limit', limit);
        params.append('offset', offset);
        params.append('latest_only', latest_only);

        const result = await indexyApiRequest(
          `/beta/mindshare/coins?${params.toString()}`,
          "GET"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_profile": {
        const result = await indexyApiRequest(
          "/beta/profile",
          "GET"
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "update_profile": {
        const result = await indexyApiRequest(
          "/beta/profile",
          "PUT",
          args
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// ========================================
// SERVER INITIALIZATION
// ========================================

async function main() {
  await loadWeb3Wallet();
  console.error(`[INDEXY-MCP] Auth mode: ${AUTH_MODE}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[INDEXY-MCP] Server started successfully");
}

main().catch((error) => {
  console.error("[INDEXY-MCP] Server error:", error);
  process.exit(1);
});
