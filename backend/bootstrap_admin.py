import asyncio
import uuid

from config import get_settings
from models.database import async_session_factory, init_database, is_database_available
from models.sql_models import SqlUser


def _create_admin(db, *, email: str, name: str) -> bool:
    if db.query(SqlUser).filter_by(email=email).first():
        return False
    db.add(
        SqlUser(id=str(uuid.uuid4()), name=name, email=email, role="super_admin", is_active=True)
    )
    db.flush()
    return True


async def main() -> None:
    settings = get_settings()
    if not settings.bootstrap_admin_email:
        raise RuntimeError("BOOTSTRAP_ADMIN_EMAIL must be set to run this script")
    email = settings.bootstrap_admin_email.strip().lower()
    name = settings.bootstrap_admin_name.strip()
    await init_database()
    if not is_database_available():
        raise RuntimeError("CampusGrade database is unavailable")
    if async_session_factory is None:
        raise RuntimeError("Async database session factory is unavailable")
    async with async_session_factory() as db:
        created = await db.run_sync(lambda sync_db: _create_admin(sync_db, email=email, name=name))
        if not created:
            print(f"CampusGrade administrator {email} already exists")
            return
        await db.commit()
        print(f"Created CampusGrade administrator {email}")


if __name__ == "__main__":
    asyncio.run(main())
