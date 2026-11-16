from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.settings import settings

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}


def tls_connect_args(database_url: str) -> dict[str, str]:
    """Insist on an encrypted connection to any database that is not on this machine.

    A URL that already names an sslmode (for example Neon's sslmode=require, or verify-full) is
    left exactly as written; only a remote URL with no mode at all is upgraded to require TLS.
    """
    url = make_url(database_url)
    if not url.drivername.startswith("postgresql"):
        return {}
    if (url.host or "") in _LOCAL_HOSTS or "sslmode" in url.query:
        return {}
    return {"sslmode": "require"}


engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
    connect_args=tls_connect_args(settings.DATABASE_URL),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
