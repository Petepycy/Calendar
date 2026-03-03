from typing import Annotated, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    booking_draft: Optional[dict]
    review_status: Optional[str]  # 'pending', 'approved', 'rejected'
    tenant_id: str
    user_id: Optional[str]       # set for authenticated web-chat users
    user_role: Optional[str]     # "admin" | "member" — used for cancel_booking permission check
    contact_id: Optional[str]    # set for external-channel senders (Telegram, WhatsApp, SMS)
    is_anonymous: Optional[bool] # True for public-page visitors without a login
    requires_login: Optional[bool]  # set True by booking_node to signal frontend to show login CTA
    escalation_reason: Optional[str]
    escalation_trigger: Optional[str]  # "llm" | "rule"
    escalation_rule_code: Optional[str]  # e.g. "too_long", "gap_too_short", "outside_hours"
    escalation_id: Optional[str]
    confirmation_context: Optional[str]  # prefixed message shown on modified-draft confirmation
