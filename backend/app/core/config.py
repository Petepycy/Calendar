from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/calendar"
    google_api_key: str = ""
    telegram_api_id: int = 0
    telegram_api_hash: str = ""
    telegram_phone: str = ""
    base_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:5173"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    google_client_id: str = ""
    google_client_secret: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    encryption_key: str = ""  # Fernet key — generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

    @property
    def psycopg_conninfo(self) -> str:
        """Convert asyncpg-style URL to psycopg conninfo for the shared pool."""
        url = self.database_url
        url = url.replace("postgresql+asyncpg://", "postgresql://")
        return url

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
