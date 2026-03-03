"""Change users.telegram_chat_id from INTEGER to BIGINT.

Revision ID: 008
Revises: 007
Create Date: 2026-03-02

Telegram user IDs can exceed 2^31 (int32 limit), causing DataError on lookup.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "users",
        "telegram_chat_id",
        type_=sa.BigInteger,
        existing_type=sa.Integer,
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "users",
        "telegram_chat_id",
        type_=sa.Integer,
        existing_type=sa.BigInteger,
        existing_nullable=True,
    )
