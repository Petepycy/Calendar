from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps_auth import get_current_user
from app.core.db import async_session_factory
from app.db.models import KnowledgeEntry, User

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class KnowledgeEntryCreate(BaseModel):
    category: str
    question: str
    answer: str


class KnowledgeEntryUpdate(BaseModel):
    category: str
    question: str
    answer: str


class KnowledgeEntryOut(BaseModel):
    id: int
    category: str
    question: str
    answer: str


@router.get("", response_model=list[KnowledgeEntryOut])
async def list_entries(user: User = Depends(get_current_user)):
    if not user.tenant_id:
        return []
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntry).where(
            KnowledgeEntry.tenant_id == user.tenant_id
        ).order_by(KnowledgeEntry.created_at)
        result = await session.execute(stmt)
        entries = result.scalars().all()
    return [KnowledgeEntryOut(id=e.id, category=e.category, question=e.question, answer=e.answer) for e in entries]


@router.post("", response_model=KnowledgeEntryOut)
async def create_entry(body: KnowledgeEntryCreate, user: User = Depends(get_current_user)):
    if not user.tenant_id:
        raise HTTPException(status_code=400, detail="User has no tenant")
    async with async_session_factory() as session:
        entry = KnowledgeEntry(
            tenant_id=user.tenant_id,
            category=body.category,
            question=body.question,
            answer=body.answer,
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
    return KnowledgeEntryOut(id=entry.id, category=entry.category, question=entry.question, answer=entry.answer)


@router.patch("/{entry_id}", response_model=KnowledgeEntryOut)
async def update_entry(entry_id: int, body: KnowledgeEntryUpdate, user: User = Depends(get_current_user)):
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntry).where(
            KnowledgeEntry.id == entry_id,
            KnowledgeEntry.tenant_id == user.tenant_id,
        )
        result = await session.execute(stmt)
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        entry.category = body.category
        entry.question = body.question
        entry.answer = body.answer
        await session.commit()
        await session.refresh(entry)
    return KnowledgeEntryOut(id=entry.id, category=entry.category, question=entry.question, answer=entry.answer)


@router.delete("/{entry_id}")
async def delete_entry(entry_id: int, user: User = Depends(get_current_user)):
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntry).where(
            KnowledgeEntry.id == entry_id,
            KnowledgeEntry.tenant_id == user.tenant_id,
        )
        result = await session.execute(stmt)
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Entry not found")
        await session.delete(entry)
        await session.commit()
    return {"ok": True}
