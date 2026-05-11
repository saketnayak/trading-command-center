import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import Response
from app.config import settings
from app.database import engine
from app.dependencies import require_admin
from app.models.user import User

router = APIRouter()


def _sync_db_url() -> str:
    """Strip +asyncpg so pg_dump / pg_restore can connect."""
    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


@router.get("/backup")
async def download_backup(_admin: User = Depends(require_admin)):
    """Stream a pg_dump custom-format backup of the entire database."""
    db_url = _sync_db_url()
    proc = await asyncio.create_subprocess_exec(
        "pg_dump", "-Fc", db_url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"pg_dump failed: {stderr.decode(errors='replace')}",
        )
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"agentfloor-backup-{date_str}.dump"
    return Response(
        content=stdout,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...),
    _admin: User = Depends(require_admin),
):
    """Restore a pg_dump custom-format backup. Replaces all existing data."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    # Close pooled connections so pg_restore --clean can DROP tables without lock contention.
    await engine.dispose()

    db_url = _sync_db_url()
    proc = await asyncio.create_subprocess_exec(
        "pg_restore", "--clean", "--if-exists", "--no-owner", "--no-privileges", "-d", db_url,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate(input=data)
    # pg_restore exits non-zero on warnings (e.g. DROP of non-existent object); treat those as OK
    if proc.returncode not in (0, 1):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"pg_restore failed (exit {proc.returncode}): {stderr.decode(errors='replace')}",
        )
    return {"message": "Restore completed successfully.", "warnings": stderr.decode(errors="replace") or None}
