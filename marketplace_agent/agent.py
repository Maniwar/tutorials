import os
import asyncio
import json
from dotenv import load_dotenv

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from anthropic import AsyncAnthropic

load_dotenv()

# Configuration
# Path to your compiled node Facebook Marketplace MCP server
MCP_SERVER_PATH = os.getenv("MCP_SERVER_PATH", "/path/to/facebook-marketplace-mcp/dist/index.js")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
TARGET_MARGIN = float(os.getenv("TARGET_MARGIN", "30.0")) # Percentage

# Define the tools we want the LLM to use
TOOLS = [
    {
        "name": "evaluate_profitability",
        "description": "Evaluate if an item is profitable to flip based on its market value.",
        "input_schema": {
            "type": "object",
            "properties": {
                "listing_id": {"type": "string"},
                "item_name": {"type": "string"},
                "asking_price": {"type": "number"},
                "estimated_market_value": {"type": "number"},
                "confidence_score": {"type": "number", "description": "1-100 score of how sure you are about the market value."},
                "reasoning": {"type": "string", "description": "Why you think this is a good or bad deal."}
            },
            "required": ["listing_id", "item_name", "asking_price", "estimated_market_value", "reasoning"]
        }
    }
]

async def send_alert(message: str):
    """
    Mock function to send an alert (e.g., via Discord/Telegram).
    In a real app, you would use requests.post() to a webhook.
    """
    print(f"\n[ALERT] 🚨 LUCRATIVE DEAL FOUND 🚨\n{message}\n")

async def analyze_listing(client: AsyncAnthropic, listing: dict) -> dict:
    """
    Uses Claude to analyze a listing and determine its true market value.
    In a fully fleshed out agent, Claude would use another tool to search eBay/Amazon.
    Here we prompt it to use its internal knowledge as a mock.
    """
    prompt = f"""
    You are an expert flipper and arbitrageur. Analyze the following Facebook Marketplace listing.
    Estimate its true market value (e.g., what it would sell for on eBay).

    Listing Details:
    {json.dumps(listing, indent=2)}

    Use the `evaluate_profitability` tool to submit your analysis.
    """

    print(f"Analyzing listing: {listing.get('title', 'Unknown')}")

    response = await client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        tools=TOOLS,
        messages=[{"role": "user", "content": prompt}]
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "evaluate_profitability":
            return block.input

    return {}

async def run_agent():
    if not ANTHROPIC_API_KEY:
        print("Error: ANTHROPIC_API_KEY not found in environment.")
        return

    anthropic = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    # Configure the MCP Client to talk to the local Node.js server
    server_params = StdioServerParameters(
        command="node",
        args=[MCP_SERVER_PATH],
        env={"CHROME_PROFILE": "Default", **os.environ}
    )

    print(f"Connecting to MCP Server at: {MCP_SERVER_PATH}...")

    try:
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                print("Connected to Facebook Marketplace MCP Server!")

                # --- The Main Loop ---
                # Example: Search for MacBooks
                search_query = "MacBook Pro M1 broken"
                print(f"\nExecuting search: '{search_query}'...")

                try:
                    # Call the MCP server's search_listings tool
                    search_result = await session.call_tool(
                        "search_listings",
                        arguments={
                            "query": search_query,
                            "latitude": 40.7128, # New York Example
                            "longitude": -74.0060,
                            "radius_km": 50,
                            "limit": 5
                        }
                    )

                    # Parse the MCP response
                    if hasattr(search_result, 'content') and len(search_result.content) > 0:
                        # Assuming the tool returns JSON string in the text block
                        listings_data = json.loads(search_result.content[0].text)

                        # In reality, this might be nested under 'listings'
                        listings = listings_data if isinstance(listings_data, list) else listings_data.get('listings', [])

                        for listing in listings:
                            # 1. Analyze the listing with Claude
                            analysis = await analyze_listing(anthropic, listing)

                            if analysis:
                                asking = analysis.get("asking_price", 0)
                                market = analysis.get("estimated_market_value", 0)

                                # 2. Calculate Profit Margin
                                if asking > 0 and market > asking:
                                    profit = market - asking
                                    margin = (profit / asking) * 100

                                    print(f"  -> Analyzed {analysis['item_name']}: Asking ${asking}, Est. Market ${market}. Margin: {margin:.1f}%")

                                    # 3. Trigger Alert if lucrative
                                    if margin >= TARGET_MARGIN:
                                        msg = (
                                            f"Item: {analysis['item_name']}\n"
                                            f"Asking: ${asking} | Market Value: ${market}\n"
                                            f"Potential Profit: ${profit} ({margin:.1f}%)\n"
                                            f"Reasoning: {analysis.get('reasoning')}\n"
                                            f"Link: https://www.facebook.com/marketplace/item/{analysis['listing_id']}"
                                        )
                                        await send_alert(msg)
                    else:
                         print("No results found or unexpected response format from MCP.")

                except Exception as e:
                     print(f"Error calling MCP tool: {e}")
                     print("Note: Ensure the MCP server path is correct and the server is installed.")

    except FileNotFoundError:
        print(f"Error: Could not find the MCP server at {MCP_SERVER_PATH}.")
        print("Please ensure the repository is cloned, built, and the path in .env is correct.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    asyncio.run(run_agent())
