import logging
import uuid as _uuid
from datetime import datetime

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.types import interrupt
from sqlalchemy import or_, select, text

from app.core.config import settings
from app.core.db import async_session_factory
from app.db.models import Contact, Escalation, KnowledgeEntry, Resource, User
from app.graph.state import AgentState
from app.services.booking import BookingService
from app.services.escalation_rules import check_escalation_rules
from app.services.exceptions import SlotUnavailableException
from app.services.tools import cancel_booking as cancel_booking_tool
from app.services.tools import check_availability, escalate_to_human, prepare_booking

logger = logging.getLogger(__name__)

DAYS_PL = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"]


async def _load_resources(tenant_id: str) -> list[Resource]:
    async with async_session_factory() as session:
        stmt = select(Resource).where(
            Resource.tenant_id == tenant_id,
            Resource.is_active == True,
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())


def _build_resource_list(resources: list[Resource]) -> str:
    if not resources:
        return "  (brak skonfigurowanych zasobów)"
    lines = []
    for r in resources:
        desc = r.name
        if r.capacity:
            desc += f" (do {r.capacity} osób)"
        if r.description:
            desc += f" – {r.description}"
        lines.append(f"  {r.id} -> {desc}")
    return "\n".join(lines)


async def _load_knowledge(tenant_id: str) -> list[KnowledgeEntry]:
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntry).where(
            KnowledgeEntry.tenant_id == tenant_id,
        ).order_by(KnowledgeEntry.category, KnowledgeEntry.id)
        result = await session.execute(stmt)
        return list(result.scalars().all())


def _build_knowledge_section(entries: list[KnowledgeEntry]) -> str:
    """Format knowledge entries for injection into the system prompt."""
    if not entries:
        return ""
    lines: list[str] = []
    current_cat: str | None = None
    for e in entries:
        if e.category != current_cat:
            current_cat = e.category
            lines.append(f"  [{e.category}]")
        lines.append(f"  P: {e.question}")
        lines.append(f"  O: {e.answer}")
    return "\n".join(lines)


def _system_prompt(
    resource_list_str: str,
    knowledge_str: str = "",
    is_anonymous: bool = False,
    is_external_channel: bool = False,
) -> SystemMessage:
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    day_name = DAYS_PL[now.weekday()]
    knowledge_block = (
        f"\nBAZA WIEDZY (używaj priorytetowo — nadpisuje domyślne informacje):\n"
        f"{knowledge_str}\n"
        if knowledge_str else ""
    )

    if is_anonymous:
        booking_note = (
            "8. Użytkownik NIE jest zalogowany. Możesz normalnie omawiać rezerwacje "
            "i ustalać szczegóły (sala, termin). Gdy użytkownik potwierdzi chęć rezerwacji "
            "wywołaj prepare_booking — system automatycznie poprosi o zalogowanie się przed "
            "finalizacją. NIE informuj samodzielnie o potrzebie logowania na etapie planowania.\n"
        )
    elif is_external_channel:
        booking_note = (
            "8. Użytkownik kontaktuje się przez kanał zewnętrzny (Telegram). "
            "Możesz ustalać szczegóły rezerwacji. Gdy użytkownik potwierdzi — "
            "wywołaj prepare_booking. Rezerwacja zostanie automatycznie przesłana "
            "do administratora do zatwierdzenia.\n"
        )
    else:
        booking_note = ""

    return SystemMessage(content=f"""\
Jesteś asystentem rezerwacji sal konferencyjnych. Odpowiadaj po polsku.
Strefa czasowa: Europe/Warsaw (UTC+1).

Dzisiejsza data: {today_str} ({day_name}).
Używaj tej daty przy interpretowaniu "dzisiaj", "jutro", "pojutrze" itp.

Dostępne zasoby (resource_id -> nazwa):
{resource_list_str}
{knowledge_block}
WAŻNE ZASADY:
1. ZAWSZE przed wywołaniem prepare_booking najpierw wywołaj check_availability \
dla danej sali i dnia, aby upewnić się, że termin jest wolny.
2. Jeśli termin jest zajęty, poinformuj użytkownika i zaproponuj wolne okna.
3. Gdy check_availability potwierdzi wolny termin i użytkownik już wyraził chęć \
rezerwacji — od razu wywołaj prepare_booking (NIE pytaj ponownie o potwierdzenie).
4. Zbierz od użytkownika: salę, datę i godziny (od-do).
5. Jeśli użytkownik nie podał wszystkich danych, zapytaj o brakujące.
6. Bądź uprzejmy i zwięzły.
7. Gdy użytkownik prosi o coś nietypowego (rezerwacja na kilka dni, specjalne wymagania, \
niezadowolenie, prośba o wyjątkowe traktowanie) — wywołaj escalate_to_human z opisem \
powodu eskalacji. NIE próbuj sam rozwiązywać takich sytuacji.
{booking_note}
Gdy widzisz wiadomość systemową "REZERWACJA ZAPISANA" — potwierdź użytkownikowi \
sukces i zapytaj czy potrzebuje czegoś jeszcze. NIE pytaj ponownie o rezerwację.
Gdy widzisz "REZERWACJA ANULOWANA" — potwierdź anulowanie.
""")


