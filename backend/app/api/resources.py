from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps_auth import get_current_user, require_admin
from app.core.db import async_session_factory
from app.db.models import Resource, User

router = APIRouter(prefix="/api/resources", tags=["resources"])


class ResourceCreate(BaseModel):
    name: str
    capacity: int | None = None
    description: str | None = None


class ResourceUpdate(BaseModel):
    name: str | None = None
    capacity: int | None = None
    description: str | None = None
    is_active: bool | None = None


class ResourceOut(BaseModel):
    id: int
    name: str
    capacity: int | None
    description: str | None
    is_active: bool


@router.get("", response_model=list[ResourceOut])
async def list_resources(user: User = Depends(get_current_user)):
    if not user.tenant_id:
        return []
    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{user.tenant_id}'"))
        stmt = select(Resource).where(
            Resource.tenant_id == user.tenant_id,
            Resource.is_active == True,
        )
        result = await session.execute(stmt)
        resources = result.scalars().all()
    return [ResourceOut(id=r.id, name=r.name, capacity=r.capacity, description=r.description, is_active=r.is_active) for r in resources]


@router.get("/all", response_model=list[ResourceOut])
async def list_all_resources(user: User = Depends(require_admin)):
    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{user.tenant_id}'"))
        stmt = select(Resource).where(Resource.tenant_id == user.tenant_id)
        result = await session.execute(stmt)
        resources = result.scalars().all()
    return [ResourceOut(id=r.id, name=r.name, capacity=r.capacity, description=r.description, is_active=r.is_active) for r in resources]


@router.post("", response_model=ResourceOut)
async def create_resource(body: ResourceCreate, user: User = Depends(require_admin)):
    async with async_session_factory() as session:
        resource = Resource(
            tenant_id=user.tenant_id,
            name=body.name,
            capacity=body.capacity,
            description=body.description,
        )
        session.add(resource)
        await session.commit()
        await session.refresh(resource)
    return ResourceOut(id=resource.id, name=resource.name, capacity=resource.capacity, description=resource.description, is_active=resource.is_active)


@router.patch("/{resource_id}", response_model=ResourceOut)
async def update_resource(resource_id: int, body: ResourceUpdate, user: User = Depends(require_admin)):
    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{user.tenant_id}'"))
        stmt = select(Resource).where(Resource.id == resource_id, Resource.tenant_id == user.tenant_id)
        result = await session.execute(stmt)
        resource = result.scalar_one_or_none()
        if not resource:
            raise HTTPException(status_code=404, detail="Resource not found")
        if body.name is not None:
            resource.name = body.name
        if body.capacity is not None:
            resource.capacity = body.capacity
        if body.description is not None:
            resource.description = body.description
        if body.is_active is not None:
            resource.is_active = body.is_active
        await session.commit()
        await session.refresh(resource)
    return ResourceOut(id=resource.id, name=resource.name, capacity=resource.capacity, description=resource.description, is_active=resource.is_active)


@router.delete("/{resource_id}")
async def delete_resource(resource_id: int, user: User = Depends(require_admin)):
    async with async_session_factory() as session:
        await session.execute(text(f"SET app.current_tenant = '{user.tenant_id}'"))
        stmt = select(Resource).where(Resource.id == resource_id, Resource.tenant_id == user.tenant_id)
        result = await session.execute(stmt)
        resource = result.scalar_one_or_none()
        if not resource:
            raise HTTPException(status_code=404, detail="Resource not found")
        resource.is_active = False
        await session.commit()
    return {"ok": True}
