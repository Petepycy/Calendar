"""Add Gmail API provider support to email_configs.

Revision ID: 010
Revises: 009
Create Date: 2026-03-05

Adds email_provider column, google_refresh_token column,
and makes IMAP-specific fields nullable for Gmail OAuth users.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "email_configs",
        sa.Column("email_provider", sa.String(20), nullable=False, server_default="imap"),
    )
    op.add_column(
        "email_configs",
        sa.Column("google_refresh_token", sa.Text(), nullable=True),
    )
    # Make IMAP-specific fields nullable (not needed for Gmail OAuth)
    op.alter_column("email_configs", "imap_server", existing_type=sa.String(255), nullable=True)
    op.alter_column("email_configs", "smtp_server", existing_type=sa.String(255), nullable=True)
    op.alter_column("email_configs", "encrypted_password", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.alter_column("email_configs", "encrypted_password", existing_type=sa.Text(), nullable=False)
    op.alter_column("email_configs", "smtp_server", existing_type=sa.String(255), nullable=False)
    op.alter_column("email_configs", "imap_server", existing_type=sa.String(255), nullable=False)
    op.drop_column("email_configs", "google_refresh_token")
    op.drop_column("email_configs", "email_provider")