TOOLS = [prepare_booking, check_availability, escalate_to_human, cancel_booking_tool]

llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash",
    google_api_key=settings.google_api_key,
).bind_tools(TOOLS)

TOOL_DISPATCH = {t.name: t for t in TOOLS}


async def _run_tool(
    tool_call: dict,
    tenant_id: str = "default",
    user_id: str | None = None,
    user_role: str = "member",
) -> tuple[str, dict | None, str | None]:
    """Execute a tool call, returning (result_str, booking_draft_or_none, escalation_reason_or_none)."""
    name = tool_call["name"]
    args = tool_call["args"]

    if name == "escalate_to_human":
        reason = args.get("reason", "Brak powodu")
        return f"Eskalacja: {reason}", None, reason

    if name == "check_availability":
        resource_id = args["resource_id"]
        date = datetime.fromisoformat(args["date"]) if isinstance(args["date"], str) else args["date"]

        async with async_session_factory() as session:
            svc = BookingService(session)
            bookings = await svc.check_availability(resource_id, date)

        if not bookings:
            result = f"Brak rezerwacji na zasób {resource_id} w dniu {date.strftime('%Y-%m-%d')}. Wszystkie godziny 8:00-20:00 są wolne."
        else:
            occupied = ", ".join(f"{b['start']} – {b['end']}" for b in bookings)
            result = f"Zajęte terminy na zasób {resource_id} ({date.strftime('%Y-%m-%d')}): {occupied}. Pozostałe godziny 8:00-20:00 są wolne."
        return result, None, None

    if name == "prepare_booking":
        draft = prepare_booking.invoke(args)
        return str(draft), draft, None

    if name == "cancel_booking":
        booking_id = args["booking_id"]
        async with async_session_factory() as session:
            await session.execute(text(f"SET app.current_tenant = '{tenant_id}'"))
            svc = BookingService(session)
            raw = await svc.list_bookings()
            booking = next((b for b in raw if b["id"] == booking_id), None)

            if not booking:
                return "BŁĄD: Rezerwacja nie została znaleziona.", None, None

            if user_role != "admin" and booking.get("user_id") != user_id:
                return "BŁĄD: Nie możesz anulować cudzej rezerwacji.", None, None

            # Fetch resource name for notification
            from sqlalchemy import select as _sel
            from app.db.models import Resource as _Res
            res_result = await session.execute(
                _sel(_Res).where(_Res.id == booking["resource_id"])
            )
            resource = res_result.scalar_one_or_none()
            resource_name = resource.name if resource else None

            cancelled = await svc.cancel_booking(booking_id)

        if cancelled:
            from app.services.notifications import notify_admin_cancellation
            # Get user name for notification
            async with async_session_factory() as session:
                u_result = await session.execute(
                    select(User).where(User.id == user_id) if user_id else select(User).limit(0)
                )
                u = u_result.scalar_one_or_none()
                user_name = u.name if u else "Agent"
            await notify_admin_cancellation(cancelled, tenant_id, user_name, resource_name=resource_name)
            return f"REZERWACJA ANULOWANA: rezerwacja {booking_id} ({resource_name or ''}, {cancelled['start']} – {cancelled['end']}) została pomyślnie usunięta.", None, None

        return "BŁĄD: Nie udało się anulować rezerwacji.", None, None

    tool_fn = TOOL_DISPATCH.get(name)
    if tool_fn:
        res = tool_fn.invoke(args)
        return str(res), None, None
    return f"Unknown tool: {name}", None, None


