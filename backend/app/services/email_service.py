"""Per-tenant IMAP fetch + SMTP reply service for email inbox monitoring."""

import email
import logging
from email.header import decode_header
from email.mime.text import MIMEText

import aiosmtplib
from aioimaplib import IMAP4_SSL

from app.core.encryption import decrypt

logger = logging.getLogger(__name__)


def _decode_header_value(raw: str | None) -> str:
    if not raw:
        return ""
    parts = decode_header(raw)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return "".join(decoded)


def _extract_text_body(msg: email.message.Message) -> str:
    """Extract the plain-text body from an email message."""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
        # Fallback: try text/html
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    return payload.decode(charset, errors="replace")
        return ""
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")
        return ""


async def fetch_unread_emails(config) -> list[dict]:
    """Fetch unread emails via IMAP for the given EmailConfig.

    Returns list of dicts: {message_id, from_address, subject, body, in_reply_to}
    """
    password = decrypt(config.encrypted_password)
    results: list[dict] = []

    try:
        imap = IMAP4_SSL(host=config.imap_server, port=config.imap_port)
        await imap.wait_hello_from_server()
        await imap.login(config.email_address, password)
        await imap.select("INBOX")

        # Search for unseen messages
        response = await imap.search("UNSEEN")
        if response.result != "OK":
            logger.warning("IMAP search failed: %s", response)
            await imap.logout()
            return []

        # response.lines[0] contains the list of message UIDs
        uid_line = response.lines[0]
        if isinstance(uid_line, bytes):
            uid_line = uid_line.decode()
        uids = uid_line.strip().split()

        if not uids or uids == [""]:
            await imap.logout()
            return []

        for uid in uids:
            fetch_resp = await imap.fetch(uid, "(RFC822)")
            if fetch_resp.result != "OK":
                continue

            # Find the RFC822 data in the response lines
            raw_email = None
            for line in fetch_resp.lines:
                if isinstance(line, bytes) and len(line) > 100:
                    raw_email = line
                    break

            if not raw_email:
                continue

            msg = email.message_from_bytes(raw_email)
            message_id = msg.get("Message-ID", "").strip()
            from_address = _decode_header_value(msg.get("From", ""))
            subject = _decode_header_value(msg.get("Subject", ""))
            in_reply_to = msg.get("In-Reply-To", "").strip()
            body = _extract_text_body(msg)

            # Extract just the email address from "Name <email>" format
            if "<" in from_address and ">" in from_address:
                email_part = from_address.split("<")[-1].rstrip(">")
            else:
                email_part = from_address

            results.append({
                "message_id": message_id,
                "from_address": email_part.strip(),
                "from_display": from_address,
                "subject": subject,
                "body": body[:5000],  # limit body size
                "in_reply_to": in_reply_to or None,
            })

            # Mark as seen
            await imap.store(uid, "+FLAGS", r"\Seen")

        await imap.logout()
    except Exception:
        logger.error("IMAP fetch failed for %s", config.email_address, exc_info=True)
        raise

    return results


async def send_reply(
    config,
    to: str,
    subject: str,
    body: str,
    in_reply_to: str | None = None,
) -> None:
    """Send an email reply via SMTP using the tenant's email config."""
    password = decrypt(config.encrypted_password)

    # Ensure "Re: " prefix
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    msg = MIMEText(body, "plain", "utf-8")
    msg["From"] = config.email_address
    msg["To"] = to
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to

    await aiosmtplib.send(
        msg,
        hostname=config.smtp_server,
        port=config.smtp_port,
        username=config.email_address,
        password=password,
        start_tls=True,
    )
    logger.info("Email reply sent to %s: %s", to, subject)


async def test_imap_connection(
    imap_server: str, imap_port: int, email_address: str, password: str, use_ssl: bool = True
) -> tuple[bool, str | None]:
    """Test IMAP connection. Returns (success, error_message)."""
    try:
        imap = IMAP4_SSL(host=imap_server, port=imap_port)
        await imap.wait_hello_from_server()
        await imap.login(email_address, password)
        await imap.logout()
        return True, None
    except Exception as e:
        return False, str(e)


async def test_smtp_connection(
    smtp_server: str, smtp_port: int, email_address: str, password: str
) -> tuple[bool, str | None]:
    """Test SMTP connection. Returns (success, error_message)."""
    try:
        smtp = aiosmtplib.SMTP(hostname=smtp_server, port=smtp_port)
        await smtp.connect()
        await smtp.starttls()
        await smtp.login(email_address, password)
        await smtp.quit()
        return True, None
    except Exception as e:
        return False, str(e)
