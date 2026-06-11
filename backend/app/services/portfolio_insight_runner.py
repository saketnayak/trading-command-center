"""Generates AI-powered portfolio insights using a single LLM synthesis call."""
import asyncio
import json
import logging
import time
from datetime import date
from typing import Optional
from uuid import UUID

import httpx
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.portfolio_insight import PortfolioInsight, InsightStatus, InsightStance
from app.models.run import Run, RunStatus
from app.models.api_key import ApiKey
from app.services.encryption import decrypt_key
from app.utils.asset_type import is_crypto
import app.services.crypto_data_service as _crypto

logger = logging.getLogger(__name__)

# Sector cache: ticker → (sector_name, expiry_unix_ts). 24-hour TTL.
_sector_cache: dict[str, tuple[str, float]] = {}
_SECTOR_TTL = 86400


async def _get_api_key(provider: str, db: AsyncSession) -> Optional[str]:
    row = (await db.execute(select(ApiKey).where(ApiKey.provider == provider))).scalar_one_or_none()
    if not row or (provider != "finnhub" and not row.is_valid):
        return None
    return decrypt_key(row.encrypted_key)


async def _fetch_sector(ticker: str, finnhub_key: Optional[str]) -> str:
    now = time.time()
    if ticker in _sector_cache:
        sector, expiry = _sector_cache[ticker]
        if now < expiry:
            return sector

    if is_crypto(ticker):
        sector = await _crypto.fetch_category(ticker)
    elif finnhub_key:
        try:
            url = f"https://finnhub.io/api/v1/stock/profile2?symbol={ticker}&token={finnhub_key}"
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(url)
                r.raise_for_status()
                data = r.json()
            sector = data.get("finnhubIndustry") or data.get("gics_sector") or "Unknown"
        except Exception:
            sector = "Unknown"
    else:
        sector = "Unknown"

    _sector_cache[ticker] = (sector, now + _SECTOR_TTL)
    return sector


def _serialize_investor_profile(profile) -> str:
    """Convert investor profile to human-readable prompt block. Returns '' if nothing to serialize."""
    RISK_LABELS = {1: "very conservative", 2: "conservative", 3: "moderate", 4: "aggressive", 5: "very aggressive"}
    HORIZON_LABELS = {"lt_1y": "< 1 year", "1_3y": "1–3 years", "3_7y": "3–7 years", "7_15y": "7–15 years", "gt_15y": "15+ years"}
    STYLE_LABELS = {"passive": "passive (index/ETF-first)", "active": "active stock picking", "hybrid": "hybrid"}
    SIZING_LABELS = {"equal_weight": "equal weight", "conviction": "conviction-based", "market_cap": "market-cap weighted"}
    INCOME_LABELS = {"growth_only": "growth only (no income needed)", "some_income": "some income (5–20% yield)", "income_first": "income-first (>20% yield)"}
    ABILITY_LABELS = {"low": "low — cannot afford significant losses", "medium": "medium — can absorb moderate drawdowns", "high": "high — can tolerate large swings"}
    SIZE_LABELS = {"lt_50k": "< $50k", "50k_250k": "$50k–$250k", "250k_1m": "$250k–$1M", "1m_5m": "$1M–$5M", "gt_5m": "> $5M"}

    lines = []
    if profile.time_horizon:
        lines.append(f"- Time horizon: {HORIZON_LABELS.get(profile.time_horizon, profile.time_horizon)}")
    if profile.risk_willingness:
        label = RISK_LABELS.get(profile.risk_willingness, str(profile.risk_willingness))
        lines.append(f"- Risk willingness: {profile.risk_willingness}/5 ({label})")
    if profile.risk_ability:
        lines.append(f"- Risk ability: {ABILITY_LABELS.get(profile.risk_ability, profile.risk_ability)}")
    if profile.investment_style:
        lines.append(f"- Investment style: {STYLE_LABELS.get(profile.investment_style, profile.investment_style)}")
    if profile.sizing_approach:
        lines.append(f"- Position sizing: {SIZING_LABELS.get(profile.sizing_approach, profile.sizing_approach)}")
    if profile.preferred_sectors:
        lines.append(f"- Preferred sectors: {', '.join(profile.preferred_sectors)}")
    if profile.anti_portfolio:
        lines.append(f"- Anti-portfolio (NEVER recommend adding): {', '.join(profile.anti_portfolio)}")
    if profile.blind_spots:
        lines.append(f"- Known blind spots: {profile.blind_spots}")
    if profile.emotional_tendencies:
        lines.append(f"- Emotional tendencies: {profile.emotional_tendencies}")
    if profile.personal_rules:
        lines.append(f"- Personal rules: {profile.personal_rules}")
    if profile.target_portfolio_size:
        lines.append(f"- Target portfolio size: {SIZE_LABELS.get(profile.target_portfolio_size, profile.target_portfolio_size)}")
    if profile.income_goal:
        lines.append(f"- Income goal: {INCOME_LABELS.get(profile.income_goal, profile.income_goal)}")
    if profile.milestones:
        lines.append(f"- Milestones: {profile.milestones}")

    if not lines:
        return ""
    return "INVESTOR PROFILE (personalize all analysis to this user):\n" + "\n".join(lines)