async def _process_tool_calls(
    tool_calls,
    messages,
    tenant_id: str = "default",
    user_id: str | None = None,
    user_role: str = "member",
):
    """Process tool calls and return (new_messages, booking_draft, escalation_reason)."""
    new_messages = []
    booking_draft = None
    escalation_reason = None

    for tc in tool_calls:
        result_str, draft, esc_reason = await _run_tool(tc, tenant_id, user_id, user_role)
        new_messages.append(ToolMessage(content=result_str, tool_call_id=tc["id"]))
        if draft is not None:
            booking_draft = draft
        if esc_reason is not None:
            escalation_reason = esc_reason

    return new_messages, booking_draft, escalation_reason


async def _check_decided_escalations(
    user_id: str | None,
    tenant_id: str,
    contact_id: str | None = None,
) -> list[Escalation]:
    """Return decided-but-not-chat-notified escalations, marking them as notified.

    Matches escalations belonging to either the authenticated user (web chat)
    or the contact (external channel such as Telegram).
    """
    if not user_id and not contact_id:
        return []

    async with async_session_factory() as session:
        identity_filter = or_(
            *(
                ([Escalation.user_id == user_id] if user_id else [])
                + ([Escalation.contact_id == contact_id] if contact_id else [])
            )
        )
        stmt = (
            select(Escalation)
            .where(
                identity_filter,
                Escalation.tenant_id == tenant_id,
                Escalation.chat_notified == False,  # noqa: E712
                Escalation.status.in_(["approved", "rejected", "modified"]),
            )
            .order_by(Escalation.created_at)
        )
        result = await session.execute(stmt)
        escalations = list(result.scalars().all())

        for esc in escalations:
            esc.chat_notified = True
        await session.commit()

    return escalations


async def _generate_escalation_summary(
    state: AgentState,
    reason: str,
    trigger: str,
    rule_code: str | None,
    draft: dict | None,
    tenant_id: str,
) -> str:
    """Use LLM to generate a rich admin summary of the escalation."""
    # Collect recent chat context (up to last 10 human/AI messages)
    last_messages = list(state["messages"])[-10:]
    msg_lines = []
    for m in last_messages:
        if isinstance(m, HumanMessage) and m.content:
            msg_lines.append(f"Użytkownik: {m.content}")
        elif isinstance(m, AIMessage) and m.content:
            msg_lines.append(f"Agent: {m.content}")
    msg_context = "\n".join(msg_lines) or "(brak historii)"

    draft_str = "(brak draftu rezerwacji)"
    conflict_str = ""
    if draft:
        draft_str = (
            f"Zasób ID: {draft['resource_id']}, "
            f"Od: {draft['start']}, "
            f"Do: {draft['end']}"
        )

    # For gap_too_short violations, fetch the conflicting bookings so admin can see the context
    if rule_code == "gap_too_short" and draft:
        from datetime import timedelta

        start = datetime.fromisoformat(draft["start"])
        end = datetime.fromisoformat(draft["end"])
        gap_before = start - timedelta(minutes=15)
        gap_after = end + timedelta(minutes=15)
        try:
            async with async_session_factory() as session:
                await session.execute(text(f"SET app.current_tenant = '{tenant_id}'"))
                rows = await session.execute(
                    text(
                        """
                        SELECT id, lower(during) AS s, upper(during) AS e
                        FROM bookings
                        WHERE resource_id = :resource_id
                          AND (
                            (upper(during) > :gap_before AND upper(during) <= :start)
                            OR
                            (lower(during) >= :end AND lower(during) < :gap_after)
                          )
                        LIMIT 3
                        """
                    ),
                    {
                        "resource_id": draft["resource_id"],
                        "start": start,
                        "end": end,
                        "gap_before": gap_before,
                        "gap_after": gap_after,
                    },
                )
                conflicts = rows.fetchall()
            if conflicts:
                lines = [f"  - Rezerwacja ID {r[0]}: {r[1].isoformat()} – {r[2].isoformat()}" for r in conflicts]
                conflict_str = "Kolidujące rezerwacje (za mała przerwa):\n" + "\n".join(lines)
        except Exception:
            logger.warning("Could not fetch conflicting bookings for summary", exc_info=True)

    rule_label = {
        "too_long": "Rezerwacja przekracza maksymalny czas (4 h)",
        "outside_hours": "Rezerwacja poza godzinami pracy (8:00–20:00)",
        "gap_too_short": "Zbyt mała przerwa między rezerwacjami (min. 15 min)",
        "external_channel_booking": "Rezerwacja z kanału zewnętrznego (Telegram) — brak konta użytkownika",
    }.get(rule_code or "", rule_code or "")

    prompt = f"""Jesteś asystentem systemu rezerwacji. Przygotuj zwięzłe podsumowanie eskalacji dla administratora.

Typ eskalacji: {"Naruszenie reguły biznesowej" if trigger == "rule" else "Niestandardowa prośba użytkownika"}
{f"Naruszona reguła: {rule_label}" if rule_code else ""}
Powód zgłoszony przez system: {reason}

Planowana rezerwacja: {draft_str}
{conflict_str}

Ostatnie wiadomości w rozmowie:
{msg_context}

Napisz podsumowanie (3–5 zdań) dla administratora zawierające:
1. Co dokładnie chce zarezerwować użytkownik i dlaczego.
2. Jaki jest problem lub konflikt (jeśli dotyczy).
3. Co admin powinien rozważyć przy podejmowaniu decyzji.

Pisz po polsku, bez nagłówków Markdown, zwięźle i konkretnie."""

    summary_llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=settings.google_api_key,
    )
    try:
        response = await summary_llm.ainvoke([SystemMessage(content=prompt)])
        return response.content.strip()
    except Exception:
        logger.warning("Failed to generate escalation summary", exc_info=True)
        return reason


