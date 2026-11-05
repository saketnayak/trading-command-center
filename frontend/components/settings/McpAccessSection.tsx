"use client";

import { useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Trash2 } from "lucide-react";

import { API_BASE_URL, createMcpToken, listMcpTokens, revokeMcpToken } from "@/lib/api";
import { timeAgo } from "@/lib/alerts";
import {
  MCP_CLIENTS,
  MCP_EXPIRY_OPTIONS,
  mcpSnippet,
  mcpUrl,
  type CreatedMcpToken,
  type McpClient,
} from "@/lib/mcp";
import { SectionCard } from "@/components/settings/SectionCard";
import { IconButton } from "@/components/ui/IconButton";
import {
  ALERT_BANNER_CLASS,
  BTN_PRIMARY_SM_CLASS,
  BTN_SECONDARY_CLASS,
  FIELD_INPUT_SM_CLASS,
  FIELD_LABEL_CLASS,
  selectionPillClass,
} from "@/lib/uiClasses";

const KEY = ["mcp-tokens"] as const;
const noopSubscribe = () => () => {};

export function McpAccessSection() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: KEY, queryFn: listMcpTokens });
  const [name, setName] = useState("Claude Desktop");
  const [research, setResearch] = useState(false);
  const [expiry, setExpiry] = useState<number | null>(90);
  const [created, setCreated] = useState<CreatedMcpToken | null>(null);

  const create = useMutation({
    mutationFn: () => createMcpToken({ name: name.trim(), scopes: research ? ["read", "research"] : ["read"], expires_in_days: expiry }),
    onSuccess: (tok) => {
      setCreated(tok);
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const revoke = useMutation({
    mutationFn: revokeMcpToken,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  // Client-only value (needs window.location); the server snapshot is "" so hydration matches.
  const endpoint = useSyncExternalStore(
    noopSubscribe,
    () => mcpUrl(API_BASE_URL, window.location.origin),
    () => "",
  );

  return (
    <SectionCard
      id="mcp-access"
      title="MCP access"
      description="Connect Claude, Cursor or another MCP client to your AgentFloor data with a personal access token. Read-only by default; no tool can place orders."
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {data && !data.available && (
          <div className={ALERT_BANNER_CLASS}>The MCP package is not installed on this server, so the endpoint is unavailable.</div>
        )}

        <div className="text-xs text-fg-secondary">
          Endpoint: <code className="rounded bg-muted-surface px-1.5 py-0.5 text-fg">{endpoint}</code>
        </div>

        {created ? (
          <NewTokenPanel token={created} endpoint={endpoint} onDone={() => setCreated(null)} />
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <div>
              <label htmlFor="mcp-name" className={FIELD_LABEL_CLASS}>Token name</label>
              <input id="mcp-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={`${FIELD_INPUT_SM_CLASS} !w-52`} />
            </div>
            <div>
              <label htmlFor="mcp-expiry" className={FIELD_LABEL_CLASS}>Expires</label>
              <select id="mcp-expiry" value={expiry ?? "never"} onChange={(e) => setExpiry(e.target.value === "never" ? null : Number(e.target.value))}
                className={`${FIELD_INPUT_SM_CLASS} !w-auto`}>
                {MCP_EXPIRY_OPTIONS.map((o) => (
                  <option key={o.label} value={o.days ?? "never"}>{o.label}</option>
                ))}
              </select>
            </div>
            <label className="inline-flex max-w-xs items-start gap-1.5 pb-1 text-xs text-fg-secondary">
              <input type="checkbox" className="mt-0.5" checked={research} onChange={(e) => setResearch(e.target.checked)} />
              <span>
                Allow research actions
                <span className="block text-[11px] text-muted">Lets the client start AI analyses and portfolio briefs (uses your LLM credits).</span>
              </span>
            </label>
            <button type="submit" disabled={!name.trim() || create.isPending} className={BTN_PRIMARY_SM_CLASS}>
              {create.isPending ? "Creating…" : "Create token"}
            </button>
          </form>
        )}
        {create.isError && <div className={ALERT_BANNER_CLASS} role="alert">{(create.error as Error).message}</div>}

        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Active tokens</h3>
          {isPending ? (
            <p className="text-xs text-muted">Loading…</p>
          ) : !data?.tokens.length ? (
            <p className="text-xs text-muted">No tokens yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {data.tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">
                      {t.name} <code className="ml-1 text-[11px] font-normal text-muted">{t.prefix}…</code>
                    </p>
                    <p className="text-[11px] text-muted">
                      {t.scopes.includes("research") ? "Read + research" : "Read-only"} · used {timeAgo(t.last_used_at)}
                      {t.expires_at ? ` · expires ${t.expires_at.slice(0, 10)}` : " · never expires"}
                      {!t.active ? " · expired" : ""}
                    </p>
                  </div>
                  <IconButton icon={Trash2} label={`Revoke ${t.name}`} tone="danger" disabled={revoke.isPending}
                    onClick={() => { if (window.confirm(`Revoke "${t.name}"? Clients using it stop working immediately.`)) revoke.mutate(t.id); }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function NewTokenPanel({ token, endpoint, onDone }: { token: CreatedMcpToken; endpoint: string; onDone: () => void }) {
  const [client, setClient] = useState<McpClient>("claude-code");
  const info = MCP_CLIENTS.find((c) => c.id === client)!;
  const snippet = mcpSnippet(client, endpoint, token.token);
  return (
    <div className="space-y-3 rounded-md border border-emerald-600/40 bg-emerald-500/5 p-3">
      <p className="text-xs font-medium text-fg">
        Token created. Copy it now: it is shown only once.
      </p>
      <CopyField value={token.token} label="Token" />
      <div className="flex flex-wrap gap-1">
        {MCP_CLIENTS.map((c) => (
          <button key={c.id} type="button" aria-pressed={client === c.id} onClick={() => setClient(c.id)}
            className={`${selectionPillClass(client === c.id, true)} !normal-case`}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted">{info.note}</p>
      <CopyField value={snippet} label={`${info.label} configuration`} multiline />
      <button type="button" className={BTN_SECONDARY_CLASS} onClick={onDone}>Done</button>
    </div>
  );
}

function CopyField({ value, label, multiline = false }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-1.5">
      <pre aria-label={label}
        className={`min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 text-[11px] text-fg ${multiline ? "whitespace-pre" : "whitespace-nowrap"}`}>
        {value}
      </pre>
      <IconButton icon={copied ? Check : Copy} label={copied ? "Copied" : `Copy ${label}`} className="mt-1 shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked: the text is selectable */
          }
        }} />
    </div>
  );
}