async def _call_llm(provider: str, model: str, api_key: Optional[str], prompt: str) -> str:
    """Single LLM call returning raw text. Uses direct provider APIs."""
    _json_payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
        "max_tokens": 4096,
    }

    if provider == "openai":
        if not api_key:
            raise ValueError("OpenAI API key is not configured. Add it in Settings → API Keys.")
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=_json_payload, headers=headers,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    if provider == "groq":
        if not api_key:
            raise ValueError("Groq API key is not configured. Add it in Settings → API Keys.")
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                json=_json_payload, headers=headers,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    if provider == "ionos":
        if not api_key:
            raise ValueError("IONOS API key is not configured. Add it in Settings → API Keys.")
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                "https://openai.inference.de-txl.ionos.com/v1/chat/completions",
                json=_json_payload, headers=headers,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    if provider == "vllm":
        # vLLM exposes an OpenAI-compatible endpoint at a local base URL.
        from app.config import settings as _s
        base_url = getattr(_s, "vllm_base_url", "http://localhost:8080")
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{base_url}/v1/chat/completions",
                json=_json_payload, headers=headers,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    if provider == "anthropic":
        if not api_key:
            raise ValueError("Anthropic API key is not configured. Add it in Settings → API Keys.")
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            return r.json()["content"][0]["text"]

    if provider == "ollama":
        from app.config import settings as _s
        base_url = getattr(_s, "ollama_host", "http://localhost:11434")
        url = f"{base_url}/v1/chat/completions"
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "format": "json",
        }
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    if provider == "google":
        if not api_key:
            raise ValueError("Google API key is not configured. Add it in Settings → API Keys.")
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={api_key}"
        )
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3},
        }
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]

    raise ValueError(f"Unsupported LLM provider: {provider}")


async def _call_llm_chat(
    provider: str,
    model: str,
    api_key: Optional[str],
    system: str,
    messages: list[dict],
) -> str:
    """Multi-turn chat LLM call with a separate system prompt and message list."""
    if provider in ("openai", "groq", "vllm", "ollama"):
        structured = [{"role": "system", "content": system}] + messages
        payload: dict = {"model": model, "messages": structured, "temperature": 0.7, "max_tokens": 1024}
        if provider == "openai":
            if not api_key:
                raise ValueError("OpenAI API key is not configured. Add it in Settings → API Keys.")
            url = "https://api.openai.com/v1/chat/completions"
            headers: dict[str, str] = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            timeout = 90
        elif provider == "groq":
            if not api_key:
                raise ValueError("Groq API key is not configured. Add it in Settings → API Keys.")
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            timeout = 90
        elif provider == "vllm":
            from app.config import settings as _s
            base_url = getattr(_s, "vllm_base_url", "http://localhost:8080")
            url = f"{base_url}/v1/chat/completions"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            timeout = 180
        else:  # ollama
            from app.config import settings as _s
            base_url = getattr(_s, "ollama_host", "http://localhost:11434")
            url = f"{base_url}/v1/chat/completions"
            headers = {"Content-Type": "application/json"}
            timeout = 180
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    if provider == "anthropic":
        if not api_key:
            raise ValueError("Anthropic API key is not configured. Add it in Settings → API Keys.")
        payload = {"model": model, "system": system, "messages": messages, "max_tokens": 1024, "temperature": 0.7}
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
            r.raise_for_status()
            return r.json()["content"][0]["text"]

    if provider == "google":
        if not api_key:
            raise ValueError("Google API key is not configured. Add it in Settings → API Keys.")
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={api_key}"
        )
        contents = [
            {"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]}
            for m in messages
        ]
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024},
        }
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]

    raise ValueError(f"Unsupported LLM provider: {provider}")


