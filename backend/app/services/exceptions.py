class SlotUnavailableException(Exception):
    """Raised when a booking overlaps with an existing reservation."""

    def __init__(self, resource_id: int, start: str, end: str):
        self.resource_id = resource_id
        self.start = start
        self.end = end
        super().__init__(
            f"Resource {resource_id} is already booked between {start} and {end}"
        )
