"""remove empty ledger snapshots stranded on portfolios with no transactions

Deleting a portfolio's only transaction used to leave its empty derived snapshot
as the latest one, hiding the real holdings underneath with no way back in the
app. These rows hold no data, so removing them only brings those holdings back.

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-11-05 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "v2w3x4y5z6a7"
down_revision: Union[str, Sequence[str], None] = "u1v2w3x4y5z6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DELETE FROM portfolio_snapshots s
        WHERE s.broker = 'ledger'
          AND NOT EXISTS (SELECT 1 FROM portfolio_holdings h WHERE h.snapshot_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM portfolio_transactions t WHERE t.portfolio_id = s.portfolio_id)
    """)


def downgrade() -> None:
    pass  # the removed rows were empty, so there is nothing to put back
