/** MCP access (Settings → MCP access): token types and client config snippets. */

export type McpScope = "read" | "research";

export interface McpToken {
  id: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  created_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  active: boolean;
}

export interface CreatedMcpToken extends McpToken {
  token: string; // shown once
}

/** The MCP endpoint as a client should see it: the API base (absolute, or relative behind nginx) + /mcp. */
export function mcpUrl(apiBase: string, origin: string): string {
  const base = apiBase.replace(/\/+$/, "");
  return new URL(`${base}/mcp`, origin.endsWith("/") ? origin : `${origin}/`).toString();
}

export type McpClient = "claude-code" | "cursor" | "claude-desktop";

export const MCP_CLIENTS: { id: McpClient; label: string; note: string }[] = [
  { id: "claude-code", label: "Claude Code", note: "Run once in a terminal." },
  { id: "cursor", label: "Cursor / HTTP clients", note: "Add to .cursor/mcp.json (or any client that supports remote HTTP servers with headers)." },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    note: "Add to claude_desktop_config.json. Desktop config runs local commands, so this bridges with mcp-remote (needs Node.js).",
  },
];

export function mcpSnippet(client: McpClient, url: string, token: string): string {
  switch (client) {
    case "claude-code":
      return `claude mcp add --transport http agentfloor ${url} --header "Authorization: Bearer ${token}"`;
    case "cursor":
      return JSON.stringify({ mcpServers: { agentfloor: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
    case "claude-desktop":
      return JSON.stringify(
        {
          mcpServers: {
            agentfloor: {
              command: "npx",
              args: ["-y", "mcp-remote", url, "--header", "Authorization:${AGENTFLOOR_AUTH}"],
              env: { AGENTFLOOR_AUTH: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      );
  }
}

export const MCP_EXPIRY_OPTIONS: { days: number | null; label: string }[] = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: null, label: "Never" },
];
