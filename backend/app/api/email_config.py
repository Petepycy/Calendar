"""CRUD + test-connection + Gmail OAuth endpoints for per-tenant email config."""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps_auth import require_admin
from app.core.config import settings
from app.core.db import async_session_factory
from app.core.encryption import decrypt, encrypt
from app.db.models import EmailConfig, ProcessedEmail, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/email-config", tags=["email-config"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class EmailConfigIn(BaseModel):
    email_address: str
    imap_server: str = ""
    imap_port: int = 993
    smtp_server: str = ""
    smtp_port: int = 587
    password: str = ""  # plaintext — encrypted before DB write; empty for Gmail
    use_ssl: bool = True
    is_active: bool = False


class EmailConfigOut(BaseModel):
    id: str
    email_provider: str
    email_address: str
    imap_server: str | None
    imap_port: int
    smtp_server: str | None
    smtp_port: int
    use_ssl: bool
    is_active: bool
    last_checked_at: str | None
    last_error: str | None


class TestResult(BaseModel):
    imap_ok: bool
    smtp_ok: bool
    error: str | None = None


class ProcessedEmailOut(BaseModel):
    id: str
    from_address: str
    subject: str
    body_preview: str | None
    status: str
    ai_reply: str | None
    created_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config_to_out(cfg: EmailConfig) -> EmailConfigOut:
    return EmailConfigOut(
        id=str(cfg.id),
        email_provider=cfg.email_provider,
        email_address=cfg.email_address,
        imap_server=cfg.imap_server,
        imap_port=cfg.imap_port,
        smtp_server=cfg.smtp_server,
        smtp_port=cfg.smtp_port,
        use_ssl=cfg.use_ssl,
        is_active=cfg.is_active,
        last_checked_at=cfg.last_checked_at.isoformat() if cfg.last_checked_at else None,
        last_error=cfg.last_error,
    )


# ---------------------------------------------------------------------------
# IMAP/SMTP endpoints (existing)
# ---------------------------------------------------------------------------


@router.get("")
async def get_email_config(user: User = Depends(require_admin)):
    """Get this tenant's email config (or 404)."""
    if not user.tenant_id:
        raise HTTPException(status_code=404, detail="No tenant")

    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(EmailConfig.tenant_id == user.tenant_id)
            )
        ).scalar_one_or_none()

    if not cfg:
        raise HTTPException(status_code=404, detail="Email config not found")
    return _config_to_out(cfg)


@router.put("")
async def upsert_email_config(body: EmailConfigIn, user: User = Depends(require_admin)):
    """Create or update the tenant's IMAP/SMTP email config."""
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant")

    if not body.password:
        raise HTTPException(status_code=400, detail="Password is required for IMAP/SMTP")

    encrypted_pw = encrypt(body.password)

    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(EmailConfig.tenant_id == user.tenant_id)
            )
        ).scalar_one_or_none()

        if cfg:
            cfg.email_provider = "imap"
            cfg.email_address = body.email_address
            cfg.imap_server = body.imap_server
            cfg.imap_port = body.imap_port
            cfg.smtp_server = body.smtp_server
            cfg.smtp_port = body.smtp_port
            cfg.encrypted_password = encrypted_pw
            cfg.google_refresh_token = None
            cfg.use_ssl = body.use_ssl
            cfg.is_active = body.is_active
            cfg.last_error = None
        else:
            cfg = EmailConfig(
                tenant_id=user.tenant_id,
                email_provider="imap",
                email_address=body.email_address,
                imap_server=body.imap_server,
                imap_port=body.imap_port,
                smtp_server=body.smtp_server,
                smtp_port=body.smtp_port,
                encrypted_password=encrypted_pw,
                use_ssl=body.use_ssl,
                is_active=body.is_active,
            )
            session.add(cfg)

        await session.commit()
        await session.refresh(cfg)

    return _config_to_out(cfg)


@router.delete("")
async def delete_email_config(user: User = Depends(require_admin)):
    """Delete this tenant's email config."""
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant")

    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(EmailConfig.tenant_id == user.tenant_id)
            )
        ).scalar_one_or_none()

        if not cfg:
            raise HTTPException(status_code=404, detail="Email config not found")

        await session.delete(cfg)
        await session.commit()

    return {"ok": True}


