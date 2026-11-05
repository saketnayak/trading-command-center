"""pick_category: what a coin is, from CoinGecko's category list (lists captured 2026-11-06)."""
import pytest

from app.services.crypto_data_service import pick_category

pytestmark = pytest.mark.unit

BITCOIN = ["Smart Contract Platform", "Layer 1 (L1)", "FTX Holdings", "Proof of Work (PoW)", "Bitcoin Ecosystem",
           "GMCI 30 Index", "GMCI Index", "Coinbase 50 Index"]
DOGECOIN = ["Smart Contract Platform", "Meme", "Dog-Themed", "Elon Musk-Inspired", "Proof of Work (PoW)",
            "GMCI Meme Index", "GMCI 30 Index", "GMCI Index", "Coinbase 50 Index", "4chan-Themed"]
TETHER = ["Stablecoins", "USD Stablecoin", "Solana Ecosystem", "Avalanche Ecosystem", "FTX Holdings",
          "Fiat-backed Stablecoin", "World Liberty Financial Portfolio", "Tether Ecosystem"]


@pytest.mark.parametrize("categories,want", [
    (BITCOIN, "Layer 1 (L1)"),
    (DOGECOIN, "Meme"),
    (TETHER, "Stablecoins"),
    (["Solana Ecosystem", "Gaming (GameFi)", "Multicoin Capital Portfolio"], "Gaming (GameFi)"),
    (["Smart Contract Platform", "Ethereum Ecosystem"], "Smart Contract Platform"),
    (["FTX Holdings", "GMCI Index"], None),
    ([], None),
])
def test_pick_category(categories, want):
    assert pick_category(categories) == want
