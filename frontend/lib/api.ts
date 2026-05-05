import { getSession } from "next-auth/react";
import type { Run, AgentEventPayload, CreateRunRequest, ApiKeyStatus, User, Report, RunStats } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function fetchWithAuth(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await getSession();
  const token = (session as { accessToken?: string })?.accessToken;
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

export async function getRuns(params?: { ticker?: string; verdict?: string; archived?: boolean; limit?: number; offset?: number }): Promise<Run[]> {
  const p: Record<string, string> = {};
  if (params?.ticker) p.ticker = params.ticker;
  if (params?.verdict) p.verdict = params.verdict;
  if (params?.archived) p.archived = "true";
  if (params?.limit != null) p.limit = String(params.limit);
  if (params?.offset != null) p.offset = String(params.offset);
  const qs = new URLSearchParams(p).toString();
  const r = await fetchWithAuth(`/runs${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error("Failed to fetch runs");
  return r.json();
}

export async function getRun(id: string): Promise<Run> {
  const r = await fetchWithAuth(`/runs/${id}`);
  if (!r.ok) throw new Error("Run not found");
  return r.json();
}

export async function createRun(req: CreateRunRequest): Promise<Run> {
  const r = await fetchWithAuth("/runs", { method: "POST", body: JSON.stringify(req) });
  if (!r.ok) throw new Error("Failed to create run");
  return r.json();
}

export async function abortRun(id: string): Promise<void> {
  await fetchWithAuth(`/runs/${id}`, { method: "DELETE" });
}

export async function archiveRun(id: string): Promise<Run> {
  const r = await fetchWithAuth(`/runs/${id}/archive`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to archive run");
  return r.json();
}

export async function deleteRun(id: string): Promise<void> {
  const r = await fetchWithAuth(`/runs/${id}/delete`, { method: "DELETE" });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to delete run");
  }
}

export async function getReport(runId: string): Promise<Report> {
  const r = await fetchWithAuth(`/runs/${runId}/report`);
  if (!r.ok) throw new Error("Report not found");
  return r.json();
}

export async function getRunEvents(id: string): Promise<AgentEventPayload[]> {
  const r = await fetchWithAuth(`/runs/${id}/events`);
  if (!r.ok) throw new Error("Failed to fetch events");
  return r.json();
}

export async function getApiKeys(): Promise<ApiKeyStatus[]> {
  const r = await fetchWithAuth("/api-keys");
  if (!r.ok) throw new Error("Failed to fetch API keys");
  return r.json();
}

export async function upsertApiKey(provider: string, key: string): Promise<ApiKeyStatus> {
  const r = await fetchWithAuth("/api-keys", { method: "POST", body: JSON.stringify({ provider, key }) });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const detail = body?.detail ?? `HTTP ${r.status}`;
    if (r.status === 401) throw new Error(`Session expired — please sign out and back in (${detail})`);
    if (r.status === 403) throw new Error(`Admin access required`);
    throw new Error(`Failed to save: ${detail}`);
  }
  return r.json();
}

export async function deleteApiKey(provider: string): Promise<void> {
  await fetchWithAuth(`/api-keys/${provider}`, { method: "DELETE" });
}

export async function getUsers(): Promise<User[]> {
  const r = await fetchWithAuth("/users");
  if (!r.ok) throw new Error("Failed to fetch users");
  return r.json();
}

export async function inviteUser(email: string): Promise<void> {
  await fetchWithAuth("/auth/invite", { method: "POST", body: JSON.stringify({ email }) });
}

export async function updateUserRole(id: string, role: string): Promise<User> {
  const r = await fetchWithAuth(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
  if (!r.ok) throw new Error("Failed to update user");
  return r.json();
}

export async function deleteUser(id: string): Promise<void> {
  await fetchWithAuth(`/users/${id}`, { method: "DELETE" });
}

export async function getProviderModels(provider: string): Promise<string[]> {
  const r = await fetchWithAuth(`/llm-providers/${provider}/models`);
  if (!r.ok) throw new Error(`Could not fetch models for ${provider}`);
  return r.json();
}

export async function getRunStats(): Promise<RunStats> {
  const r = await fetchWithAuth("/runs/stats");
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json();
}

export async function updateProfile(data: { name?: string; current_password?: string; new_password?: string }): Promise<void> {
  const r = await fetchWithAuth("/auth/me", { method: "PATCH", body: JSON.stringify(data) });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? "Failed to update profile");
  }
}
