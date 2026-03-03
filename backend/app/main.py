import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pyrogram import Client

from sqlalchemy import select

from app.api.auth import router as auth_router
from app.api.calendar_ics import router as calendar_ics_router
from app.api.chat import router as chat_router
from app.api.escalations import router as escalations_router
from app.api.knowledge import router as knowledge_router
from app.api.resources import router as resources_router
from app.api.tenants import router as tenants_router
from app.api.webhooks import register_handlers
from app.services._tg_ref import set_tg_client
from app.core.config import settings
from app.core.db import async_session_factory, close_pool, get_pool
from app.db.models import User
from app.graph.workflow import build_graph

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    pool = await get_pool()

    async with AsyncPostgresSaver.from_conn_string(
        settings.psycopg_conninfo
    ) as checkpointer:
        await checkpointer.setup()
        logger.info("LangGraph checkpointer tables initialised")

        graph = build_graph(checkpointer)
        app.state.graph = graph

        tg = None
        if settings.telegram_api_id and settings.telegram_api_hash and settings.telegram_phone:
            try:
                # Use absolute path so the session file is found regardless of CWD
                # (uvicorn --reload may run workers from a different directory)
                _session = os.path.join(
                    os.path.dirname(os.path.abspath(__file__)), "..", "calendar_agent"
                )
                tg = Client(
                    os.path.abspath(_session),
                    api_id=settings.telegram_api_id,
                    api_hash=settings.telegram_api_hash,
                    phone_number=settings.telegram_phone,
                )
                await tg.start()
                set_tg_client(tg)
                logger.info("Pyrogram client started for %s", settings.telegram_phone)

                # Identify the owner's User record so Telegram conversations
                # use the correct tenant and user context.
                me = await tg.get_me()
                owner_tg_id = me.id
                owner_tenant_id: str | None = None
                owner_user_id: str | None = None

                async with async_session_factory() as session:
                    # 1. Try to find owner by existing telegram_chat_id
                    stmt = select(User).where(User.telegram_chat_id == owner_tg_id)
                    result = await session.execute(stmt)
                    owner = result.scalar_one_or_none()

                    # 2. Fall back to first admin in the DB
                    if not owner:
                        stmt = select(User).where(User.role == "admin").limit(1)
                        result = await session.execute(stmt)
                        owner = result.scalar_one_or_none()

                    if owner:
                        # Auto-set telegram_chat_id if not yet stored
                        if owner.telegram_chat_id is None:
                            owner.telegram_chat_id = owner_tg_id
                            await session.commit()
                            logger.info(
                                "Auto-set telegram_chat_id=%d for user %s",
                                owner_tg_id,
                                owner.email,
                            )
                        owner_tenant_id = str(owner.tenant_id) if owner.tenant_id else None
                        owner_user_id = str(owner.id)
                        logger.info(
                            "Telegram owner resolved: %s (tenant=%s)",
                            owner.email,
                            owner_tenant_id,
                        )
                    else:
                        logger.warning(
                            "No admin user found in DB — Telegram messages will use default tenant"
                        )

                register_handlers(
                    tg,
                    graph,
                    tenant_id=owner_tenant_id,
                    user_id=owner_user_id,
                )
            except Exception:
                logger.warning("Telegram client failed to start — bot disabled", exc_info=True)
                tg = None
        else:
            logger.info("Telegram not configured — bot disabled")
        app.state.tg = tg

        yield

        # --- Shutdown ---
        set_tg_client(None)
        if tg:
            await tg.stop()

    await close_pool()
    logger.info("Shutdown complete")


app = FastAPI(title="Calendar Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(calendar_ics_router)
app.include_router(chat_router, prefix="/api")
app.include_router(escalations_router)
app.include_router(knowledge_router)
app.include_router(resources_router)
app.include_router(tenants_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
