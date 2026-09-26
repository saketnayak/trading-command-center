"""Pure core of JEV Lab: a Jev-driven market-making loop.

Ported from Roan's (@RohOnChain) jev-loop blueprint. Code computes the
state, Jev answers seven typed judgment questions about it, code decides
(policy.py + strategy.py), code can veto anything (risk.py + limits.py).

This package does no I/O: no network, no database, no clock reads except
where a caller passes `now` in. Market data, the Jev client, Alpaca paper
execution and persistence live in app/services/jev_*.py.
"""
