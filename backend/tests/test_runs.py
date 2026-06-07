import uuid
import base64
import json
import pytest
from datetime import date
from httpx import AsyncClient, ASGITransport
from main import app


async def _get_token(client, email="runs@test.com"):
    await client.post("/auth/register", json={"email": email, "password": "password1", "name": "Test"})
    r = await client.post("/auth/login", json={"email": email, "password": "password1"})
    return r.json()["access_token"]


async def _decode_user_id(token: str) -> str:
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    return json.loads(base64.b64decode(payload_b64))["sub"]


@pytest.mark.asyncio
async def test_get_run_includes_price_levels():
    """GET /runs/{id} returns price fields populated from the associated Report."""
    from app.database import AsyncSessionLocal
    from app.models.run import Run, RunStatus, RunVerdict
    from app.models.report import Report

    run_id = uuid.uuid4()
    email = f"prices_{run_id.hex[:8]}@test.com"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/auth/register", json={"email": email, "password": "password1", "name": "T"})
        r = await client.post("/auth/login", json={"email": email, "password": "password1"})
        token = r.json()["access_token"]
        user_id = await _decode_user_id(token)

        async with AsyncSessionLocal() as db:
            db.add(Run(
                id=run_id,
                created_by=uuid.UUID(user_id),
                ticker="NVDA",
                analysis_date=date(2024, 6, 1),
                llm_provider="openai",
                llm_model="gpt-4o",
                depth="standard",
                analysts=["market"],
                status=RunStatus.completed,
                verdict=RunVerdict.buy,
            ))
            await db.flush()
            db.add(Report(
                run_id=run_id,
                trader_decision="Entry: $200. Stop Loss: $185. Target: $230.",
                verdict=RunVerdict.buy,
                suggested_entry="200",
                suggested_stop="185",
                suggested_target="230",
                risk_assessment="",
            ))
            await db.commit()

        r = await client.get(f"/runs/{run_id}", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        data = r.json()
        assert data["suggested_entry"] == "200"
        assert data["suggested_stop"] == "185"
        assert data["suggested_target"] == "230"


@pytest.mark.asyncio
async def test_list_runs_includes_price_levels():
    """GET /runs returns price fields in each run that has a completed Report."""
    from app.database import AsyncSessionLocal
    from app.models.run import Run, RunStatus, RunVerdict
    from app.models.report import Report

    run_id = uuid.uuid4()
    email = f"prices2_{run_id.hex[:8]}@test.com"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post("/auth/register", json={"email": email, "password": "password1", "name": "T"})
        r = await client.post("/auth/login", json={"email": email, "password": "password1"})
        token = r.json()["access_token"]
        user_id = await _decode_user_id(token)

        async with AsyncSessionLocal() as db:
            db.add(Run(
                id=run_id,
                created_by=uuid.UUID(user_id),
                ticker="TSLA",
                analysis_date=date(2024, 6, 1),
                llm_provider="openai",
                llm_model="gpt-4o",
                depth="standard",
                analysts=["market"],
                status=RunStatus.completed,
                verdict=RunVerdict.hold,
            ))
            await db.flush()
            db.add(Report(
                run_id=run_id,
                trader_decision="Entry: $150. Stop: $140. Target: $175.",
                verdict=RunVerdict.hold,
                suggested_entry="150",
                suggested_stop="140",
                suggested_target="175",
                risk_assessment="",
            ))
            await db.commit()

        r = await client.get("/runs", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        run_data = next((x for x in r.json() if x["id"] == str(run_id)), None)
        assert run_data is not None
        assert run_data["suggested_entry"] == "150"
        assert run_data["suggested_stop"] == "140"
        assert run_data["suggested_target"] == "175"


@pytest.mark.asyncio
async def test_list_runs_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/runs")
        assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_runs_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _get_token(client, "runs2@test.com")
        r = await client.get("/runs", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_latest_by_ticker_returns_null_for_no_runs():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _get_token(client, f"lbt_none_{uuid.uuid4().hex[:6]}@test.com")
        r = await client.get(
            "/runs/latest-by-ticker?tickers=FAKEXYZ",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json() == {"FAKEXYZ": None}


@pytest.mark.asyncio
async def test_latest_by_ticker_returns_most_recent_completed():
    from app.database import AsyncSessionLocal
    from app.models.run import Run, RunStatus, RunVerdict
    from datetime import date, datetime, timezone

    email = f"lbt_{uuid.uuid4().hex[:8]}@test.com"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _get_token(client, email)
        user_id = await _decode_user_id(token)

        run_id = uuid.uuid4()
        async with AsyncSessionLocal() as db:
            db.add(Run(
                id=run_id,
                created_by=uuid.UUID(user_id),
                ticker="AAPL",
                analysis_date=date.today(),
                llm_provider="openai",
                llm_model="gpt-4o",
                depth="standard",
                analysts=["market"],
                status=RunStatus.completed,
                verdict=RunVerdict.buy,
                completed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ))
            await db.commit()

        r = await client.get(
            "/runs/latest-by-ticker?tickers=AAPL,FAKEXYZ",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["FAKEXYZ"] is None
        assert data["AAPL"]["run_id"] == str(run_id)
        assert data["AAPL"]["verdict"] == "buy"
        assert data["AAPL"]["completed_at"] is not None


@pytest.mark.asyncio
async def test_latest_by_ticker_scoped_to_user():
    """Another user's runs must not appear."""
    from app.database import AsyncSessionLocal
    from app.models.run import Run, RunStatus, RunVerdict
    from app.services.auth import create_invite_token
    from datetime import date, datetime, timezone

    email_a = f"lbt_a_{uuid.uuid4().hex[:6]}@test.com"
    email_b = f"lbt_b_{uuid.uuid4().hex[:6]}@test.com"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token_a = await _get_token(client, email_a)
        invite = create_invite_token(email_b)
        await client.post("/auth/register", json={
            "email": email_b, "password": "password1", "name": "Test", "invite_token": invite,
        })
        r_b = await client.post("/auth/login", json={"email": email_b, "password": "password1"})
        token_b = r_b.json()["access_token"]
        user_a_id = await _decode_user_id(token_a)

        run_id = uuid.uuid4()
        async with AsyncSessionLocal() as db:
            db.add(Run(
                id=run_id,
                created_by=uuid.UUID(user_a_id),
                ticker="TSLA",
                analysis_date=date.today(),
                llm_provider="openai",
                llm_model="gpt-4o",
                depth="standard",
                analysts=["market"],
                status=RunStatus.completed,
                verdict=RunVerdict.sell,
                completed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ))
            await db.commit()

        # user_b should not see user_a's run
        r = await client.get(
            "/runs/latest-by-ticker?tickers=TSLA",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert r.status_code == 200
        assert r.json()["TSLA"] is None


@pytest.mark.asyncio
async def test_run_read_endpoints_are_team_visible():
    """Run history is team-visible: members can inspect other users' run artifacts."""
    from app.database import AsyncSessionLocal
    from app.models.agent_event import AgentEvent, EventType
    from app.models.outcome import RunOutcome
    from app.models.report import Report
    from app.models.run import Run, RunStatus, RunVerdict
    from app.services.auth import create_invite_token
    from datetime import date, datetime, timezone

    owner_email = f"run_owner_{uuid.uuid4().hex[:6]}@test.com"
    member_email = f"run_member_{uuid.uuid4().hex[:6]}@test.com"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        owner_token = await _get_token(client, owner_email)
        invite = create_invite_token(member_email)
        await client.post("/auth/register", json={
            "email": member_email,
            "password": "password1",
            "name": "Member",
            "invite_token": invite,
        })
        member_login = await client.post("/auth/login", json={"email": member_email, "password": "password1"})
        member_token = member_login.json()["access_token"]
        owner_id = await _decode_user_id(owner_token)

        run_id = uuid.uuid4()
        own_run_id = uuid.uuid4()
        async with AsyncSessionLocal() as db:
            db.add(Run(
                id=run_id,
                created_by=uuid.UUID(owner_id),
                ticker="LEAK",
                analysis_date=date.today(),
                llm_provider="openai",
                llm_model="gpt-4o",
                depth="standard",
                analysts=["market"],
                status=RunStatus.completed,
                verdict=RunVerdict.buy,
                completed_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ))
            db.add(Run(
                id=own_run_id,
                created_by=uuid.UUID(await _decode_user_id(member_token)),
                ticker="OWN",
                analysis_date=date.today(),
                llm_provider="openai",
                llm_model="gpt-4o",
                depth="standard",
                analysts=["market"],
                status=RunStatus.completed,
                verdict=RunVerdict.hold,
                completed_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            ))
            await db.flush()
            db.add(Report(
                run_id=run_id,
                trader_decision="private report",
                verdict=RunVerdict.buy,
                risk_assessment="private risk",
            ))
            db.add(AgentEvent(
                run_id=run_id,
                agent_name="market_analyst",
                event_type=EventType.started,
                payload={"type": "started", "secret": "private"},
                sequence=1,
            ))
            db.add(RunOutcome(
                run_id=run_id,
                ticker="LEAK",
                verdict="buy",
                analysis_date=str(date.today()),
                price_at_analysis=100,
                price_7d=110,
            ))
            await db.commit()

        headers = {"Authorization": f"Bearer {member_token}"}
        list_response = await client.get("/runs", headers=headers)
        assert list_response.status_code == 200
        assert str(run_id) in {row["id"] for row in list_response.json()}

        filtered_response = await client.get(f"/runs?user_id={owner_id}", headers=headers)
        assert filtered_response.status_code == 200
        assert [row["id"] for row in filtered_response.json()] == [str(run_id)]

        for path in [
            f"/runs/{run_id}",
            f"/runs/{run_id}/report",
            f"/runs/{run_id}/events",
            f"/runs/{run_id}/outcome",
        ]:
            response = await client.get(path, headers=headers)
            assert response.status_code == 200

        compare_response = await client.get(
            f"/runs/compare?a={own_run_id}&b={run_id}",
            headers=headers,
        )
        assert compare_response.status_code == 200


@pytest.mark.asyncio
async def test_run_stats_and_performance_are_team_visible():
    from app.database import AsyncSessionLocal
    from app.models.outcome import RunOutcome
    from app.models.run import Run, RunStatus, RunVerdict
    from app.services.auth import create_invite_token
    from datetime import date

    owner_email = f"stats_owner_{uuid.uuid4().hex[:6]}@test.com"
    member_email = f"stats_member_{uuid.uuid4().hex[:6]}@test.com"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        owner_token = await _get_token(client, owner_email)
        invite = create_invite_token(member_email)
        await client.post("/auth/register", json={
            "email": member_email,
            "password": "password1",
            "name": "Member",
            "invite_token": invite,
        })
        member_login = await client.post("/auth/login", json={"email": member_email, "password": "password1"})
        member_token = member_login.json()["access_token"]
        owner_id = await _decode_user_id(owner_token)
        member_id = await _decode_user_id(member_token)

        owner_run_id = uuid.uuid4()
        member_run_id = uuid.uuid4()
        async with AsyncSessionLocal() as db:
            for run_id, user_id, ticker, verdict in [
                (owner_run_id, owner_id, "AAPL", RunVerdict.buy),
                (member_run_id, member_id, "MSFT", RunVerdict.sell),
            ]:
                db.add(Run(
                    id=run_id,
                    created_by=uuid.UUID(user_id),
                    ticker=ticker,
                    analysis_date=date.today(),
                    llm_provider="openai",
                    llm_model="gpt-4o",
                    depth="standard",
                    analysts=["market"],
                    status=RunStatus.completed,
                    verdict=verdict,
                ))
            await db.flush()
            for run_id, ticker, verdict in [
                (owner_run_id, "AAPL", RunVerdict.buy),
                (member_run_id, "MSFT", RunVerdict.sell),
            ]:
                db.add(RunOutcome(
                    run_id=run_id,
                    ticker=ticker,
                    verdict=verdict.value,
                    analysis_date=str(date.today()),
                    price_at_analysis=100,
                    price_7d=110 if verdict == RunVerdict.buy else 90,
                ))
            await db.commit()

        headers = {"Authorization": f"Bearer {member_token}"}
        stats = await client.get("/runs/stats", headers=headers)
        assert stats.status_code == 200
        assert stats.json()["total"] == 2
        assert stats.json()["verdicts"]["sell"] == 1
        assert stats.json()["verdicts"]["buy"] == 1

        performance = await client.get("/runs/performance", headers=headers)
        assert performance.status_code == 200
        data = performance.json()
        assert data["total"] == 2
        assert {row["ticker"] for row in data["outcomes"]} == {"AAPL", "MSFT"}


@pytest.mark.asyncio
async def test_list_runs_filters_by_date_range():
    """GET /runs?date_from=... excludes runs created before the cutoff."""
    from app.database import AsyncSessionLocal
    from app.models.run import Run, RunStatus, RunVerdict
    from datetime import date, datetime, timezone, timedelta
    from sqlalchemy import update
    from urllib.parse import quote

    email = f"dr_{uuid.uuid4().hex[:8]}@test.com"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _get_token(client, email)
        user_id = await _decode_user_id(token)

        old_id = uuid.uuid4()
        new_id = uuid.uuid4()
        old_ts = datetime.now(timezone.utc) - timedelta(days=30)
        new_ts = datetime.now(timezone.utc) - timedelta(hours=1)
        async with AsyncSessionLocal() as db:
            for rid, ticker in [(old_id, "OLDX"), (new_id, "NEWX")]:
                db.add(Run(
                    id=rid,
                    created_by=uuid.UUID(user_id),
                    ticker=ticker,
                    analysis_date=date.today(),
                    llm_provider="openai",
                    llm_model="gpt-4o",
                    depth="standard",
                    analysts=["market"],
                    status=RunStatus.completed,
                    verdict=RunVerdict.buy,
                ))
            await db.commit()
            # created_at uses server_default, so override explicitly for both rows.
            await db.execute(update(Run).where(Run.id == old_id).values(created_at=old_ts))
            await db.execute(update(Run).where(Run.id == new_id).values(created_at=new_ts))
            await db.commit()

        cutoff = quote((datetime.now(timezone.utc) - timedelta(days=7)).isoformat())
        r = await client.get(
            f"/runs?date_from={cutoff}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        tickers = [row["ticker"] for row in r.json()]
        assert "NEWX" in tickers
        assert "OLDX" not in tickers


@pytest.mark.asyncio
async def test_patch_run_updates_notes():
    """PATCH /runs/{id} persists notes and returns them in the response."""
    from app.database import AsyncSessionLocal
    from app.models.run import Run, RunStatus, RunVerdict
    from datetime import date

    email = f"notes_{uuid.uuid4().hex[:8]}@test.com"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _get_token(client, email)
        user_id = await _decode_user_id(token)

        run_id = uuid.uuid4()
        async with AsyncSessionLocal() as db:
            db.add(Run(
                id=run_id,
                created_by=uuid.UUID(user_id),
                ticker="AAPL",
                analysis_date=date.today(),
                llm_provider="openai",
                llm_model="gpt-4o",
                depth="standard",
                analysts=["market"],
                status=RunStatus.completed,
                verdict=RunVerdict.buy,
            ))
            await db.commit()

        r = await client.patch(
            f"/runs/{run_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"notes": "Took the trade, stopped out on FOMC."},
        )
        assert r.status_code == 200
        assert r.json()["notes"] == "Took the trade, stopped out on FOMC."

        # Clearing via empty string should null the field.
        r = await client.patch(
            f"/runs/{run_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"notes": ""},
        )
        assert r.status_code == 200
        assert r.json()["notes"] is None

        # Omitting notes from the body must NOT clobber the existing value.
        r = await client.patch(
            f"/runs/{run_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"notes": "Second attempt"},
        )
        assert r.status_code == 200
        r = await client.patch(
            f"/runs/{run_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"label": "tagged"},
        )
        assert r.status_code == 200
        assert r.json()["notes"] == "Second attempt"
        assert r.json()["label"] == "tagged"