async def conversation_node(state: AgentState) -> dict:
    """Route user intent: chat freely or invoke tools.

    At the start checks for any decided escalations so the user is informed
    asynchronously (no polling required).
    """
    user_id = state.get("user_id")
    contact_id = state.get("contact_id")
    tenant_id = state.get("tenant_id", "default")
    is_anonymous = bool(state.get("is_anonymous"))
    is_external_channel = bool(contact_id and not user_id)

    # --- Check for decided escalations (async notification) ---
    if (user_id or contact_id) and tenant_id != "default":
        try:
            decided = await _check_decided_escalations(user_id, tenant_id, contact_id)
        except Exception:
            logger.warning("Failed to check decided escalations", exc_info=True)
            decided = []

        if decided:
            esc = decided[0]  # handle one per turn; others will surface on next message

            if esc.status == "modified" and esc.modified_draft:
                # Admin proposed changed terms — present to user for confirmation.
                # Return a draft so the graph routes to check_rules → human_review.
                comment_part = f"\nKomentarz admina: {esc.admin_comment}" if esc.admin_comment else ""
                context = (
                    f"Administrator rozpatrzył Twoją prośbę i zaproponował modyfikację rezerwacji."
                    f"{comment_part}\n"
                    f"Poniżej znajdziesz zmienione szczegóły — zatwierdź lub odrzuć propozycję."
                )
                return {
                    "booking_draft": esc.modified_draft,
                    "review_status": "pending",
                    "confirmation_context": context,
                    "escalation_id": None,
                    "escalation_reason": None,
                    "escalation_trigger": None,
                }

            # For approved/rejected: inject a system note so the LLM informs the user naturally.
            if esc.status == "approved":
                note = (
                    "DECYZJA ADMINA (approved): Administrator zatwierdził rezerwację użytkownika. "
                    + (f"Komentarz: {esc.admin_comment}. " if esc.admin_comment else "")
                    + "Poinformuj użytkownika o pozytywnej decyzji i zapytaj, czy potrzebuje czegoś jeszcze."
                )
            else:  # rejected
                note = (
                    "DECYZJA ADMINA (rejected): Administrator odrzucił rezerwację użytkownika. "
                    + (f"Komentarz: {esc.admin_comment}. " if esc.admin_comment else "")
                    + "Poinformuj użytkownika o odmowie i zaproponuj pomoc w znalezieniu alternatywy."
                )

            messages = list(state["messages"])
            resources = await _load_resources(tenant_id)
            resource_list_str = _build_resource_list(resources)
            knowledge = await _load_knowledge(tenant_id)
            knowledge_str = _build_knowledge_section(knowledge)
            messages = [
                _system_prompt(resource_list_str, knowledge_str, is_anonymous, is_external_channel),
                SystemMessage(content=note),
            ] + [m for m in messages if not isinstance(m, SystemMessage)]
            response = await llm.ainvoke(messages)
            return {"messages": [response], "escalation_id": None}

    # --- Normal conversation flow ---
    messages = list(state["messages"])

    resources = await _load_resources(tenant_id) if tenant_id != "default" else []
    resource_list_str = _build_resource_list(resources)
    knowledge = await _load_knowledge(tenant_id) if tenant_id != "default" else []
    knowledge_str = _build_knowledge_section(knowledge)

    has_system = any(isinstance(m, SystemMessage) for m in messages)
    if has_system:
        messages = [m for m in messages if not isinstance(m, SystemMessage)]
    messages = [_system_prompt(resource_list_str, knowledge_str, is_anonymous, is_external_channel)] + messages

    response = await llm.ainvoke(messages)

    user_role = state.get("user_role", "member")

    if response.tool_calls:
        all_new = [response]
        tool_msgs, booking_draft, escalation_reason = await _process_tool_calls(
            response.tool_calls, messages, tenant_id, user_id, user_role
        )
        all_new.extend(tool_msgs)

        if escalation_reason:
            return {
                "messages": all_new,
                "escalation_reason": escalation_reason,
                "escalation_trigger": "llm",
                "booking_draft": booking_draft,
            }

        if booking_draft:
            # External channel (Telegram etc.) — auto-escalate; no direct booking without a user account
            if is_external_channel:
                return {
                    "messages": all_new,
                    "booking_draft": booking_draft,
                    "escalation_reason": (
                        "Prośba o rezerwację z kanału zewnętrznego — wymaga zatwierdzenia admina"
                    ),
                    "escalation_trigger": "rule",
                    "escalation_rule_code": "external_channel_booking",
                }
            return {
                "messages": all_new,
                "booking_draft": booking_draft,
                "review_status": "pending",
            }

        follow_up = await llm.ainvoke(messages + all_new)
        all_new.append(follow_up)

        if follow_up.tool_calls:
            tool_msgs2, booking_draft2, esc_reason2 = await _process_tool_calls(
                follow_up.tool_calls, messages + all_new, tenant_id, user_id, user_role
            )
            all_new.extend(tool_msgs2)

            if esc_reason2:
                return {
                    "messages": all_new,
                    "escalation_reason": esc_reason2,
                    "escalation_trigger": "llm",
                    "booking_draft": booking_draft2,
                }

            if booking_draft2:
                if is_external_channel:
                    return {
                        "messages": all_new,
                        "booking_draft": booking_draft2,
                        "escalation_reason": (
                            "Prośba o rezerwację z kanału zewnętrznego — wymaga zatwierdzenia admina"
                        ),
                        "escalation_trigger": "rule",
                        "escalation_rule_code": "external_channel_booking",
                    }
                return {
                    "messages": all_new,
                    "booking_draft": booking_draft2,
                    "review_status": "pending",
                }

            final = await llm.ainvoke(messages + all_new)
            all_new.append(final)

        return {"messages": all_new}

    return {"messages": [response]}


