"""Avellaneda-Stoikov reservation price and half spread. Code, never the model.

    reservation r = mid - inventory * gamma * sigma^2 * (T - t)
    half spread   = gamma * sigma^2 * (T - t) + (2 / gamma) * ln(1 + gamma / kappa)
"""

from __future__ import annotations

import math


def reservation_price(mid: float, inventory: float, gamma: float, sigma: float, time_left_s: float) -> float:
    return mid - inventory * gamma * (sigma**2) * time_left_s


def half_spread(gamma: float, sigma: float, time_left_s: float, kappa: float) -> float:
    return gamma * (sigma**2) * time_left_s + (2.0 / gamma) * math.log1p(gamma / kappa)


def quote_prices(
    mid: float, inventory: float, sigma: float, gamma: float, kappa: float, time_left_s: float
) -> tuple[float, float]:
    r = reservation_price(mid, inventory, gamma, sigma, time_left_s)
    h = half_spread(gamma, sigma, time_left_s, kappa)
    return r - h, r + h
