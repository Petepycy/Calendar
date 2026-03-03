"""Fix knowledge_entries table: add created_at, fix column lengths.

Revision ID: 007
Revises: 006
Create Date: 2026-03-02

The knowledge_entries table was created manually before migration 005 ran,
so it's missing the created_at column and has shorter varchar limits.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add created_at (backfill with now() for existing rows)
    op.add_column(
        "knowledge_entries",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
    )
    # Backfill existing rows
    op.execute("UPDATE knowledge_entries SET created_at = NOW() WHERE created_at IS NULL")

    # Fix column types to match the model definition
    op.alter_column("knowledge_entries", "category", type_=sa.String(255), existing_nullable=False)
    op.alter_column("knowledge_entries", "question", type_=sa.Text, existing_nullable=False)


def downgrade() -> None:
    op.alter_column("knowledge_entries", "question", type_=sa.String(500), existing_nullable=False)
    op.alter_column("knowledge_entries", "category", type_=sa.String(100), existing_nullable=False)
    op.drop_column("knowledge_entries", "created_at")
