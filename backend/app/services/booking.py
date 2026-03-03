import logging
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.exceptions import SlotUnavailableException

logger = logging.getLogger(__name__)


class BookingService:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def create_booking(
        self,
        tenant_id: str,
        resource_id: int,
        start: datetime,
        end: datetime,
    ) -> int:
        """Insert a booking row; raises SlotUnavailableException on overlap."""
        stmt = text(
            """
            INSERT INTO bookings (tenant_id, resource_id, during)
            VALUES (:tenant_id, :resource_id, tstzrange(:start, :end, '[)'))
            RETURNING id
            """
        )
        try:
            result = await self._session.execute(
                stmt,
                {
                    "tenant_id": tenant_id,
                    "resource_id": resource_id,
                    "start": start,
                    "end": end,
                },
            )
            await self._session.commit()
            row = result.fetchone()
            assert row is not None
            booking_id: int = row[0]
            logger.info(
                "Booking %d created for resource %d [%s, %s)",
                booking_id, resource_id, start, end,
            )
            return booking_id
        except IntegrityError as exc:
            await self._session.rollback()
            if "no_double_booking_constraint" in str(exc.orig):
                raise SlotUnavailableException(
                    resource_id, start.isoformat(), end.isoformat()
                ) from exc
            raise

    async def list_bookings(self) -> list[dict]:
        """Return all bookings for the current tenant."""
        stmt = text(
            """
            SELECT id, tenant_id, resource_id, user_id,
                   lower(during) AS start_time,
                   upper(during) AS end_time
            FROM bookings
            ORDER BY lower(during)
            """
        )
        result = await self._session.execute(stmt)
        return [
            {
                "id": row[0],
                "tenant_id": row[1],
                "resource_id": row[2],
                "user_id": str(row[3]) if row[3] else None,
                "start": row[4].isoformat(),
                "end": row[5].isoformat(),
            }
            for row in result.fetchall()
        ]

    async def cancel_booking(self, booking_id: int) -> dict | None:
        """Delete a booking by id (tenant already set via RLS). Returns booking data or None."""
        fetch_stmt = text(
            """
            SELECT id, tenant_id, resource_id, user_id,
                   lower(during) AS start_time,
                   upper(during) AS end_time
            FROM bookings
            WHERE id = :booking_id
            """
        )
        row = (
            await self._session.execute(fetch_stmt, {"booking_id": booking_id})
        ).fetchone()
        if not row:
            return None

        await self._session.execute(
            text("DELETE FROM bookings WHERE id = :booking_id"),
            {"booking_id": booking_id},
        )
        await self._session.commit()
        logger.info("Booking %d cancelled", booking_id)
        return {
            "id": row[0],
            "tenant_id": row[1],
            "resource_id": row[2],
            "user_id": str(row[3]) if row[3] else None,
            "start": row[4].isoformat(),
            "end": row[5].isoformat(),
        }

    async def check_availability(
        self,
        resource_id: int,
        date: datetime,
    ) -> list[dict]:
        """Return existing bookings for a resource on a given date."""
        stmt = text(
            """
            SELECT id, resource_id,
                   lower(during) AS start_time,
                   upper(during) AS end_time
            FROM bookings
            WHERE resource_id = :resource_id
              AND during && tstzrange(:day_start, :day_end, '[)')
            ORDER BY lower(during)
            """
        )
        day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = date.replace(hour=23, minute=59, second=59, microsecond=0)
        result = await self._session.execute(
            stmt,
            {"resource_id": resource_id, "day_start": day_start, "day_end": day_end},
        )
        return [
            {
                "id": row[0],
                "resource_id": row[1],
                "start": row[2].isoformat(),
                "end": row[3].isoformat(),
            }
            for row in result.fetchall()
        ]
