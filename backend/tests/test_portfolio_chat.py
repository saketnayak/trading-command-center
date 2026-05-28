import pytest
from pathlib import Path
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
from main import app

FIXTURES_DIR = Path(__file__).parent / "fixtures"


async def _register_and_token(client: AsyncClient, email: str = "chat@example.com") -> str:
    r = await client.post("/auth/register", json={
        "email": email, "password": "pass1234", "name": "Test"
    })
    return r.json()["access_token"]


async def _create_portfolio_with_holding(client: AsyncClient, token: str) -> str:
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/portfolio", json={"name": "Test Portfolio"}, headers=headers)
    assert r.status_code == 200
    portfolio_id = r.json()["id"]
    with open(FIXTURES_DIR / "generic_positions.csv", "rb") as f:
        r2 = await client.post(
            f"/portfolio/{portfolio_id}/upload",
            files={"file": ("positions.csv", f, "text/csv")},
            headers=headers,
        )
    assert r2.status_code == 200
    return portfolio_id


@pytest.mark.asyncio
async def test_chat_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/portfolio/00000000-0000-0000-0000-000000000001/chat",
            json={"message": "hello", "llm_provider": "openai", "llm_model": "gpt-4o-mini"},
        )
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_chat_returns_404_for_missing_portfolio():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "chat404@example.com")
        r = await c.post(
            "/portfolio/00000000-0000-0000-0000-000000000099/chat",
            json={"message": "hello", "llm_provider": "openai", "llm_model": "gpt-4o-mini"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_chat_happy_path_returns_response_shape():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "chathappy@example.com")
        portfolio_id = await _create_portfolio_with_holding(c, token)

        with patch(
            "app.services.portfolio_chat_service._call_llm_chat",
            new=AsyncMock(return_value="AAPL is your largest position."),
        ):
            r = await c.post(
                f"/portfolio/{portfolio_id}/chat",
                json={
                    "message": "Where am I most overexposed?",
                    "conversation_history": [],
                    "llm_provider": "openai",
                    "llm_model": "gpt-4o-mini",
                },
                headers={"Authorization": f"Bearer {token}"},
            )

        assert r.status_code == 200
        data = r.json()
        assert data["response"] == "AAPL is your largest position."
        assert data["provider"] == "openai"
        assert data["model"] == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_chat_passes_conversation_history():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        token = await _register_and_token(c, "chathistory@example.com")
        portfolio_id = await _create_portfolio_with_holding(c, token)

        captured_messages: list[list[dict]] = []

        async def _capture(provider, model, api_key, system, messages):
            captured_messages.append(messages)
            return "Noted."

        with patch(
            "app.services.portfolio_chat_service._call_llm_chat",
            new=AsyncMock(side_effect=_capture),
        ):
            await c.post(
                f"/portfolio/{portfolio_id}/chat",
                json={
                    "message": "What about my tech exposure?",
                    "conversation_history": [
                        {"role": "user", "content": "Where am I most overexposed?"},
                        {"role": "assistant", "content": "You are overexposed to tech."},
                    ],
                    "llm_provider": "openai",
                    "llm_model": "gpt-4o-mini",
                },
                headers={"Authorization": f"Bearer {token}"},
            )

        assert len(captured_messages) == 1
        messages = captured_messages[0]
        contents = [m["content"] for m in messages]
        assert any("Where am I most overexposed?" in c for c in contents)
        assert any("You are overexposed to tech." in c for c in contents)
        assert any("What about my tech exposure?" in c for c in contents)
