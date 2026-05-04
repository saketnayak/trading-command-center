import { getSession } from "next-auth/react";
import type { Run, AgentEventPayload, CreateRunRequest, ApiKeyStatus, User } from "./types";

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

export async function getRuns(params?: { ticker?: string; verdict?: string }): Promise<Run[]> {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
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
  if (!r.ok) throw new Error("Failed to save API key");
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
