import pytest
from unittest.mock import AsyncMock
from app.services.websocket_manager import WebSocketManager

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@pytest.mark.asyncio
async def test_broadcast_sends_to_all_subscribers():
    manager = WebSocketManager()
    ws1, ws2 = AsyncMock(), AsyncMock()
    ws1.accept, ws2.accept = AsyncMock(), AsyncMock()
    await manager.connect("run-1", ws1)
    await manager.connect("run-1", ws2)
    await manager.broadcast("run-1", {"type": "token"})
    ws1.send_json.assert_awaited_once_with({"type": "token"})
    ws2.send_json.assert_awaited_once_with({"type": "token"})


@pytest.mark.asyncio
async def test_broadcast_ignores_dead_connections():
    manager = WebSocketManager()
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.send_json.side_effect = Exception("disconnected")
    await manager.connect("run-2", ws)
    await manager.broadcast("run-2", {"type": "token"})  # should not raise
    assert len(manager._connections["run-2"]) == 0
