"""Read-only crypto wallet balances by public address (no keys, no signing).

BTC: mempool.space (confirmed + unconfirmed balance of one address; an xpub
is not supported). ETH: a public JSON-RPC node, native ETH only (no tokens).
A successful sync records today's balance as the wallet's valuation; a
failure keeps the previous balance and stores the error on the item.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.net_worth import NetWorthItem, NetWorthValuation

logger = logging.getLogger(__name__)

CHAINS = {"btc": "BTC-USD", "eth": "ETH-USD"}  # chain → price-store symbol (USD)
_ADDRESS = {
    "btc": re.compile(r"^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$"),
    "eth": re.compile(r"^0x[0-9a-fA-F]{40}$"),
}
BTC_API = "https://mempool.space/api/address/{address}"
ETH_RPC = "https://ethereum-rpc.publicnode.com"
TIMEOUT_S = 10.0


def valid_address(chain: str, address: str) -> bool:
    pattern = _ADDRESS.get(chain)
    return bool(pattern and pattern.match(address))


async def fetch_balance(chain: str, address: str) -> float:
    """Coins held at `address`. Raises on network or API errors."""
    async with httpx.AsyncClient(timeout=TIMEOUT_S, headers={"User-Agent": "AgentFloor/1.0"}) as client:
        if chain == "btc":
            r = await client.get(BTC_API.format(address=address))
            r.raise_for_status()
            data = r.json()
            sats = sum(s["funded_txo_sum"] - s["spent_txo_sum"] for s in (data["chain_stats"], data["mempool_stats"]))
            return sats / 1e8
        if chain == "eth":
            r = await client.post(ETH_RPC, json={"jsonrpc": "2.0", "id": 1, "method": "eth_getBalance",
                                                 "params": [address, "latest"]})
            r.raise_for_status()
            data = r.json()
            if "result" not in data:
                raise ValueError(data.get("error", {}).get("message", "no result"))
            return int(data["result"], 16) / 1e18
    raise ValueError(f"unsupported chain {chain}")


async def sync_wallet(db: AsyncSession, item: NetWorthItem) -> bool:
    """Refresh one wallet's balance; True on success. The caller commits."""
    now = datetime.now(timezone.utc)
    try:
        balance = await fetch_balance(item.wallet_chain or "", item.wallet_address or "")
    except Exception as exc:  # noqa: BLE001 - shown to the user, the old balance stays
        logger.info("wallet sync failed for %s: %s", item.id, exc)
        item.sync_error = f"Could not read the balance: {str(exc)[:200]}"
        return False
    stmt = insert(NetWorthValuation).values(item_id=item.id, date=now.date(), value=balance)
    await db.execute(stmt.on_conflict_do_update(index_elements=["item_id", "date"], set_={"value": balance}))
    item.synced_at = now
    item.sync_error = None
    return True


async def sync_all_wallets() -> None:
    """Nightly scheduler job."""
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        wallets = (await db.execute(select(NetWorthItem).where(NetWorthItem.wallet_chain.is_not(None)))).scalars().all()
        ok = 0
        for w in wallets:
            ok += await sync_wallet(db, w)
        await db.commit()
    logger.info("wallets synced: %d of %d", ok, len(wallets))
