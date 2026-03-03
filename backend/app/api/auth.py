import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from jose import jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps_auth import get_current_user
from app.core.config import settings
from app.core.db import async_session_factory
from app.db.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _create_jwt(user_id: str, email: str, role: str, tenant_id: str | None) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


@router.get("/google")
async def google_login():
    redirect_uri = f"{settings.base_url}/api/auth/google/callback"
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
    }
    url = f"{GOOGLE_AUTH_URL}?{'&'.join(f'{k}={v}' for k, v in params.items())}"
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(code: str):
    redirect_uri = f"{settings.base_url}/api/auth/google/callback"

    async with httpx.AsyncClient() as client:
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
        token_resp.raise_for_status()
        tokens = token_resp.json()

        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        userinfo_resp.raise_for_status()
        profile = userinfo_resp.json()

    google_sub = profile["sub"]
    email = profile["email"]
    name = profile.get("name", email)
    picture = profile.get("picture")

    async with async_session_factory() as session:
        stmt = select(User).where(User.google_sub == google_sub)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                email=email,
                name=name,
                picture_url=picture,
                google_sub=google_sub,
                role="member",
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            logger.info("New user created: %s (%s)", email, user.id)
        else:
            user.name = name
            user.picture_url = picture
            user.email = email
            await session.commit()
            await session.refresh(user)

    token = _create_jwt(str(user.id), user.email, user.role, user.tenant_id)

    response = RedirectResponse(
        url=f"{settings.frontend_url}/auth/callback",
        status_code=302,
    )
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=settings.jwt_expire_minutes * 60,
        path="/",
    )
    return response


def _user_response(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "picture_url": user.picture_url,
        "role": user.role,
        "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        "tenant_name": user.tenant.name if user.tenant else None,
        "telegram_chat_id": user.telegram_chat_id,
    }


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return _user_response(user)


class ProfileUpdate(BaseModel):
    telegram_chat_id: int | None = None


@router.patch("/me")
async def update_me(body: ProfileUpdate, user: User = Depends(get_current_user)):
    async with async_session_factory() as session:
        stmt = select(User).where(User.id == user.id)
        result = await session.execute(stmt)
        db_user = result.scalar_one()
        db_user.telegram_chat_id = body.telegram_chat_id
        await session.commit()
        await session.refresh(db_user)
    return _user_response(db_user)


@router.post("/logout")
async def logout():
    response = Response(status_code=200)
    response.delete_cookie("access_token", path="/")
    return response
