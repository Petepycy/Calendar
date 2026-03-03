from datetime import datetime

from langchain_core.tools import tool
from pydantic import BaseModel, Field


class BookingRequest(BaseModel):
    resource_id: int = Field(description="ID of the resource to book")
    start: datetime = Field(description="Start of the booking (ISO 8601)")
    end: datetime = Field(description="End of the booking (ISO 8601)")


class AvailabilityRequest(BaseModel):
    resource_id: int = Field(description="ID of the resource (1=Sala A, 2=Sala B, 3=Sala C)")
    date: datetime = Field(description="The date to check availability for (ISO 8601)")


@tool(args_schema=BookingRequest)
def prepare_booking(resource_id: int, start: datetime, end: datetime) -> dict:
    """Prepare a booking draft for user confirmation.

    Call this when the user wants to reserve a resource for a specific time.
    Returns a draft that must be approved by the user before finalization.
    """
    return {
        "resource_id": resource_id,
        "start": start.isoformat(),
        "end": end.isoformat(),
    }


class EscalationRequest(BaseModel):
    reason: str = Field(description="Why this request needs human admin review")


@tool(args_schema=EscalationRequest)
def escalate_to_human(reason: str) -> str:
    """Escalate the current request to a human admin for review.

    Call this when the user's request is unusual, unclear, or requires human judgment.
    Examples: multi-day bookings, requests outside normal hours, special accommodations,
    user complaints, or anything you're unsure how to handle.
    """
    return reason


class CancelBookingRequest(BaseModel):
    booking_id: int = Field(description="ID of the booking to cancel")


@tool(args_schema=CancelBookingRequest)
def cancel_booking(booking_id: int) -> str:
    """Cancel (delete) an existing booking by its ID.

    Call this when the user wants to cancel or remove a reservation.
    The booking must belong to the current user (or the user must be an admin).
    Returns a confirmation or error message.
    """
    return f"Cancelling booking {booking_id}"


@tool(args_schema=AvailabilityRequest)
def check_availability(resource_id: int, date: datetime) -> str:
    """Check existing bookings for a specific room on a given date.

    Returns a list of occupied time slots so the user can pick a free one.
    Call this when the user asks about available/free time slots.
    """
    # Actual DB query is handled by conversation_node (async context).
    # This body is a fallback that never runs in practice.
    return f"Checking availability for resource {resource_id} on {date.isoformat()}"
