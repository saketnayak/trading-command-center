import pytest

from jev_loop.pricing import quote_prices, reservation_price

pytestmark = pytest.mark.unit


def test_long_inventory_pulls_reservation_below_mid():
    assert reservation_price(100.0, 1.0, 0.1, 0.01, 60.0) < 100.0


def test_quotes_straddle_the_reservation_price():
    bid, ask = quote_prices(mid=100.0, inventory=0.0, sigma=0.001, gamma=0.1, kappa=1.5, time_left_s=60.0)
    assert bid < 100.0 < ask
