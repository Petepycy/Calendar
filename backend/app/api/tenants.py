import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps_auth import get_current_user
from app.core.db import async_session_factory
from app.db.models import Resource, Tenant, User

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


class TenantCreate(BaseModel):
    name: str
    first_resource_name: str = "Sala A"


class TenantOut(BaseModel):
    id: str
    name: str
    slug: str


class TenantJoin(BaseModel):
    slug: str


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


@router.get("/list", response_model=list[TenantOut])
async def list_tenants():
    """Public — returns all tenants so users can pick one to join."""
    async with async_session_factory() as session:
        result = await session.execute(select(Tenant).order_by(Tenant.name))
        tenants = result.scalars().all()
    return [TenantOut(id=str(t.id), name=t.name, slug=t.slug) for t in tenants]


@router.post("/join", response_model=TenantOut)
async def join_tenant(body: TenantJoin, user: User = Depends(get_current_user)):
    """Authenticated user joins an existing tenant as a member."""
    if user.tenant_id:
        raise HTTPException(status_code=400, detail="User already belongs to a tenant")

    async with async_session_factory() as session:
        result = await session.execute(select(Tenant).where(Tenant.slug == body.slug))
        tenant = result.scalar_one_or_none()
        if not tenant:
            raise HTTPException(status_code=404, detail="Nie znaleziono firmy o tym slug-u")

        user_result = await session.execute(select(User).where(User.id == user.id))
        db_user = user_result.scalar_one()
        db_user.tenant_id = tenant.id
        db_user.role = "member"

        await session.commit()
        await session.refresh(tenant)

    return TenantOut(id=str(tenant.id), name=tenant.name, slug=tenant.slug)


@router.post("", response_model=TenantOut)
async def create_tenant(body: TenantCreate, user: User = Depends(get_current_user)):
    if user.tenant_id:
        raise HTTPException(status_code=400, detail="User already belongs to a tenant")

    slug = _slugify(body.name)

    async with async_session_factory() as session:
        existing = await session.execute(select(Tenant).where(Tenant.slug == slug))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Company with this name already exists")

        tenant = Tenant(name=body.name, slug=slug)
        session.add(tenant)
        await session.flush()

        resource = Resource(tenant_id=tenant.id, name=body.first_resource_name)
        session.add(resource)

        stmt = select(User).where(User.id == user.id)
        result = await session.execute(stmt)
        db_user = result.scalar_one()
        db_user.tenant_id = tenant.id
        db_user.role = "admin"

        await session.commit()
        await session.refresh(tenant)

    return TenantOut(id=str(tenant.id), name=tenant.name, slug=tenant.slug)
