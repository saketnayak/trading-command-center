from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.user import UserResponse, UserUpdateRequest
from app.dependencies import require_admin

router = APIRouter()


@router.get("", response_model=list[UserResponse])
async def list_users(db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(user_id: UUID, req: UserUpdateRequest, db: AsyncSession = Depends(get_db), _admin: User = Depends(require_admin)):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.role = UserRole(req.role)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: UUID, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if str(user_id) == str(admin.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot delete yourself")
    user = await db.get(User, user_id)
    if user:
        await db.delete(user)
        await db.commit()
