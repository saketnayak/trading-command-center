from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, InviteRequest, UpdateMeRequest
from app.services.auth import hash_password, verify_password, create_access_token, create_invite_token, verify_invite_token
from app.services.email import send_invite_email
from app.dependencies import get_current_user, require_admin
from app.config import settings

router = APIRouter()


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    count_result = await db.execute(select(func.count()).select_from(User))
    is_first_user = count_result.scalar() == 0

    if not is_first_user:
        if not req.invite_token:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "An invite token is required to register")
        try:
            invited_email = verify_invite_token(req.invite_token)
        except ValueError as e:
            raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
        if invited_email.lower() != req.email.lower():
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Invite token is not valid for this email address")

    user = User(
        email=req.email,
        hashed_password=hash_password(req.password),
        name=req.name,
        role=UserRole.admin if is_first_user else UserRole.member,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(str(user.id), user.role.value))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return TokenResponse(access_token=create_access_token(str(user.id), user.role.value))


@router.post("/invite")
async def invite(req: InviteRequest, _admin: User = Depends(require_admin)):
    token = create_invite_token(req.email)
    invite_url = f"{settings.frontend_url}/register?token={token}"
    await send_invite_email(req.email, invite_url)
    return {"message": f"Invite sent to {req.email}"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"id": str(user.id), "email": user.email, "name": user.name, "role": user.role}


@router.patch("/me")
async def update_me(req: UpdateMeRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if req.name is not None:
        user.name = req.name
    if req.current_password is not None and req.new_password is not None:
        if not user.hashed_password or not verify_password(req.current_password, user.hashed_password):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
        user.hashed_password = hash_password(req.new_password)
    db.add(user)
    await db.commit()
    return {"message": "Profile updated"}
