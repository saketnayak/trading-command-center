export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

export interface Run {
  id: string;
  ticker: string;
  analysis_date: string;
  llm_provider: string;
  llm_model: string;
  depth: "quick" | "standard" | "deep";
  analysts: string[];
  label: string | null;
  status: "pending" | "running" | "completed" | "aborted" | "failed";
  verdict: "buy" | "sell" | "hold" | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface AgentEventPayload {
  type: "started" | "token" | "completed" | "error" | "run_completed" | "run_aborted";
  agent?: string;
  token?: string;
  summary?: string;
  message?: string;
  sequence?: number;
  run_id?: string;
}

export interface Report {
  id: string;
  run_id: string;
  trader_decision: string;
  verdict: "buy" | "sell" | "hold";
  suggested_entry: string | null;
  suggested_stop: string | null;
  suggested_target: string | null;
  risk_assessment: string;
  raw_report: Record<string, unknown>;
}

export interface ApiKeyStatus {
  provider: string;
  is_valid: boolean;
  validated_at: string | null;
  masked_key: string;
}

export interface CreateRunRequest {
  ticker: string;
  analysis_date: string;
  llm_provider: string;
  llm_model: string;
  depth: string;
  analysts: string[];
  label?: string;
}
