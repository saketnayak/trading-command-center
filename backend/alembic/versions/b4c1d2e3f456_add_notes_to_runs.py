"""add_notes_to_runs

Revision ID: b4c1d2e3f456
Revises: 5a1f812d854e
Create Date: 2026-05-22 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4c1d2e3f456'
down_revision: Union[str, Sequence[str], None] = '5a1f812d854e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('runs', sa.Column('notes', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('runs', 'notes')
