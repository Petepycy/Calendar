import logging
from email.mime.text import MIMEText

from app.core.config import settings
from app.db.models import Contact, Escalation, User

logger = logging.getLogger(__name__)


def _format_draft(draft: dict | None) -> str:
    if not draft:
        return "(brak draftu)"
    return f"Zasób: {draft.get('resource_id')}, Od: {draft.get('start')}, Do: {draft.get('end')}"


async def _send_email(to: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        logger.debug("SMTP not configured, skipping email to %s", to)
        return
    try:
        import aiosmtplib

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from or settings.smtp_user
        msg["To"] = to

        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user or None,
            password=settings.smtp_password or None,
            start_tls=True,
        )
        logger.info("Email sent to %s: %s", to, subject)
    except Exception:
        logger.warning("Failed to send email to %s", to, exc_info=True)


async def _send_telegram(chat_id: int, text: str) -> None:
    try:
        from app.services._tg_ref import get_tg_client
        tg = get_tg_client()
        if tg:
            await tg.send_message(chat_id, text)
            logger.info("Telegram message sent to chat %d", chat_id)
        else:
            logger.debug("Telegram client not available, skipping notification to chat %d", chat_id)
    except Exception:
        logger.warning("Failed to send Telegram message to chat %d", chat_id, exc_info=True)


async def _send_via_contact(contact: Contact, text: str) -> None:
    """Dispatch a message to an external contact using their channel."""
    if contact.channel == "telegram":
        await _send_telegram(int(contact.channel_id), text)
    elif contact.channel in ("whatsapp", "sms"):
        # Future integration point — phone number is in contact.channel_id (E.164)
        logger.info(
            "Channel '%s' not yet implemented. Message for %s: %s",
            contact.channel,
            contact.channel_id,
            text,
        )
    else:
        logger.warning("Unknown channel '%s' for contact %s", contact.channel, contact.id)


async def notify_admins_escalation(escalation: Escalation, admins: list[User]) -> None:
    draft_str = _format_draft(escalation.booking_draft)
    trigger = "regułę biznesową" if escalation.trigger_type == "rule" else "decyzję LLM"

    subject = f"[CalendarAI] Nowa eskalacja: {escalation.reason[:50]}"

    body_parts = [
        f"Nowa eskalacja wymaga Twojej decyzji.\n",
        f"Typ: {trigger}",
        f"Powód: {escalation.reason}",
        f"Rezerwacja: {draft_str}",
    ]
    if escalation.summary:
        body_parts.append(f"\nPodsumowanie AI:\n{escalation.summary}")

    # Show contact info when escalation came via external channel
    if escalation.contact:
        c = escalation.contact
        name = c.display_name or c.channel_id
        body_parts.append(f"\nKanał: {c.channel.capitalize()} ({name})")

    body_parts.append("\nZaloguj się do panelu admina, aby podjąć decyzję.")
    body = "\n".join(body_parts)

    for admin in admins:
        await _send_email(admin.email, subject, body)
        if admin.telegram_chat_id:
            await _send_telegram(admin.telegram_chat_id, f"📋 {subject}\n\n{body}")


async def notify_user_decision(escalation: Escalation, user: User) -> None:
    """Notify an authenticated web-chat user of an escalation decision via email/Telegram."""
    if escalation.status == "approved":
        subject = "[CalendarAI] Twoja rezerwacja została zatwierdzona"
        body = (
            f"Administrator zatwierdził Twoją rezerwację.\n"
            f"Rezerwacja: {_format_draft(escalation.booking_draft)}\n"
        )
    elif escalation.status == "modified":
        subject = "[CalendarAI] Administrator zaproponował zmianę terminu"
        body = (
            f"Administrator zaproponował modyfikację Twojej rezerwacji.\n"
            f"Oryginał: {_format_draft(escalation.booking_draft)}\n"
            f"Propozycja: {_format_draft(escalation.modified_draft)}\n"
            f"\nZaloguj się do czatu, aby zatwierdzić lub odrzucić propozycję."
        )
    else:
        subject = "[CalendarAI] Twoja rezerwacja została odrzucona"
        body = "Administrator odrzucił Twoją rezerwację.\n"

    if escalation.admin_comment:
        body += f"\nKomentarz admina: {escalation.admin_comment}\n"

    await _send_email(user.email, subject, body)
    if user.telegram_chat_id:
        await _send_telegram(user.telegram_chat_id, f"{subject}\n\n{body}")


async def notify_admin_cancellation(
    booking: dict,
    tenant_id: str,
    cancelled_by_name: str,
    resource_name: str | None = None,
) -> None:
    """Notify all admins of a tenant that a booking was cancelled."""
    from sqlalchemy import select as _select

    from app.core.db import async_session_factory as _factory
    from app.db.models import User as _User

    async with _factory() as session:
        result = await session.execute(
            _select(_User).where(
                _User.tenant_id == tenant_id,
                _User.role == "admin",
            )
        )
        admins = result.scalars().all()

    if not admins:
        return

    res_label = resource_name or f"Zasób {booking.get('resource_id')}"
    subject = "[CalendarAI] Rezerwacja anulowana"
    body = (
        f"Rezerwacja została anulowana.\n\n"
        f"Zasób: {res_label}\n"
        f"Od: {booking.get('start')}\n"
        f"Do: {booking.get('end')}\n"
        f"Anulował(a): {cancelled_by_name}\n"
    )

    for admin in admins:
        await _send_email(admin.email, subject, body)
        if admin.telegram_chat_id:
            await _send_telegram(
                admin.telegram_chat_id,
                f"🚫 {subject}\n\n{body}",
            )


async def notify_contact_decision(escalation: Escalation, contact: Contact) -> None:
    """Notify an external-channel contact (Telegram/WhatsApp/SMS) of an escalation decision."""
    if escalation.status == "approved":
        msg = (
            "✅ Twoja rezerwacja została zatwierdzona przez administratora.\n"
            f"Szczegóły: {_format_draft(escalation.booking_draft)}"
        )
        if escalation.admin_comment:
            msg += f"\nKomentarz: {escalation.admin_comment}"
    elif escalation.status == "modified":
        msg = (
            "🔄 Administrator zaproponował zmianę terminu Twojej rezerwacji.\n"
            f"Oryginał: {_format_draft(escalation.booking_draft)}\n"
            f"Propozycja: {_format_draft(escalation.modified_draft)}\n"
            "Wyślij dowolną wiadomość, aby zobaczyć szczegóły i zatwierdzić lub odrzucić."
        )
        if escalation.admin_comment:
            msg += f"\nKomentarz: {escalation.admin_comment}"
    else:
        msg = "❌ Twoja prośba o rezerwację została odrzucona przez administratora."
        if escalation.admin_comment:
            msg += f"\nKomentarz: {escalation.admin_comment}"

    await _send_via_contact(contact, msg)
