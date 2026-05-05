"""add archived to runs

Revision ID: a1b2c3d4e5f6
Revises: c0d09a62c988
Create Date: 2026-05-05

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'c0d09a62c988'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('runs', sa.Column('archived', sa.Boolean(), nullable=False, server_default='false'))


def downgrade() -> None:
    op.drop_column('runs', 'archived')
