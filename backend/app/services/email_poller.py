"""Background asyncio task that polls active EmailConfigs every N seconds."""

import asyncio
import hashlib
import logging
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage
from sqlalchemy import select

from app.core.db import async_session_factory
from app.db.models import EmailConfig, ProcessedEmail
from app.services.email_service import fetch_unread_emails

logger = logging.getLogger(__name__)


async def email_poller(graph, poll_interval: int = 120):
    """Run as asyncio.create_task — polls active EmailConfigs every N seconds."""
    logger.info("Email poller started (interval=%ds)", poll_interval)
    while True:
        await asyncio.sleep(poll_interval)
        try:
            await _poll_all_tenants(graph)
        except Exception:
            logger.error("Email poller iteration failed", exc_info=True)


async def _poll_all_tenants(graph):
    async with async_session_factory() as session:
        configs = (
            await session.execute(
                select(EmailConfig).where(EmailConfig.is_active == True)  # noqa: E712
            )
        ).scalars().all()

    if not configs:
        return

    for config in configs:
        try:
            await _process_tenant_emails(config, graph)
        except Exception:
            logger.warning(
                "Failed to process emails for tenant %s",
                config.tenant_id,
                exc_info=True,
            )
            # Update last_error on config
            try:
                async with async_session_factory() as session:
                    cfg = (
                        await session.execute(
                            select(EmailConfig).where(EmailConfig.id == config.id)
                        )
                    ).scalar_one_or_none()
                    if cfg:
                        cfg.last_error = "Polling failed — check server logs"
                        await session.commit()
            except Exception:
                pass


async def _process_tenant_emails(config: EmailConfig, graph):
    """Fetch unread emails for a tenant and process each through LangGraph."""
    if config.email_provider == "gmail":
        from app.services.gmail_service import fetch_unread_emails_gmail
        emails = await fetch_unread_emails_gmail(config)
    else:
        emails = await fetch_unread_emails(config)

    if not emails:
        # Update last_checked_at even when no new emails
        async with async_session_factory() as session:
            cfg = (
                await session.execute(
                    select(EmailConfig).where(EmailConfig.id == config.id)
                )
            ).scalar_one_or_none()
            if cfg:
                cfg.last_checked_at = datetime.now(timezone.utc)
                cfg.last_error = None
                await session.commit()
        return

    for mail in emails:
        message_id = mail["message_id"]
        if not message_id:
            continue

        # Check if already processed
        async with async_session_factory() as session:
            existing = (
                await session.execute(
                    select(ProcessedEmail).where(
                        ProcessedEmail.tenant_id == config.tenant_id,
                        ProcessedEmail.message_id == message_id,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                continue

        # Build LangGraph thread_id: deterministic per sender per tenant
        sender_hash = hashlib.sha256(
            mail["from_address"].lower().encode()
        ).hexdigest()[:16]
        thread_id = f"email-{config.tenant_id}-{sender_hash}"

        email_context = {
            "from_address": mail["from_address"],
            "subject": mail["subject"],
            "message_id": message_id,
            "config_id": str(config.id),
            "thread_id": mail.get("thread_id"),  # Gmail thread ID for proper threading
        }

        input_msg = (
            f"[Email od {mail['from_address']}]\n"
            f"Temat: {mail['subject']}\n\n"
            f"{mail['body']}"
        )

        status = "error"
        ai_reply = None
        error_detail = None

        try:
            result = await graph.ainvoke(
                {
                    "messages": [HumanMessage(content=input_msg)],
                    "tenant_id": str(config.tenant_id),
                    "user_id": None,
                    "user_role": "member",
                    "contact_id": None,
                    "is_anonymous": False,
                    "email_context": email_context,
                },
                config={"configurable": {"thread_id": thread_id}},
            )

            # Determine status from result
            esc_reason = result.get("escalation_reason")
            if esc_reason:
                status = "escalated"
            else:
                # Check if a reply was sent by looking at tool messages
                messages = result.get("messages", [])
                for msg in messages:
                    if hasattr(msg, "content") and "EMAIL REPLY SENT" in str(msg.content):
                        status = "replied"
                        break
                else:
                    # AI responded but didn't send an email — treat as replied (info response)
                    last_ai = None
                    for msg in reversed(messages):
                        if hasattr(msg, "type") and msg.type == "ai" and msg.content:
                            last_ai = msg.content
                            break
                    if last_ai:
                        ai_reply = last_ai
                        status = "replied"

        except Exception as exc:
            error_detail = str(exc)[:500]
            logger.error(
                "Graph invocation failed for email %s",
                message_id,
                exc_info=True,
            )

        # Record in processed_emails
        async with async_session_factory() as session:
            pe = ProcessedEmail(
                tenant_id=config.tenant_id,
                message_id=message_id,
                from_address=mail["from_address"],
                subject=mail["subject"][:1000],
                body_preview=mail["body"][:500] if mail["body"] else None,
                status=status,
                ai_reply=ai_reply,
                error_detail=error_detail,
                thread_id=thread_id,
            )
            session.add(pe)
            await session.commit()

    # Update last_checked_at
    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(EmailConfig.id == config.id)
            )
        ).scalar_one_or_none()
        if cfg:
            cfg.last_checked_at = datetime.now(timezone.utc)
            cfg.last_error = None
            await session.commit()

    logger.info(
        "Processed %d emails for tenant %s",
        len(emails),
        config.tenant_id,
    )
