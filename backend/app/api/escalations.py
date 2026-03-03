import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps_auth import get_current_user, require_admin
from app.core.db import async_session_factory
from app.db.models import Contact, Escalation, User
from app.services.booking import BookingService
from app.services.exceptions import SlotUnavailableException
from app.services.notifications import notify_contact_decision, notify_user_decision

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/escalations", tags=["escalations"])


class EscalationOut(BaseModel):
    id: str
    tenant_id: str
    user_id: str | None = None
    user_name: str | None = None
    user_email: str | None = None
    # External-channel contact info (Telegram, WhatsApp, SMS)
    contact_id: str | None = None
    contact_channel: str | None = None
    contact_channel_id: str | None = None
    contact_display_name: str | None = None
    status: str
    trigger_type: str
    rule_code: str | None
    reason: str
    summary: str | None
    booking_draft: dict | None
    admin_id: str | None
    admin_comment: str | None
    modified_draft: dict | None
    created_at: str
    decided_at: str | None


class EscalationDecision(BaseModel):
    decision: str  # "approved" | "rejected" | "modified"
    comment: str | None = None
    # Used when admin wants to provide/modify the booking draft.
    # For "approved" without an existing draft, supply this to create the booking.
    # For "modified", this becomes the proposed draft the user must confirm in chat.
    modified_draft: dict | None = None


def _to_out(e: Escalation) -> EscalationOut:
    return EscalationOut(
        id=str(e.id),
        tenant_id=str(e.tenant_id),
        user_id=str(e.user_id) if e.user_id else None,
        user_name=e.user.name if e.user else None,
        user_email=e.user.email if e.user else None,
        contact_id=str(e.contact_id) if e.contact_id else None,
        contact_channel=e.contact.channel if e.contact else None,
        contact_channel_id=e.contact.channel_id if e.contact else None,
        contact_display_name=e.contact.display_name if e.contact else None,
        status=e.status,
        trigger_type=e.trigger_type,
        rule_code=e.rule_code,
        reason=e.reason,
        summary=e.summary,
        booking_draft=e.booking_draft,
        admin_id=str(e.admin_id) if e.admin_id else None,
        admin_comment=e.admin_comment,
        modified_draft=e.modified_draft,
        created_at=e.created_at.isoformat() if e.created_at else "",
        decided_at=e.decided_at.isoformat() if e.decided_at else None,
    )


@router.get("", response_model=list[EscalationOut])
async def list_escalations(
    status: str | None = Query(None),
    user: User = Depends(require_admin),
):
    async with async_session_factory() as session:
        stmt = select(Escalation).where(Escalation.tenant_id == user.tenant_id)
        if status:
            stmt = stmt.where(Escalation.status == status)
        stmt = stmt.order_by(Escalation.created_at.desc())
        result = await session.execute(stmt)
        escalations = result.scalars().all()
    return [_to_out(e) for e in escalations]


@router.get("/pending-count")
async def pending_count(user: User = Depends(require_admin)):
    async with async_session_factory() as session:
        stmt = select(func.count()).select_from(Escalation).where(
            Escalation.tenant_id == user.tenant_id,
            Escalation.status == "pending",
        )
        result = await session.execute(stmt)
        count = result.scalar() or 0
    return {"count": count}


@router.get("/{escalation_id}", response_model=EscalationOut)
async def get_escalation(escalation_id: str, user: User = Depends(require_admin)):
    async with async_session_factory() as session:
        stmt = select(Escalation).where(
            Escalation.id == escalation_id,
            Escalation.tenant_id == user.tenant_id,
        )
        result = await session.execute(stmt)
        esc = result.scalar_one_or_none()
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return _to_out(esc)


@router.patch("/{escalation_id}", response_model=EscalationOut)
async def decide_escalation(
    escalation_id: str,
    body: EscalationDecision,
    user: User = Depends(require_admin),
):
    if body.decision not in ("approved", "rejected", "modified"):
        raise HTTPException(status_code=400, detail="Invalid decision")

    async with async_session_factory() as session:
        stmt = select(Escalation).where(
            Escalation.id == escalation_id,
            Escalation.tenant_id == user.tenant_id,
        )
        result = await session.execute(stmt)
        esc = result.scalar_one_or_none()
        if not esc:
            raise HTTPException(status_code=404, detail="Escalation not found")
        if esc.status != "pending":
            raise HTTPException(status_code=409, detail="Escalation already decided")

        esc.status = body.decision
        esc.admin_id = user.id
        esc.admin_comment = body.comment
        esc.decided_at = datetime.now(timezone.utc)
        esc.chat_notified = False  # user will be informed on next chat message

        if body.modified_draft:
            esc.modified_draft = body.modified_draft

        if body.decision == "approved":
            # Prefer existing booking_draft; fall back to admin-supplied modified_draft
            # (used when LLM escalated without a draft and admin fills in the details).
            booking_draft = esc.booking_draft or body.modified_draft
            if booking_draft:
                await session.execute(text(f"SET app.current_tenant = '{esc.tenant_id}'"))
                svc = BookingService(session)
                try:
                    booking_id = await svc.create_booking(
                        tenant_id=str(esc.tenant_id),
                        resource_id=booking_draft["resource_id"],
                        start=datetime.fromisoformat(booking_draft["start"]),
                        end=datetime.fromisoformat(booking_draft["end"]),
                    )
                    logger.info("Booking %d created from escalation %s", booking_id, escalation_id)
                    # Store the used draft for notification context
                    if not esc.booking_draft and body.modified_draft:
                        esc.booking_draft = body.modified_draft
                except SlotUnavailableException:
                    esc.status = "rejected"
                    esc.admin_comment = (body.comment or "") + " [Auto: termin już zajęty]"
            # If no draft at all, approval is recorded and user informed without a booking.

        # "modified": no booking created — user must accept the proposed draft in chat.

        await session.commit()
        await session.refresh(esc)

        esc_user_stmt = select(User).where(User.id == esc.user_id)
        esc_user_result = await session.execute(esc_user_stmt)
        esc_user = esc_user_result.scalar_one_or_none()

    if esc_user:
        try:
            await notify_user_decision(esc, esc_user)
        except Exception:
            logger.warning("Failed to notify user about escalation decision", exc_info=True)

    if esc.contact:
        try:
            await notify_contact_decision(esc, esc.contact)
            # Mark chat_notified so the conversation flow doesn't double-notify
            async with async_session_factory() as s2:
                row = (await s2.execute(select(Escalation).where(Escalation.id == esc.id))).scalar_one()
                row.chat_notified = True
                await s2.commit()
        except Exception:
            logger.warning("Failed to notify contact about escalation decision", exc_info=True)

    return _to_out(esc)
