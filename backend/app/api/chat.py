import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from langchain_core.messages import HumanMessage
from langgraph.types import Command
from pydantic import BaseModel
from sqlalchemy import select, text

from app.api.deps_auth import get_current_user
from app.core.db import async_session_factory
from app.db.models import Resource, Tenant, User
from app.services.booking import BookingService

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    thread_id: str | None = None


class ChatResponse(BaseModel):
    reply: str
    needs_confirmation: bool = False
    draft: dict | None = None
    requires_login: bool = False


class PublicChatRequest(BaseModel):
    message: str
    anonymous_id: str
    tenant_slug: str
    thread_id: str | None = None


class ConfirmRequest(BaseModel):
    thread_id: str | None = None
    decision: str  # "approve" | "reject"


class ConfirmResponse(BaseModel):
    reply: str


async def _resource_names(tenant_id) -> dict[int, str]:
    async with async_session_factory() as session:
        stmt = select(Resource).where(Resource.tenant_id == tenant_id, Resource.is_active == True)
        result = await session.execute(stmt)
        return {r.id: r.name for r in result.scalars().all()}


def _build_confirmation(
    draft: dict | None,
    resource_names: dict[int, str] | None = None,
    context: str | None = None,
) -> ChatResponse:
    rn = resource_names or {}
    if draft:
        name = rn.get(draft.get("resource_id"), f"Zasób {draft.get('resource_id')}")
        booking_lines = (
            f"  Sala: {name}\n"
            f"  Od: {draft.get('start')}\n"
            f"  Do: {draft.get('end')}\n\n"
            f"Czy potwierdzasz?"
        )
        if context:
            summary = f"{context}\n\n{booking_lines}"
        else:
            summary = f"Przygotowałem rezerwację:\n{booking_lines}"
    else:
        summary = context or "Czy potwierdzasz rezerwację?"
    return ChatResponse(reply=summary, needs_confirmation=True, draft=draft)


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, user: User = Depends(get_current_user)):
    graph = request.app.state.graph
    tenant_id = str(user.tenant_id) if user.tenant_id else "default"
    thread_id = body.thread_id or f"{tenant_id}:{user.id}"
    config = {"configurable": {"thread_id": thread_id}}

    try:
        result = await graph.ainvoke(
            {
                "messages": [HumanMessage(content=body.message)],
                "tenant_id": tenant_id,
                "user_id": str(user.id),
                "user_role": user.role,
            },
            config=config,
        )
    except Exception as exc:
        if "GraphInterrupt" in type(exc).__name__:
            state = await graph.aget_state(config)
            rn = await _resource_names(user.tenant_id) if user.tenant_id else {}
            return _build_confirmation(
                state.values.get("booking_draft"),
                rn,
                context=state.values.get("confirmation_context"),
            )
        raise

    state = await graph.aget_state(config)
    if state.next:
        rn = await _resource_names(user.tenant_id) if user.tenant_id else {}
        return _build_confirmation(
            state.values.get("booking_draft"),
            rn,
            context=state.values.get("confirmation_context"),
        )

    last_msg = result["messages"][-1]
    return ChatResponse(reply=last_msg.content)


@router.post("/chat/confirm", response_model=ConfirmResponse)
async def confirm(body: ConfirmRequest, request: Request, user: User = Depends(get_current_user)):
    graph = request.app.state.graph
    tenant_id = str(user.tenant_id) if user.tenant_id else "default"
    thread_id = body.thread_id or f"{tenant_id}:{user.id}"
    config = {"configurable": {"thread_id": thread_id}}

    try:
        result = await graph.ainvoke(
            Command(resume=body.decision),
            config=config,
        )
    except Exception as exc:
        if "GraphInterrupt" in type(exc).__name__:
            state = await graph.aget_state(config)
            last_msg = state.values.get("messages", [])[-1] if state.values.get("messages") else None
            return ConfirmResponse(reply=last_msg.content if last_msg else "Operacja zakończona.")

        logger.warning(
            "Stale or invalid confirm for thread %s, decision=%s",
            thread_id,
            body.decision,
            exc_info=True,
        )
        return ConfirmResponse(reply="Sesja wygasła. Rozpocznij nową rezerwację.")

    state = await graph.aget_state(config)
    if state.next:
        last_msg = state.values.get("messages", [])[-1] if state.values.get("messages") else None
        return ConfirmResponse(reply=last_msg.content if last_msg else "Operacja zakończona.")

    last_msg = result["messages"][-1]
    return ConfirmResponse(reply=last_msg.content)


