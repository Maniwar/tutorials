# Facebook Marketplace AI Agent

This directory contains the Python scaffold for an AI Agent that leverages the [Facebook Marketplace MCP](https://github.com/jdcodes1/facebook-marketplace-mcp) and Anthropic's Claude to find lucrative flipping and arbitrage opportunities.

## Prerequisites

1.  **Google Chrome:** You must have Google Chrome installed and be actively logged into Facebook. The MCP server extracts your session cookies directly from Chrome.
2.  **Node.js 20+:** Required to run the underlying MCP server.
3.  **Python 3.10+:** Required for this agent script.
4.  **Anthropic API Key:** You need an API key to run the Claude evaluation logic.

## Setup Instructions

### 1. Install and Build the MCP Server
First, you need to clone and build the Node.js MCP server that handles the raw GraphQL communication with Facebook.

```bash
# Clone the MCP server repository (preferably outside this agent directory)
git clone https://github.com/jdcodes1/facebook-marketplace-mcp.git
cd facebook-marketplace-mcp

# Install dependencies and build
npm install
npm run build
```

### 2. Set Up the Python Environment
Navigate back to this `marketplace_agent` directory.

```bash
# Optional but recommended: Create a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure the Environment
Create a `.env` file in this directory (`marketplace_agent/.env`) and add the following variables:

```env
# Your Anthropic API Key for Claude
ANTHROPIC_API_KEY="sk-ant-api03-..."

# The absolute path to the compiled index.js file of the MCP server you built in Step 1
MCP_SERVER_PATH="/absolute/path/to/facebook-marketplace-mcp/dist/index.js"

# Optional: Set the minimum profit margin percentage required to trigger an alert (default is 30.0)
TARGET_MARGIN="40.0"
```

## Running the Agent

Once everything is configured, run the agent:

```bash
python agent.py
```

### How it works:
1. The script initializes the Anthropic client.
2. It uses the `mcp` Python SDK to start and connect to the local Node.js Facebook Marketplace MCP server via `stdio`.
3. It sends a `search_listings` request to the MCP server (e.g., searching for broken MacBooks).
4. For each listing returned, it passes the data to Claude (via `anthropic`), asking it to evaluate the true market value and profitability using a custom tool.
5. If the calculated profit margin exceeds the `TARGET_MARGIN`, it triggers an alert.

## Customizing the Agent
*   **Change the Search:** Modify the `search_query`, `latitude`, and `longitude` in the `agent.py` main loop to target your specific niche and local area.
*   **Alerting System:** Update the `send_alert()` function to actually POST to a Discord Webhook, Telegram Bot API, or SMS service rather than just printing to the console.
*   **Advanced Evaluation:** In a production environment, you should provide Claude with an additional tool to dynamically search the web or eBay APIs to determine accurate, real-time "Sold" prices, rather than relying solely on its internal knowledge base.