"""Gmail API service — fetch unread + send replies using OAuth2 refresh tokens."""

import base64
import logging
from email.mime.text import MIMEText

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.core.config import settings
from app.core.encryption import decrypt

logger = logging.getLogger(__name__)

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]


def _get_gmail_service(config):
    """Build an authorized Gmail API service from an EmailConfig with encrypted refresh_token."""
    refresh_token = decrypt(config.google_refresh_token)
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        scopes=GMAIL_SCOPES,
    )
    creds.refresh(GoogleAuthRequest())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


async def fetch_unread_emails_gmail(config) -> list[dict]:
    """Fetch unread emails via Gmail API.

    Returns list of dicts matching the IMAP interface:
    {message_id, from_address, from_display, subject, body, in_reply_to}
    """
    try:
        service = _get_gmail_service(config)
        results = service.users().messages().list(
            userId="me", q="is:unread", maxResults=20,
        ).execute()

        messages = results.get("messages", [])
        if not messages:
            return []

        emails: list[dict] = []
        for msg_stub in messages:
            msg = service.users().messages().get(
                userId="me", id=msg_stub["id"], format="full",
            ).execute()

            headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
            message_id = headers.get("message-id", "").strip()
            from_raw = headers.get("from", "")
            subject = headers.get("subject", "")
            in_reply_to = headers.get("in-reply-to", "").strip() or None

            # Extract email address from "Name <email>" format
            if "<" in from_raw and ">" in from_raw:
                email_part = from_raw.split("<")[-1].rstrip(">")
            else:
                email_part = from_raw

            body = _extract_body(msg.get("payload", {}))

            emails.append({
                "message_id": message_id,
                "from_address": email_part.strip(),
                "from_display": from_raw,
                "subject": subject,
                "body": body[:5000],
                "in_reply_to": in_reply_to,
                "gmail_id": msg_stub["id"],
                "thread_id": msg.get("threadId"),
            })

            # Mark as read
            service.users().messages().modify(
                userId="me", id=msg_stub["id"],
                body={"removeLabelIds": ["UNREAD"]},
            ).execute()

        return emails

    except Exception:
        logger.error("Gmail API fetch failed for %s", config.email_address, exc_info=True)
        raise


async def send_reply_gmail(
    config,
    to: str,
    subject: str,
    body: str,
    in_reply_to: str | None = None,
    thread_id: str | None = None,
) -> None:
    """Send an email reply via Gmail API with proper threading."""
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    msg = MIMEText(body, "plain", "utf-8")
    msg["From"] = config.email_address
    msg["To"] = to
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
    send_body: dict = {"raw": raw}
    if thread_id:
        send_body["threadId"] = thread_id

    service = _get_gmail_service(config)
    service.users().messages().send(userId="me", body=send_body).execute()
    logger.info("Gmail reply sent to %s: %s", to, subject)


async def test_gmail_connection(config) -> tuple[bool, str | None]:
    """Test Gmail API access by listing 1 message. Returns (success, error_message)."""
    try:
        service = _get_gmail_service(config)
        service.users().messages().list(userId="me", maxResults=1).execute()
        return True, None
    except Exception as e:
        return False, str(e)


def _extract_body(payload: dict) -> str:
    """Recursively extract plain-text body from Gmail API message payload."""
    mime_type = payload.get("mimeType", "")

    if mime_type == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
        return ""

    parts = payload.get("parts", [])
    # Prefer text/plain
    for part in parts:
        if part.get("mimeType") == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

    # Fallback: text/html
    for part in parts:
        if part.get("mimeType") == "text/html":
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

    # Recurse into multipart
    for part in parts:
        result = _extract_body(part)
        if result:
            return result

    return ""
