"""Add contacts table and link escalations to contacts.

Revision ID: 006
Revises: 005
Create Date: 2026-03-02
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contacts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("channel_id", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "channel", "channel_id", name="uq_contact_per_channel"),
    )

    # Make escalations.user_id nullable (external-channel escalations have no User record)
    op.alter_column("escalations", "user_id", nullable=True)

    # Link escalations to contacts
    op.add_column(
        "escalations",
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("escalations", "contact_id")
    op.alter_column("escalations", "user_id", nullable=False)
    op.drop_table("contacts")