async def check_rules_node(state: AgentState) -> dict:
    """Check business rules on the booking draft; escalate if violated."""
    draft = state.get("booking_draft")
    tenant_id = state.get("tenant_id", "default")

    if not draft:
        return {}

    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{tenant_id}'"))
        violation = await check_escalation_rules(draft, tenant_id, session)

    if violation:
        return {
            "escalation_reason": violation.description,
            "escalation_trigger": "rule",
            "escalation_rule_code": violation.code,
        }

    return {}


async def escalation_node(state: AgentState) -> dict:
    """Create an escalation record with an AI-generated summary, then notify admins."""
    tenant_id = state.get("tenant_id", "default")
    reason = state.get("escalation_reason", "Nieznany powód")
    trigger = state.get("escalation_trigger", "llm")
    draft = state.get("booking_draft")
    rule_code = state.get("escalation_rule_code")

    escalation_id = None
    user_id = state.get("user_id")
    contact_id = state.get("contact_id")

    if tenant_id != "default":
        # Generate AI summary before writing to DB so it's available for notifications
        summary = await _generate_escalation_summary(
            state=state,
            reason=reason,
            trigger=trigger,
            rule_code=rule_code,
            draft=draft,
            tenant_id=tenant_id,
        )

        async with async_session_factory() as session:
            admins = (await session.execute(
                select(User).where(User.tenant_id == tenant_id, User.role == "admin")
            )).scalars().all()

            esc = Escalation(
                tenant_id=tenant_id,
                user_id=_uuid.UUID(user_id) if user_id else None,
                contact_id=_uuid.UUID(contact_id) if contact_id else None,
                trigger_type=trigger,
                rule_code=rule_code,
                reason=reason,
                booking_draft=draft,
                summary=summary,
                status="pending",
                # For external-channel escalations: notification delivered via channel push.
                # For web-chat escalations: user is informed on next chat message.
                chat_notified=bool(contact_id),
            )
            session.add(esc)
            await session.commit()
            await session.refresh(esc)
            escalation_id = str(esc.id)
            logger.info("Escalation %s created (trigger=%s): %s", escalation_id, trigger, reason)

            try:
                from app.services.notifications import notify_admins_escalation
                await notify_admins_escalation(esc, admins)
            except Exception:
                logger.warning("Failed to send escalation notifications", exc_info=True)

    msg = AIMessage(
        content=(
            "Twoje zapytanie zostało przekazane do administratora. "
            "Odpowiem, gdy admin podejmie decyzję — wystarczy, że napiszesz wiadomość. "
            "W międzyczasie mogę pomóc w czymś innym."
        )
    )

    return {
        "messages": [msg],
        "escalation_id": escalation_id,
        "escalation_reason": None,
        "escalation_trigger": None,
        "escalation_rule_code": None,
        "booking_draft": None,
        "review_status": None,
    }


