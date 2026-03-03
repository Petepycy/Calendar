from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

MAX_DURATION_HOURS = 4
MIN_GAP_MINUTES = 15
WORK_HOUR_START = 8
WORK_HOUR_END = 20


@dataclass
class EscalationReason:
    code: str
    description: str


async def check_escalation_rules(
    draft: dict,
    tenant_id: str,
    session: AsyncSession,
) -> EscalationReason | None:
    start = datetime.fromisoformat(draft["start"])
    end = datetime.fromisoformat(draft["end"])
    resource_id = draft["resource_id"]

    duration = end - start
    if duration > timedelta(hours=MAX_DURATION_HOURS):
        return EscalationReason(
            code="too_long",
            description=f"Rezerwacja trwa {duration} (limit: {MAX_DURATION_HOURS}h). Wymaga zatwierdzenia admina.",
        )

    if start.hour < WORK_HOUR_START or end.hour > WORK_HOUR_END or (end.hour == WORK_HOUR_END and end.minute > 0):
        return EscalationReason(
            code="outside_hours",
            description=f"Rezerwacja wykracza poza godziny pracy ({WORK_HOUR_START}:00-{WORK_HOUR_END}:00). Wymaga zatwierdzenia admina.",
        )

    gap_check = text(
        """
        SELECT id, lower(during) AS s, upper(during) AS e
        FROM bookings
        WHERE resource_id = :resource_id
          AND (
            (upper(during) > :start - interval ':gap minutes' AND upper(during) <= :start)
            OR
            (lower(during) >= :end AND lower(during) < :end + interval ':gap minutes')
          )
        LIMIT 1
        """
    )
    stmt = text(
        """
        SELECT id FROM bookings
        WHERE resource_id = :resource_id
          AND (
            (upper(during) > :gap_before AND upper(during) <= :start)
            OR
            (lower(during) >= :end AND lower(during) < :gap_after)
          )
        LIMIT 1
        """
    )
    gap_before = start - timedelta(minutes=MIN_GAP_MINUTES)
    gap_after = end + timedelta(minutes=MIN_GAP_MINUTES)

    result = await session.execute(
        stmt,
        {
            "resource_id": resource_id,
            "start": start,
            "end": end,
            "gap_before": gap_before,
            "gap_after": gap_after,
        },
    )
    if result.fetchone():
        return EscalationReason(
            code="gap_too_short",
            description=f"Inna rezerwacja tego zasobu kończy się lub zaczyna mniej niż {MIN_GAP_MINUTES} min od planowanej. Wymaga zatwierdzenia admina.",
        )

    return None
