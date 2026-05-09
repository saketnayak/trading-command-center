"""cascade delete on user and run foreign keys

Revision ID: e1f2a3b4c5d6
Revises: b1c2d3e4f5a6
Create Date: 2026-05-09 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # runs.created_by → users.id  ON DELETE CASCADE
    op.drop_constraint("runs_created_by_fkey", "runs", type_="foreignkey")
    op.create_foreign_key(
        "runs_created_by_fkey", "runs", "users", ["created_by"], ["id"], ondelete="CASCADE"
    )

    # watchlists.created_by → users.id  ON DELETE CASCADE
    op.drop_constraint("watchlists_created_by_fkey", "watchlists", type_="foreignkey")
    op.create_foreign_key(
        "watchlists_created_by_fkey", "watchlists", "users", ["created_by"], ["id"], ondelete="CASCADE"
    )

    # portfolios.user_id → users.id  ON DELETE CASCADE
    op.drop_constraint("portfolios_user_id_fkey", "portfolios", type_="foreignkey")
    op.create_foreign_key(
        "portfolios_user_id_fkey", "portfolios", "users", ["user_id"], ["id"], ondelete="CASCADE"
    )

    # api_keys.created_by → users.id  ON DELETE CASCADE
    op.drop_constraint("api_keys_created_by_fkey", "api_keys", type_="foreignkey")
    op.create_foreign_key(
        "api_keys_created_by_fkey", "api_keys", "users", ["created_by"], ["id"], ondelete="CASCADE"
    )

    # run_outcomes.run_id → runs.id  ON DELETE CASCADE
    op.drop_constraint("run_outcomes_run_id_fkey", "run_outcomes", type_="foreignkey")
    op.create_foreign_key(
        "run_outcomes_run_id_fkey", "run_outcomes", "runs", ["run_id"], ["id"], ondelete="CASCADE"
    )


def downgrade() -> None:
    op.drop_constraint("run_outcomes_run_id_fkey", "run_outcomes", type_="foreignkey")
    op.create_foreign_key(
        "run_outcomes_run_id_fkey", "run_outcomes", "runs", ["run_id"], ["id"]
    )

    op.drop_constraint("api_keys_created_by_fkey", "api_keys", type_="foreignkey")
    op.create_foreign_key(
        "api_keys_created_by_fkey", "api_keys", "users", ["created_by"], ["id"]
    )

    op.drop_constraint("portfolios_user_id_fkey", "portfolios", type_="foreignkey")
    op.create_foreign_key(
        "portfolios_user_id_fkey", "portfolios", "users", ["user_id"], ["id"]
    )

    op.drop_constraint("watchlists_created_by_fkey", "watchlists", type_="foreignkey")
    op.create_foreign_key(
        "watchlists_created_by_fkey", "watchlists", "users", ["created_by"], ["id"]
    )

    op.drop_constraint("runs_created_by_fkey", "runs", type_="foreignkey")
    op.create_foreign_key(
        "runs_created_by_fkey", "runs", "users", ["created_by"], ["id"]
    )