async def human_review_node(state: AgentState) -> dict:
    """Present booking summary and suspend execution until user decides."""
    draft = state["booking_draft"]
    summary = (
        f"Przygotowałem rezerwację:\n"
        f"  Zasób: {draft['resource_id']}\n"
        f"  Od: {draft['start']}\n"
        f"  Do: {draft['end']}\n\n"
        f"Czy potwierdzasz? (approve / reject)"
    )

    decision = interrupt({"summary": summary})

    return {"review_status": decision}


async def booking_node(state: AgentState) -> dict:
    """Execute or cancel the booking based on the user's decision."""
    decision = state.get("review_status", "rejected")
    draft = state.get("booking_draft")
    tenant_id = state.get("tenant_id", "default")

    # Anonymous users cannot finalise a booking — signal frontend to show login CTA
    if state.get("is_anonymous") and decision in ("approved", "approve") and draft:
        msg = AIMessage(
            content=(
                "Świetnie! Zebrałem wszystkie szczegóły. "
                "Aby sfinalizować rezerwację, musisz się zalogować. "
                "Po zalogowaniu Twoja rezerwacja zostanie natychmiast potwierdzona."
            )
        )
        return {
            "messages": [msg],
            "requires_login": True,
            "booking_draft": draft,   # keep draft for after login
            "review_status": None,
        }

    resources = await _load_resources(tenant_id) if tenant_id != "default" else []
    resource_names = {r.id: r.name for r in resources}

    if decision in ("approved", "approve") and draft:
        async with async_session_factory() as session:
            tenant_id = state["tenant_id"]
            await session.execute(
                text(f"SET app.current_tenant = '{tenant_id}'")
            )

            svc = BookingService(session)
            try:
                booking_id = await svc.create_booking(
                    tenant_id=state["tenant_id"],
                    resource_id=draft["resource_id"],
                    start=datetime.fromisoformat(draft["start"]),
                    end=datetime.fromisoformat(draft["end"]),
                )
                room = resource_names.get(draft["resource_id"], f"Zasób {draft['resource_id']}")
                msg = AIMessage(
                    content=(
                        f"Rezerwacja potwierdzona (ID: {booking_id}).\n"
                        f"{room}, {draft['start']} – {draft['end']}.\n"
                        f"Czy mogę pomóc w czymś jeszcze?"
                    )
                )
            except SlotUnavailableException:
                msg = AIMessage(
                    content="Niestety wybrany termin jest już zajęty. Chcesz spróbować inny termin?"
                )
    else:
        msg = AIMessage(content="Rezerwacja anulowana. Czy mogę pomóc w czymś innym?")

    return {
        "messages": [msg],
        "booking_draft": None,
        "review_status": None,
        "confirmation_context": None,
    }
