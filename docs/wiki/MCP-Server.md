# MCP server: use AgentFloor from Claude, Cursor and other AI assistants

AgentFloor is an [MCP](https://modelcontextprotocol.io) server, so an AI assistant can answer questions about **your own** data: "How did my AI-flagged sells do last quarter?", "What's my biggest risk right now?", "Did any of my holdings file an 8-K this week?".

## Connect

1. **Settings → MCP access → Create token.** Give it a name and an expiry, and tick **Allow research actions** only if you want the assistant to be able to start analyses (which spend your LLM credits).
2. The token is shown **once**. Copy the snippet for your client:

**Claude Code**

```bash
claude mcp add --transport http agentfloor https://YOUR-HOST/api/mcp --header "Authorization: Bearer af_YOUR_TOKEN"
```

**Cursor** (`.cursor/mcp.json`) and other clients that support remote HTTP servers:

```json
{ "mcpServers": { "agentfloor": { "url": "https://YOUR-HOST/api/mcp", "headers": { "Authorization": "Bearer af_YOUR_TOKEN" } } } }
```

**Claude Desktop** (`claude_desktop_config.json`, needs Node.js; uses `mcp-remote` as a bridge):

```json
{
  "mcpServers": {
    "agentfloor": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://YOUR-HOST/api/mcp", "--header", "Authorization:${AGENTFLOOR_AUTH}"],
      "env": { "AGENTFLOOR_AUTH": "Bearer af_YOUR_TOKEN" }
    }
  }
}
```

The Settings page fills in your host and token for you.

## Tools

**Read** (every token):
- `list_portfolios`, `get_holdings`
- `get_performance`, `get_risk`, `get_rebalance_plan`
- `get_income`, `get_tax_report`, `get_net_worth`
- `get_filings`
- `get_xray`
- `get_regime`
- `list_runs`, `get_run_report`, `get_latest_insight`
- `list_alerts`

**Research** (only with the research scope):
- `start_analysis`: starts an analysis labelled "via MCP" with your default model.
- `generate_portfolio_insight`.

There is **no tool that places orders**, and JEV Lab is not exposed. Every call only sees the token owner's data.

## Managing tokens

Only a SHA-256 hash of each token is stored. Settings lists your tokens with when each was last used; **Revoke** stops one immediately. Expired and revoked tokens are refused.
