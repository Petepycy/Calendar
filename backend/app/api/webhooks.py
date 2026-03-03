import logging
import uuid

from langchain_core.messages import HumanMessage
from langgraph.types import Command
from pyrogram import Client, filters
from pyrogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.db import async_session_factory
from app.db.models import Contact

logger = logging.getLogger(__name__)


def _build_confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Zatwierdź", callback_data="approve"),
                InlineKeyboardButton("Anuluj", callback_data="reject"),
            ]
        ]
    )


async def _upsert_contact(tenant_id: str, channel: str, channel_id: str, display_name: str | None) -> str:
    """Return the Contact UUID for this (tenant, channel, channel_id) triple, creating if needed."""
    async with async_session_factory() as session:
        stmt = select(Contact).where(
            Contact.tenant_id == tenant_id,
            Contact.channel == channel,
            Contact.channel_id == channel_id,
        )
        result = await session.execute(stmt)
        contact = result.scalar_one_or_none()

        if contact is None:
            contact = Contact(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                channel=channel,
                channel_id=channel_id,
                display_name=display_name,
            )
            session.add(contact)
            await session.commit()
            await session.refresh(contact)
            logger.info("New contact: %s/%s (%s)", channel, channel_id, display_name)
        elif display_name and contact.display_name != display_name:
            contact.display_name = display_name
            await session.commit()

    return str(contact.id)


def register_handlers(
    client: Client,
    graph,
    *,
    tenant_id: str | None,
    user_id: str | None,
) -> None:
    """Attach Pyrogram message/callback handlers that drive the LangGraph agent.

    tenant_id / user_id come from the owner's User record so that all Telegram
    conversations use the correct tenant's resources and business rules.
    Each Telegram sender gets their own conversation thread and Contact record.
    contact_id is passed to the graph so escalations are linked to the sender.
    """

    _tenant_id = tenant_id or "default"

    @client.on_message(filters.private & filters.text)
    async def handle_message(_cli: Client, message: Message) -> None:
        sender = message.from_user
        sender_tg_id = str(sender.id)
        text = message.text or ""

        display_name = (
            " ".join(filter(None, [sender.first_name, sender.last_name]))
            or sender.username
            or sender_tg_id
        )

        # Ensure a Contact record exists for this Telegram sender.
        contact_id: str | None = None
        if _tenant_id != "default":
            try:
                contact_id = await _upsert_contact(
                    tenant_id=_tenant_id,
                    channel="telegram",
                    channel_id=sender_tg_id,
                    display_name=display_name,
                )
            except Exception:
                logger.warning("Failed to upsert contact for sender %s", sender_tg_id, exc_info=True)

        # Per-sender thread keeps each conversation isolated;
        # tenant prefix ensures no cross-tenant state leakage.
        thread_id = f"{_tenant_id}:tg:{sender_tg_id}"
        config = {"configurable": {"thread_id": thread_id}}

        result = await graph.ainvoke(
            {
                "messages": [HumanMessage(content=text)],
                "tenant_id": _tenant_id,
                "user_id": user_id,
                "contact_id": contact_id,
            },
            config=config,
        )

        last_msg = result["messages"][-1]

        if result.get("review_status") == "pending":
            draft = result.get("booking_draft", {})
            summary = (
                f"Przygotowałem rezerwację:\n"
                f"  Zasób: {draft.get('resource_id')}\n"
                f"  Od: {draft.get('start')}\n"
                f"  Do: {draft.get('end')}\n\n"
                f"Czy potwierdzasz?"
            )
            await message.reply(summary, reply_markup=_build_confirm_keyboard())
        else:
            await message.reply(last_msg.content)

    @client.on_callback_query()
    async def handle_callback(_cli: Client, callback: CallbackQuery) -> None:
        sender_tg_id = str(callback.from_user.id)
        decision = callback.data  # "approve" or "reject"
        thread_id = f"{_tenant_id}:tg:{sender_tg_id}"
        config = {"configurable": {"thread_id": thread_id}}

        try:
            result = await graph.ainvoke(
                Command(resume=decision),
                config=config,
            )
            last_msg = result["messages"][-1]
            await callback.message.reply(last_msg.content)
        except Exception:
            logger.warning(
                "Stale or invalid callback from tg user %s, decision=%s",
                sender_tg_id,
                decision,
                exc_info=True,
            )
            await callback.message.reply(
                "Sesja wygasła. Rozpocznij nową rezerwację."
            )

        await callback.answer()