@router.post("/test")
async def test_email_connection(body: EmailConfigIn, user: User = Depends(require_admin)):
    """Test IMAP + SMTP connection without saving."""
    from app.services.email_service import test_imap_connection, test_smtp_connection

    imap_ok, imap_err = await test_imap_connection(
        body.imap_server, body.imap_port, body.email_address, body.password, body.use_ssl
    )
    smtp_ok, smtp_err = await test_smtp_connection(
        body.smtp_server, body.smtp_port, body.email_address, body.password
    )

    error = None
    if not imap_ok:
        error = f"IMAP: {imap_err}"
    if not smtp_ok:
        error = (error + " | " if error else "") + f"SMTP: {smtp_err}"

    return TestResult(imap_ok=imap_ok, smtp_ok=smtp_ok, error=error)


# ---------------------------------------------------------------------------
# Gmail OAuth endpoints
# ---------------------------------------------------------------------------


@router.get("/gmail/auth")
async def gmail_oauth_start(user: User = Depends(require_admin)):
    """Start Gmail OAuth flow — returns the Google consent URL."""
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant")

    redirect_uri = f"{settings.base_url}/api/email-config/gmail/callback"
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": GMAIL_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": str(user.tenant_id),
    }
    url = f"{GOOGLE_AUTH_URL}?{'&'.join(f'{k}={v}' for k, v in params.items())}"
    return {"auth_url": url}


@router.get("/gmail/callback")
async def gmail_oauth_callback(code: str, state: str):
    """Exchange Gmail OAuth code for tokens and store config."""
    tenant_id = state
    redirect_uri = f"{settings.base_url}/api/email-config/gmail/callback"

    async with httpx.AsyncClient() as client:
        # Exchange code for tokens
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            logger.error("Gmail token exchange failed: %s", token_resp.text)
            return RedirectResponse(
                url=f"{settings.frontend_url}/app/settings?gmail=error",
                status_code=302,
            )
        tokens = token_resp.json()

        # Get user's email address
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        userinfo_resp.raise_for_status()
        email_address = userinfo_resp.json().get("email", "")

    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        logger.error("No refresh_token in Gmail OAuth response")
        return RedirectResponse(
            url=f"{settings.frontend_url}/app/settings?gmail=error",
            status_code=302,
        )

    encrypted_refresh = encrypt(refresh_token)

    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(EmailConfig.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()

        if cfg:
            cfg.email_provider = "gmail"
            cfg.email_address = email_address
            cfg.google_refresh_token = encrypted_refresh
            cfg.encrypted_password = None
            cfg.imap_server = None
            cfg.smtp_server = None
            cfg.last_error = None
        else:
            cfg = EmailConfig(
                tenant_id=tenant_id,
                email_provider="gmail",
                email_address=email_address,
                google_refresh_token=encrypted_refresh,
                is_active=False,
            )
            session.add(cfg)

        await session.commit()

    return RedirectResponse(
        url=f"{settings.frontend_url}/app/settings?gmail=connected",
        status_code=302,
    )


@router.post("/gmail/test")
async def test_gmail_connection_endpoint(user: User = Depends(require_admin)):
    """Test Gmail API access for this tenant's config."""
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant")

    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(
                    EmailConfig.tenant_id == user.tenant_id,
                    EmailConfig.email_provider == "gmail",
                )
            )
        ).scalar_one_or_none()

    if not cfg:
        raise HTTPException(status_code=404, detail="Gmail config not found")

    from app.services.gmail_service import test_gmail_connection
    ok, err = await test_gmail_connection(cfg)
    return {"ok": ok, "error": err}


class GmailToggle(BaseModel):
    is_active: bool


@router.patch("/gmail")
async def toggle_gmail_active(body: GmailToggle, user: User = Depends(require_admin)):
    """Toggle is_active on a Gmail config without touching credentials."""
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant")

    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(
                    EmailConfig.tenant_id == user.tenant_id,
                    EmailConfig.email_provider == "gmail",
                )
            )
        ).scalar_one_or_none()

        if not cfg:
            raise HTTPException(status_code=404, detail="Gmail config not found")

        cfg.is_active = body.is_active
        await session.commit()
        await session.refresh(cfg)

    return _config_to_out(cfg)


# ---------------------------------------------------------------------------
# Inbox (shared)
# ---------------------------------------------------------------------------


@router.get("/inbox")
async def list_processed_emails(
    user: User = Depends(require_admin),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List processed emails for this tenant (admin only, paginated)."""
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant")

    async with async_session_factory() as session:
        stmt = (
            select(ProcessedEmail)
            .where(ProcessedEmail.tenant_id == user.tenant_id)
            .order_by(ProcessedEmail.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        rows = (await session.execute(stmt)).scalars().all()

    return [
        ProcessedEmailOut(
            id=str(r.id),
            from_address=r.from_address,
            subject=r.subject,
            body_preview=r.body_preview,
            status=r.status,
            ai_reply=r.ai_reply,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]
