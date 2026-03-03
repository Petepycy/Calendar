"""Create bookings table with ExcludeConstraint and RLS.

Revision ID: 001
Revises: None
Create Date: 2026-02-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TSTZRANGE

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "bookings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.String, nullable=False, index=True),
        sa.Column("resource_id", sa.Integer, nullable=False),
        sa.Column("during", TSTZRANGE(), nullable=False),
    )

    op.execute(
        """
        ALTER TABLE bookings
        ADD CONSTRAINT no_double_booking_constraint
        EXCLUDE USING gist (resource_id WITH =, during WITH &&)
        """
    )

    op.execute(
        """
        CREATE POLICY tenant_isolation_policy ON bookings
        USING (tenant_id = current_setting('app.current_tenant')::text)
        """
    )
    op.execute("ALTER TABLE bookings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE bookings DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy ON bookings")
    op.drop_table("bookings")
