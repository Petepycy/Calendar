import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from jose import JWTError, jwt
from sqlalchemy import text

from app.api.deps_auth import get_current_user
from app.core.config import settings
from app.core.db import async_session_factory
from app.db.models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["calendar"])

CALENDAR_TOKEN_EXPIRE_DAYS = 365


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_calendar_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "type": "calendar",
        "exp": datetime.now(timezone.utc) + timedelta(days=CALENDAR_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _resolve_auth(request: Request, cal_token: str | None) -> tuple[str, str, str | None]:
    """Return (user_id, role, tenant_id) from cal_token or session cookie."""
    if cal_token:
        try:
            payload = jwt.decode(
                cal_token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
            )
            if payload.get("type") != "calendar":
                raise HTTPException(status_code=401, detail="Not a calendar token")
        except JWTError:
            raise HTTPException(status_code=401, detail="Invalid calendar token")
    else:
        token_cookie = request.cookies.get("access_token")
        if not token_cookie:
            raise HTTPException(status_code=401, detail="Authentication required")
        try:
            payload = jwt.decode(
                token_cookie, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
            )
        except JWTError:
            raise HTTPException(status_code=401, detail="Invalid token")

    return payload["sub"], payload.get("role", "member"), payload.get("tenant_id")


def _escape_ics(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _fmt_dt(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _build_ics(bookings: list[dict], cal_name: str = "CalendarAI") -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CalendarAI//PL",
        f"X-WR-CALNAME:{_escape_ics(cal_name)}",
        "X-WR-TIMEZONE:Europe/Warsaw",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    for b in bookings:
        start = datetime.fromisoformat(b["start"]) if isinstance(b["start"], str) else b["start"]
        end = datetime.fromisoformat(b["end"]) if isinstance(b["end"], str) else b["end"]
        resource_name = b.get("resource_name") or f"Zasób {b.get('resource_id', '?')}"
        lines += [
            "BEGIN:VEVENT",
            f"UID:booking-{b['id']}@calendarai",
            f"DTSTART:{_fmt_dt(start)}",
            f"DTEND:{_fmt_dt(end)}",
            f"SUMMARY:{_escape_ics(resource_name)}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/api/auth/calendar-token")
async def get_calendar_token(user: User = Depends(get_current_user)):
    """Issue a long-lived (1 year) calendar subscription token."""
    return {"cal_token": _create_calendar_token(user)}


@router.get("/api/calendar/ics")
async def get_calendar_ics(
    request: Request,
    cal_token: str | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
):
    """
    Return an iCalendar (.ics) feed for the authenticated user.

    Auth: `cal_token` query param (for webcal:// subscriptions) **or** session cookie
    (for in-browser downloads via the dashboard).

    * Admin → all tenant bookings.
    * Member → only their own bookings.

    `from` / `to` (ISO-8601 date, e.g. 2025-03-10) narrow the time window for
    one-time view-based downloads. Omit both for a full subscription feed.
    """
    user_id, role, tenant_id = _resolve_auth(request, cal_token)

    if not tenant_id:
        return Response(
            content=_build_ics([]),
            media_type="text/calendar; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=calendar.ics"},
        )

    try:
        from_dt = datetime.fromisoformat(from_date) if from_date else None
        to_dt = datetime.fromisoformat(to_date) if to_date else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")

    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{tenant_id}'"))

        where_parts: list[str] = []
        params: dict = {}

        if from_dt:
            where_parts.append("upper(b.during) > :from_dt")
            params["from_dt"] = from_dt
        if to_dt:
            where_parts.append("lower(b.during) < :to_dt")
            params["to_dt"] = to_dt
        if role != "admin":
            where_parts.append("b.user_id = :uid")
            params["uid"] = user_id

        where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT b.id, b.resource_id, r.name, b.user_id,
                           lower(b.during) AS start_time,
                           upper(b.during) AS end_time
                    FROM bookings b
                    LEFT JOIN resources r ON r.id = b.resource_id
                    {where_sql}
                    ORDER BY lower(b.during)
                    """
                ),
                params,
            )
        ).fetchall()

    bookings = [
        {
            "id": row[0],
            "resource_id": row[1],
            "resource_name": row[2] or f"Zasób {row[1]}",
            "user_id": str(row[3]) if row[3] else None,
            "start": row[4].isoformat(),
            "end": row[5].isoformat(),
        }
        for row in rows
    ]

    cal_name = (
        "CalendarAI – Wszystkie rezerwacje"
        if role == "admin"
        else "CalendarAI – Moje rezerwacje"
    )
    return Response(
        content=_build_ics(bookings, cal_name),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=calendar.ics"},
    )
