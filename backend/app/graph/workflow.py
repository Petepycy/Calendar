from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph

from app.graph.nodes import (
    booking_node,
    check_rules_node,
    conversation_node,
    escalation_node,
    human_review_node,
)
from app.graph.state import AgentState


def _route_conversation(state: AgentState) -> str:
    if state.get("escalation_reason"):
        return "escalation"
    if state.get("booking_draft") and state.get("review_status") == "pending":
        return "check_rules"
    return END


def _route_rules(state: AgentState) -> str:
    if state.get("escalation_reason"):
        return "escalation"
    return "human_review"


def build_graph(checkpointer: AsyncPostgresSaver):
    workflow = StateGraph(AgentState)

    workflow.add_node("conversation", conversation_node)
    workflow.add_node("check_rules", check_rules_node)
    workflow.add_node("escalation", escalation_node)
    workflow.add_node("human_review", human_review_node)
    workflow.add_node("booking", booking_node)

    workflow.add_edge(START, "conversation")
    workflow.add_conditional_edges("conversation", _route_conversation)
    workflow.add_conditional_edges("check_rules", _route_rules)
    workflow.add_edge("escalation", END)
    workflow.add_edge("human_review", "booking")
    workflow.add_edge("booking", END)

    return workflow.compile(checkpointer=checkpointer)
