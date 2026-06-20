# LiteLLM Local Provider Implementation Plan

## Goal

Add `litellm` as a first-class local LLM provider, following the current Ollama and vLLM pattern: admins configure a server URL in Settings, authenticated users can list models, and runs, watchlist jobs, portfolio insight generation, thesis checks, and portfolio chat can select the provider.

Treat LiteLLM as an OpenAI-compatible local server. The expected default base URL is `http://localhost:4000`, with chat completions at `/v1/chat/completions` and model discovery at `/v1/models`.

Status: initial implementation is on `feature/litellm-local-provider`.

## Current Provider Flow

- `backend/app/routers/api_keys.py` stores both API keys and local server URLs in the encrypted `api_keys` table and validates local providers through `services/llm_provider_registry.py`.
- `backend/app/routers/llm_providers.py` returns static model lists for cloud providers and live model lists for local providers.
- `backend/app/services/trading_agent_runner.py` maps AgentFloor providers to TradingAgents providers and patches environment variables while `TradingAgentsGraph.propagate()` runs.
- `backend/app/services/job_manager.py` serializes batch runs for local providers.
- `backend/app/services/portfolio_insight_runner.py` performs direct provider HTTP calls for portfolio insights, thesis cross-reference, and portfolio chat.
- Frontend provider options are duplicated across `RunForm`, watchlist, portfolio batch analysis, watch buttons, insights, chat, thesis, and settings.

## Backend Plan

1. Introduce a shared provider registry. Done in `backend/app/services/llm_provider_registry.py`.
   - Add one backend module such as `app/services/llm_provider_registry.py`.
   - Define provider metadata: `id`, `label`, `kind` (`cloud` or `local`), `openai_compatible`, default base URL, model endpoint, health endpoint, placeholder model, and whether it should serialize local batch runs.
   - Move `_SUPPORTED_LOCAL`, `_LOCAL_PROVIDERS`, `_PROVIDER_MAP`, and repeated OpenAI-compatible URL handling toward this registry.

2. Add LiteLLM model discovery and URL validation. Done.
   - Add `litellm` to local provider support.
   - Validate with `GET {base_url}/health` if available, falling back to `GET {base_url}/v1/models` because LiteLLM proxy deployments often expose models even when no health route is enabled.
   - List models from `GET {base_url}/v1/models`, returning `data[].id`.
   - Normalize stored URLs with `rstrip("/")`; append `/v1` only when building OpenAI-compatible API URLs.

3. Add LiteLLM to TradingAgents run execution. Done.
   - Map `litellm` to TradingAgents provider `openai`.
   - Patch `OPENAI_BASE_URL` to `{stored_url}/v1` and `OPENAI_API_KEY` to a non-empty placeholder unless a future LiteLLM authentication setting is added.
   - Include `litellm` in the local serialization set used by batch runs.
   - Confirm `apply_reasoning_effort_patch()` treats LiteLLM like Groq, IONOS, and vLLM when the server rejects `reasoning_effort`.

4. Add LiteLLM to portfolio LLM calls. Done.
   - Update `_call_llm()` and `_call_llm_chat()` to route `litellm` through the same OpenAI-compatible local branch as vLLM.
   - Use the stored server URL from the encrypted `api_keys` table, not `settings.litellm_base_url`, for consistency with Settings UI.
   - Keep timeout aligned with local providers (`180s`) unless testing shows LiteLLM proxy latency needs different handling.

5. Fix existing local-provider inconsistencies while adding LiteLLM. Done for Settings-stored local URLs, vLLM key lookup, validation fallback, and provider drift.
   - `portfolio_insight_runner.py` currently reads `settings.vllm_base_url` and `settings.ollama_host`, but those fields do not exist in `app/config.py`; normal runs use the stored Settings URL. Replace these `getattr(settings, ...)` fallbacks with the decrypted local server URL passed through `_get_api_key()`.
   - `portfolio_insight_runner.py` currently maps vLLM key lookup to `openai` in one path; this is wrong for Settings-managed local URLs and should be removed.
   - vLLM validation currently checks `/health` while model listing checks `/v1/models`. Use a fallback strategy so servers without `/health` can still validate if `/v1/models` works.
   - Local-provider code is spread across multiple files; the registry should reduce provider drift when adding LiteLLM or future OpenAI-compatible proxies.

6. Add tests.
   - Extend `tests/test_api_keys.py` for LiteLLM valid and invalid server URL validation.
   - Extend `tests/test_llm_providers.py` for LiteLLM model listing.
   - Add or update service-level tests for OpenAI-compatible local chat URL construction if existing tests can cover it without invoking TradingAgents.

## Frontend Plan

1. Add a shared frontend provider registry. Done in `frontend/lib/llmProviders.ts`.
   - Create a module such as `frontend/lib/llmProviders.ts`.
   - Export provider ids, labels, placeholders, local-provider ids, settings rows, and select options.
   - Replace duplicated arrays in `RunForm`, watchlist, `WatchButton`, portfolio batch analysis, `InsightsDashboard`, `ChatPanel`, and `ThesisPanel`.

2. Add LiteLLM to provider selectors. Done.
   - Add `litellm (local)` everywhere users can choose a provider.
   - Use a placeholder such as `gpt-4o-mini` or `openai/gpt-4o-mini`; LiteLLM model names are deployment-specific, so keep manual entry available when model discovery fails.
   - Treat LiteLLM as local for auto-selecting discovered models and for showing "server unreachable, enter model manually" copy.

3. Add LiteLLM to Settings. Done.
   - Extend `LOCAL_PROVIDERS` with `{ provider: "litellm", label: "LiteLLM" }`.
   - Update `ServerUrlRow` typing and placeholder logic to support `http://localhost:4000`.
   - Consider adding short help text that LiteLLM expects the proxy base URL, not the upstream provider API URL.

4. Improve the UX while touching provider settings.
   - Make local server rows data-driven instead of hard-coding placeholder conditionals.
   - Surface validation failures from `/api-keys` with provider-specific messages where possible.
   - Keep admin-only writes; authenticated reads for configured model lists remain allowed through `/llm-providers/{provider}/models`.

## Documentation And Instructions

- Update `CLAUDE.md` to describe local inference as Settings-managed server URLs for Ollama, vLLM, and LiteLLM, with env vars only as optional fallback/defaults once they are explicitly defined in `app/config.py`.
- Update the README provider list and environment variables to mention LiteLLM proxy support.
- If `LITELLM_BASE_URL`, `OLLAMA_HOST`, or `VLLM_BASE_URL` are intended to be supported environment defaults, add typed fields in `backend/app/config.py`; otherwise remove the docs that imply those settings already exist.

## Suggested Implementation Order

1. Backend registry and LiteLLM validation/model listing.
2. TradingAgents run execution and local batch serialization.
3. Portfolio insight, thesis, and chat local URL consistency fixes.
4. Frontend provider registry and Settings UI update.
5. Tests and documentation updates.
