"""CRUD + test-connection endpoints for per-tenant email (IMAP/SMTP) config."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps_auth import require_admin
from app.core.db import async_session_factory
from app.core.encryption import decrypt, encrypt
from app.db.models import EmailConfig, ProcessedEmail, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/email-config", tags=["email-config"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class EmailConfigIn(BaseModel):
    email_address: str
    imap_server: str
    imap_port: int = 993
    smtp_server: str
    smtp_port: int = 587
    password: str  # plaintext — encrypted before DB write
    use_ssl: bool = True
    is_active: bool = False


class EmailConfigOut(BaseModel):
    id: str
    email_address: str
    imap_server: str
    imap_port: int
    smtp_server: str
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
# Endpoints
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
    """Create or update the tenant's email config."""
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="No tenant")

    encrypted_pw = encrypt(body.password)

    async with async_session_factory() as session:
        cfg = (
            await session.execute(
                select(EmailConfig).where(EmailConfig.tenant_id == user.tenant_id)
            )
        ).scalar_one_or_none()

        if cfg:
            cfg.email_address = body.email_address
            cfg.imap_server = body.imap_server
            cfg.imap_port = body.imap_port
            cfg.smtp_server = body.smtp_server
            cfg.smtp_port = body.smtp_port
            cfg.encrypted_password = encrypted_pw
            cfg.use_ssl = body.use_ssl
            cfg.is_active = body.is_active
            cfg.last_error = None
        else:
            cfg = EmailConfig(
                tenant_id=user.tenant_id,
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
