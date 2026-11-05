import { describe, expect, it } from "vitest";
import { mcpSnippet, mcpUrl } from "./mcp";

describe("mcp helpers", () => {
  it("builds the endpoint from an absolute or nginx-relative API base", () => {
    expect(mcpUrl("http://localhost:8000", "http://localhost:3000")).toBe("http://localhost:8000/mcp");
    expect(mcpUrl("/api", "https://floor.example.com")).toBe("https://floor.example.com/api/mcp");
    expect(mcpUrl("/api/", "https://floor.example.com/")).toBe("https://floor.example.com/api/mcp");
  });

  it("renders client snippets with the token", () => {
    const url = "https://floor.example.com/api/mcp";
    expect(mcpSnippet("claude-code", url, "af_x")).toBe(
      'claude mcp add --transport http agentfloor https://floor.example.com/api/mcp --header "Authorization: Bearer af_x"',
    );
    expect(JSON.parse(mcpSnippet("cursor", url, "af_x"))).toEqual({
      mcpServers: { agentfloor: { url, headers: { Authorization: "Bearer af_x" } } },
    });
    const desktop = JSON.parse(mcpSnippet("claude-desktop", url, "af_x"));
    expect(desktop.mcpServers.agentfloor.args).toEqual(["-y", "mcp-remote", url, "--header", "Authorization:${AGENTFLOOR_AUTH}"]);
    expect(desktop.mcpServers.agentfloor.env).toEqual({ AGENTFLOOR_AUTH: "Bearer af_x" });
  });
});
