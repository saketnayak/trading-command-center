"""one watchlist per user: merge any duplicates and add a unique constraint

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1

A user's watchlist is auto-created on first load, and nothing stopped two
simultaneous first loads from creating two, after which every load raised
MultipleResultsFound. Duplicates merge into the user's oldest watchlist; when
both hold a ticker, the oldest watchlist's item wins.

Create Date: 2026-11-05 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "z6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RANKED = """
    SELECT id, FIRST_VALUE(id) OVER (PARTITION BY created_by ORDER BY created_at, id) AS keep_id,
           ROW_NUMBER() OVER (PARTITION BY created_by ORDER BY created_at, id) AS list_rank
    FROM watchlists
"""


def upgrade() -> None:
    op.execute(f"""
        WITH ranked AS ({_RANKED}),
        candidates AS (
            SELECT i.id, r.keep_id,
                   ROW_NUMBER() OVER (PARTITION BY r.keep_id, i.ticker ORDER BY r.list_rank, i.id) AS item_rank
            FROM watchlist_items i JOIN ranked r ON r.id = i.watchlist_id
        )
        UPDATE watchlist_items i SET watchlist_id = c.keep_id
        FROM candidates c
        WHERE i.id = c.id AND c.item_rank = 1 AND i.watchlist_id <> c.keep_id
    """)
    op.execute(f"""
        WITH ranked AS ({_RANKED})
        DELETE FROM watchlist_items i USING ranked r
        WHERE i.watchlist_id = r.id AND r.list_rank > 1
    """)
    op.execute(f"""
        WITH ranked AS ({_RANKED})
        DELETE FROM watchlists w USING ranked r
        WHERE w.id = r.id AND r.list_rank > 1
    """)
    op.create_unique_constraint("uq_watchlists_created_by", "watchlists", ["created_by"])


def downgrade() -> None:
    op.drop_constraint("uq_watchlists_created_by", "watchlists", type_="unique")