@router.get("/bookings")
async def list_bookings(user: User = Depends(get_current_user)):
    if not user.tenant_id:
        return []

    resource_names = await _resource_names(user.tenant_id)
    my_id = str(user.id)

    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{user.tenant_id}'"))
        svc = BookingService(session)
        bookings = await svc.list_bookings()

    if user.role == "admin":
        for b in bookings:
            b["resourceName"] = resource_names.get(b["resource_id"], f"Zasób {b['resource_id']}")
        return bookings

    # Member: own bookings get full details, others become anonymous blocks
    result = []
    for b in bookings:
        is_mine = b.get("user_id") == my_id
        if is_mine:
            result.append({
                "id": b["id"],
                "resource_id": b["resource_id"],
                "resourceName": resource_names.get(b["resource_id"], f"Zasób {b['resource_id']}"),
                "start": b["start"],
                "end": b["end"],
                "is_mine": True,
            })
        else:
            result.append({
                "id": b["id"],
                "resource_id": b["resource_id"],
                "start": b["start"],
                "end": b["end"],
                "is_mine": False,
                "is_occupied": True,
            })
    return result


@router.delete("/bookings/{booking_id}", status_code=204)
async def cancel_booking(booking_id: int, user: User = Depends(get_current_user)):
    if not user.tenant_id:
        raise HTTPException(status_code=403, detail="No tenant")

    resource_names = await _resource_names(user.tenant_id)

    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{user.tenant_id}'"))
        svc = BookingService(session)

        # Fetch first to check ownership before deleting
        raw = await svc.list_bookings()
        booking = next((b for b in raw if b["id"] == booking_id), None)
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")

        if user.role != "admin" and booking.get("user_id") != str(user.id):
            raise HTTPException(status_code=403, detail="Not your booking")

        cancelled = await svc.cancel_booking(booking_id)

    if cancelled:
        from app.services.notifications import notify_admin_cancellation
        await notify_admin_cancellation(
            cancelled,
            str(user.tenant_id),
            user.name,
            resource_name=resource_names.get(cancelled["resource_id"]),
        )


@router.get("/bookings/public")
async def list_bookings_public(tenant_slug: str = Query(...)):
    """No-auth endpoint — returns anonymous busy blocks for a given tenant slug."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(Tenant).where(Tenant.slug == tenant_slug)
        )
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise HTTPException(status_code=404, detail="Company not found")

        await session.execute(text(f"SET app.current_tenant = '{tenant.id}'"))
        svc = BookingService(session)
        bookings = await svc.list_bookings()

    return [
        {"id": b["id"], "start": b["start"], "end": b["end"]}
        for b in bookings
    ]


@router.post("/chat/public", response_model=ChatResponse)
async def chat_public(body: PublicChatRequest, request: Request):
    """Public chat — no auth required. anonymous_id identifies the session."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(Tenant).where(Tenant.slug == body.tenant_slug)
        )
        tenant = result.scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Company not found")

    tenant_id = str(tenant.id)
    thread_id = body.thread_id or f"anon:{tenant_id}:{body.anonymous_id}"
    config = {"configurable": {"thread_id": thread_id}}
    graph = request.app.state.graph

    try:
        await graph.ainvoke(
            {
                "messages": [HumanMessage(content=body.message)],
                "tenant_id": tenant_id,
                "is_anonymous": True,
            },
            config=config,
        )
    except Exception as exc:
        if "GraphInterrupt" in type(exc).__name__:
            state = await graph.aget_state(config)
            rn = await _resource_names(tenant.id)
            resp = _build_confirmation(
                state.values.get("booking_draft"),
                rn,
                context=state.values.get("confirmation_context"),
            )
            return resp
        raise

    state = await graph.aget_state(config)
    requires_login = bool(state.values.get("requires_login"))

    if state.next:
        rn = await _resource_names(tenant.id)
        resp = _build_confirmation(
            state.values.get("booking_draft"),
            rn,
            context=state.values.get("confirmation_context"),
        )
        return ChatResponse(
            reply=resp.reply,
            needs_confirmation=resp.needs_confirmation,
            draft=resp.draft,
            requires_login=requires_login,
        )

    messages = state.values.get("messages", [])
    last_msg = messages[-1] if messages else None
    reply = last_msg.content if last_msg else ""
    return ChatResponse(reply=reply, requires_login=requires_login)