def _build_prompt(
    portfolio_name: str,
    analysis_date: str,
    total_value: Optional[float],
    total_pnl: Optional[float],
    total_pnl_pct: Optional[float],
    holdings: list[dict],
    investor_profile=None,
    regime_map: Optional[dict] = None,
) -> str:
    rows = []
    for h in holdings:
        pnl_str = f"{h['unrealized_pnl_pct']:+.1f}%" if h["unrealized_pnl_pct"] is not None else "N/A"
        price_str = f"${h['current_price']:.2f}" if h["current_price"] else "N/A"
        value_str = f"${h['market_value']:.2f}" if h["market_value"] else "N/A"
        weight_str = f"{h['weight_pct']:.1f}%" if h["weight_pct"] is not None else "N/A"
        verdict = h.get("last_verdict") or "none"
        days = h.get("days_since_analysis")
        analysis_str = f"{verdict} ({days}d ago)" if days is not None else "no analysis"
        rows.append(
            f"  - {h['ticker']} | sector: {h['sector']} | shares: {h['shares']} | "
            f"avg_cost: ${h['avg_cost'] or 'N/A'} | price: {price_str} | "
            f"value: {value_str} | weight: {weight_str} | P&L: {pnl_str} | analysis: {analysis_str}"
        )

    holdings_text = "\n".join(rows) if rows else "  (no holdings)"
    value_str = f"${total_value:,.2f}" if total_value else "N/A (prices unavailable)"
    pnl_str = (
        f"${total_pnl:+,.2f} ({total_pnl_pct:+.1f}%)"
        if total_pnl is not None and total_pnl_pct is not None
        else "N/A"
    )

    has_crypto = any(is_crypto(h["ticker"]) for h in holdings)
    has_stocks = any(not is_crypto(h["ticker"]) for h in holdings)
    if has_crypto and has_stocks:
        portfolio_type_note = "This is a MIXED portfolio containing both equities and crypto assets."
    elif has_crypto:
        portfolio_type_note = "This is a CRYPTO-ONLY portfolio. There are no earnings events, P/E ratios, or dividends. 'Sector' refers to crypto category (e.g. Layer 1, DeFi, NFT, Staking)."
    else:
        portfolio_type_note = "This is an EQUITY portfolio."

    # Compute staleness threshold based on investor time horizon
    staleness_days = 7
    if investor_profile and investor_profile.time_horizon:
        staleness_days = {"lt_1y": 7, "1_3y": 10, "3_7y": 14, "7_15y": 21, "gt_15y": 30}.get(
            investor_profile.time_horizon, 7
        )

    # Build optional investor profile block
    profile_block = ""
    if investor_profile:
        serialized = _serialize_investor_profile(investor_profile)
        if serialized:
            profile_block = f"\n{serialized}\n"

    # Build optional regime context block
    regime_block = ""
    if regime_map:
        regime_lines = []
        bull_count = sideways_count = bear_count = 0
        signals = []
        for h in holdings:
            r = regime_map.get(h["ticker"])
            if r:
                regime = r.get("current_regime", "Unknown")
                signal = r.get("signal", 0.0)
                persistence = r.get("persistence", 0.0)
                stat = r.get("stationary", {})
                wf = r.get("walk_forward", {})
                sharpe = wf.get("sharpe")
                sharpe_str = f"WF Sharpe {sharpe:.2f}" if sharpe is not None else "WF Sharpe N/A"
                regime_lines.append(
                    f"  {h['ticker']}: {regime}  signal {signal:+.2f}  "
                    f"persistence {persistence:.0%}  "
                    f"long-run Bull {stat.get('bull', 0):.0%}  {sharpe_str}"
                )
                if regime == "Bull":
                    bull_count += 1
                elif regime == "Bear":
                    bear_count += 1
                else:
                    sideways_count += 1
                signals.append(signal)

        if regime_lines:
            avg_signal = sum(signals) / len(signals) if signals else 0.0
            direction = "bullish" if avg_signal > 0.1 else "bearish" if avg_signal < -0.1 else "neutral"
            regime_block = (
                f"\nREGIME CONTEXT (Markov chain analysis, yfinance 10y daily):\n"
                + "\n".join(regime_lines)
                + f"\n\nPortfolio regime distribution: {bull_count} Bull · {sideways_count} Sideways · {bear_count} Bear"
                + f"\nPortfolio avg signal: {avg_signal:+.2f} ({direction})"
                + "\nNote: Markov regime reflects statistical price history only. Weight alongside fundamental analysis.\n"
            )

    return f"""You are a professional portfolio analyst AI. Analyze the following investment portfolio and provide structured daily insights.

Date: {analysis_date}
Portfolio: {portfolio_name}
Portfolio type: {portfolio_type_note}
Total market value: {value_str}
Total unrealized P&L: {pnl_str}
Number of holdings: {len(holdings)}
{profile_block}
Holdings:
{holdings_text}
{regime_block}
Your analysis should:
1. Identify concentration risk (positions >20% of portfolio)
2. Flag significant unrealized losses (>15% drawdown)
3. Note stale or missing analysis (>{staleness_days} days old)
4. Evaluate diversification across sectors (equities) or crypto categories (crypto assets)
5. Identify positions with recent buy/sell signals
6. Consider overall market positioning; for crypto note 24/7 trading and higher volatility
7. Respect the investor's anti-portfolio rules — never recommend buying excluded sectors/assets
8. Frame urgency and risk relative to the investor's stated time horizon and risk tolerance
9. Where regime data is provided, note regime-conflicted positions (e.g. AI said Buy but regime is Bear) and regime-supported positions

Respond ONLY with a single valid JSON object matching this exact schema (no markdown, no explanation):
{{
  "health_score": <integer 1-10, where 10 is excellent>,
  "overall_stance": <one of: "bullish", "bearish", "neutral", "mixed">,
  "summary": <2-3 sentence plain-English portfolio overview>,
  "action_items": [
    {{
      "ticker": <string>,
      "action": <one of: "BUY_MORE", "TRIM", "EXIT", "WATCH", "REANALYZE">,
      "priority": <one of: "high", "medium", "low">,
      "rationale": <1-2 sentence explanation>
    }}
  ],
  "risk_alerts": [
    {{
      "type": <one of: "concentration", "drawdown", "stale_analysis", "no_analysis", "sector_overweight", "correlated_positions">,
      "severity": <one of: "critical", "warning", "info">,
      "description": <string>,
      "affected_tickers": [<ticker strings>]
    }}
  ],
  "sector_analysis": {{<sector_name>: <weight_percentage_float>}},
  "strengths": [<strength strings, max 4>],
  "weaknesses": [<weakness strings, max 4>]
}}

Rules:
- Sort action_items by priority (high first), only include tickers needing attention
- health_score: 8-10 = healthy portfolio, 5-7 = moderate concerns, 1-4 = significant issues
- If prices are unavailable, base analysis on cost basis and analysis verdicts only
- sector_analysis percentages must sum to ~100"""


