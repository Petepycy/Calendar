import logging
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import async_session_factory

logger = logging.getLogger(__name__)


async def get_db(tenant_id: str) -> AsyncGenerator[AsyncSession, None]:
    """Yield an async DB session with the tenant context set via RLS."""
    async with async_session_factory() as session:
        await session.execute(text("SET app.current_tenant = :tid"), {"tid": tenant_id})
        yield session
