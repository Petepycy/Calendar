"""Add summary and chat_notified to escalations.

Revision ID: 004
Revises: 003
Create Date: 2026-03-02
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("escalations", sa.Column("summary", sa.Text, nullable=True))
    op.add_column(
        "escalations",
        sa.Column(
            "chat_notified",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("escalations", "chat_notified")
    op.drop_column("escalations", "summary")
