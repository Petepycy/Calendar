"""Global reference to the Pyrogram client for use outside FastAPI request context."""

_client = None


def set_tg_client(client):
    global _client
    _client = client


def get_tg_client():
    return _client
