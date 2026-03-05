"""Add email_configs and processed_emails tables.

Revision ID: 009
Revises: 008
Create Date: 2026-03-04

Per-tenant IMAP/SMTP email integration for AI auto-reply.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_configs",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("email_address", sa.String(320), nullable=False),
        sa.Column("imap_server", sa.String(255), nullable=False),
        sa.Column("imap_port", sa.Integer(), nullable=False, server_default="993"),
        sa.Column("smtp_server", sa.String(255), nullable=False),
        sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="587"),
        sa.Column("encrypted_password", sa.Text(), nullable=False),
        sa.Column("use_ssl", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", name="uq_email_config_per_tenant"),
    )
    op.create_index("ix_email_configs_tenant_id", "email_configs", ["tenant_id"])

    op.create_table(
        "processed_emails",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("message_id", sa.String(512), nullable=False),
        sa.Column("from_address", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(1000), nullable=False, server_default=""),
        sa.Column("body_preview", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("ai_reply", sa.Text(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("thread_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "message_id", name="uq_processed_email_per_tenant"),
    )
    op.create_index("ix_processed_emails_tenant_id", "processed_emails", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_processed_emails_tenant_id", table_name="processed_emails")
    op.drop_table("processed_emails")
    op.drop_index("ix_email_configs_tenant_id", table_name="email_configs")
    op.drop_table("email_configs")
