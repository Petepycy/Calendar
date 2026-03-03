"""Add tenants, users, resources tables and update bookings.

Revision ID: 002
Revises: 001
Create Date: 2026-02-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'member'); EXCEPTION WHEN duplicate_object THEN null; END $$")

    op.create_table(
        "tenants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("email", sa.String(320), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("picture_url", sa.String(1024), nullable=True),
        sa.Column("google_sub", sa.String(255), unique=True, nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=True, index=True),
        sa.Column("role", sa.String(10), nullable=False, server_default=sa.text("'member'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "resources",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("capacity", sa.Integer, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
    )

    op.add_column("bookings", sa.Column("user_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_bookings_user_id", "bookings", "users", ["user_id"], ["id"])
    op.create_foreign_key("fk_bookings_resource_id", "bookings", "resources", ["resource_id"], ["id"])

    op.execute(
        """
        CREATE POLICY tenant_isolation_resources ON resources
        USING (tenant_id::text = current_setting('app.current_tenant', true))
        """
    )
    op.execute("ALTER TABLE resources ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE resources DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_resources ON resources")

    op.drop_constraint("fk_bookings_resource_id", "bookings", type_="foreignkey")
    op.drop_constraint("fk_bookings_user_id", "bookings", type_="foreignkey")
    op.drop_column("bookings", "user_id")

    op.drop_table("resources")
    op.drop_table("users")
    op.drop_table("tenants")
    op.execute("DROP TYPE IF EXISTS user_role")