def _parse_insight_json(raw: str) -> dict:
    """Extract and parse JSON from LLM response, handling common formatting issues."""
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    # Find first { and last } to handle any preamble
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError("No JSON object found in LLM response")
    return json.loads(text[start:end])


async def generate_portfolio_insight(insight_id: str) -> None:
    """Background task: runs the full insight generation pipeline."""
    async with AsyncSessionLocal() as db:
        insight = await db.get(PortfolioInsight, UUID(insight_id))
        if not insight:
            logger.error("Insight %s not found", insight_id)
            return

        insight.status = InsightStatus.running
        await db.commit()

        _completed = False
        try:
            portfolio = await db.get(Portfolio, insight.portfolio_id)
            if not portfolio:
                raise ValueError("Portfolio not found")

            from app.models.investor_profile import InvestorProfile as InvestorProfileModel
            _profile_result = await db.execute(
                select(InvestorProfileModel).where(InvestorProfileModel.user_id == portfolio.user_id)
            )
            investor_profile = _profile_result.scalar_one_or_none()

            # Fetch latest snapshot + holdings
            snap_result = await db.execute(
                select(PortfolioSnapshot)
                .where(PortfolioSnapshot.portfolio_id == insight.portfolio_id)
                .options(selectinload(PortfolioSnapshot.holdings))
                .order_by(desc(PortfolioSnapshot.uploaded_at))
                .limit(1)
            )
            snapshot = snap_result.scalar_one_or_none()
            if not snapshot or not snapshot.holdings:
                raise ValueError("No holdings found — upload a portfolio CSV first")

            holdings = snapshot.holdings
            tickers = [h.ticker for h in holdings]

            # Fetch Finnhub key for prices + sector data
            finnhub_key = await _get_api_key("finnhub", db)

            # Fetch LLM key for the chosen provider
            llm_provider = insight.llm_provider
            llm_model = insight.llm_model
            provider_for_key = llm_provider if llm_provider not in ("vllm",) else "openai"
            llm_key = await _get_api_key(provider_for_key, db)

            # Fetch prices — crypto batched into one CoinGecko call, stocks via Finnhub.
            from app.routers.portfolio import _fetch_prices_bulk
            price_map: dict[str, Optional[float]] = await _fetch_prices_bulk(tickers, finnhub_key)

            # Fetch sector info concurrently — crypto uses CoinGecko, stocks use Finnhub.
            sectors = await asyncio.gather(*[_fetch_sector(t, finnhub_key) for t in tickers])
            sector_map: dict[str, str] = dict(zip(tickers, sectors))

            # Fetch Markov regime context — uses 4h in-process cache
            from app.services.markov_service import get_regime_for_portfolio as _get_regime
            try:
                regime_map = await _get_regime(tickers)
            except Exception:
                regime_map = {}

            # Fetch last run verdict per ticker
            today = date.today()
            last_verdicts: dict[str, tuple[str, int]] = {}  # ticker → (verdict, days_ago)
            for ticker in tickers:
                run_result = await db.execute(
                    select(Run)
                    .where(
                        Run.created_by == portfolio.user_id,
                        Run.ticker == ticker,
                        Run.status == RunStatus.completed,
                        Run.verdict.isnot(None),
                    )
                    .order_by(desc(Run.created_at))
                    .limit(1)
                )
                run = run_result.scalar_one_or_none()
                if run:
                    days = (today - run.analysis_date).days
                    last_verdicts[ticker] = (run.verdict.value, days)

            # Compute portfolio totals and per-holding enrichment
            total_market_value = 0.0
            total_cost = 0.0
            has_price = False
            enriched: list[dict] = []

            for h in holdings:
                price = price_map[h.ticker]
                market_value = h.shares * price if price is not None else None
                pnl_pct = ((price / h.avg_cost - 1) * 100) if price is not None and h.avg_cost is not None and h.avg_cost != 0 else None

                if market_value is not None:
                    total_market_value += market_value
                    has_price = True
                    if h.avg_cost is not None:
                        total_cost += h.avg_cost * h.shares

                verdict_info = last_verdicts.get(h.ticker)
                enriched.append({
                    "ticker": h.ticker,
                    "sector": sector_map[h.ticker],
                    "shares": h.shares,
                    "avg_cost": round(h.avg_cost, 2) if h.avg_cost else None,
                    "current_price": round(price, 2) if price else None,
                    "market_value": round(market_value, 2) if market_value else None,
                    "weight_pct": None,  # filled below
                    "unrealized_pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
                    "last_verdict": verdict_info[0] if verdict_info else None,
                    "days_since_analysis": verdict_info[1] if verdict_info else None,
                })

            # Fill in weights
            for e in enriched:
                if e["market_value"] and total_market_value > 0:
                    e["weight_pct"] = round(e["market_value"] / total_market_value * 100, 1)

            total_pnl = (total_market_value - total_cost) if has_price and total_cost else None
            total_pnl_pct = ((total_market_value / total_cost - 1) * 100) if has_price and total_cost else None

            # Build prompt and call LLM
            prompt = _build_prompt(
                portfolio_name=portfolio.name,
                analysis_date=str(today),
                total_value=total_market_value if has_price else None,
                total_pnl=total_pnl,
                total_pnl_pct=total_pnl_pct,
                holdings=enriched,
                investor_profile=investor_profile,
                regime_map=regime_map,
            )

            raw_response = await _call_llm(llm_provider, llm_model, llm_key, prompt)
            parsed = _parse_insight_json(raw_response)

            # Validate and coerce fields
            health_score = int(parsed.get("health_score", 5))
            health_score = max(1, min(10, health_score))

            stance_raw = str(parsed.get("overall_stance", "neutral")).lower()
            try:
                stance = InsightStance(stance_raw)
            except ValueError:
                stance = InsightStance.neutral

            # Persist results
            insight.health_score = health_score
            insight.overall_stance = stance
            insight.summary = str(parsed.get("summary", ""))[:2000]
            insight.action_items = parsed.get("action_items", [])
            insight.risk_alerts = parsed.get("risk_alerts", [])
            insight.sector_analysis = parsed.get("sector_analysis", {})
            insight.strengths = parsed.get("strengths", [])
            insight.weaknesses = parsed.get("weaknesses", [])
            insight.holdings_snapshot = {
                "total_market_value": round(total_market_value, 2) if has_price else None,
                "total_pnl": round(total_pnl, 2) if total_pnl is not None else None,
                "total_pnl_pct": round(total_pnl_pct, 2) if total_pnl_pct is not None else None,
                "holdings": enriched,
            }
            insight.status = InsightStatus.completed
            _completed = True

        except Exception as exc:
            logger.exception("Insight generation failed for insight_id=%s", insight_id)
            insight.status = InsightStatus.failed
            insight.error = str(exc)[:1000]

        await db.commit()
        if _completed:
            from app.services.delivery_service import deliver_insight_if_configured
            asyncio.create_task(deliver_insight_if_configured(insight_id))
