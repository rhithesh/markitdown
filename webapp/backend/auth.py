"""
JWT-based auth for the MarkItDown web app.

Single local user: there is no open registration. The first ever
username/password submitted via ``/api/auth/register`` becomes *the*
account (see ``db.has_any_user``/``db.create_user``); every later attempt to
register is rejected. This is a local dev tool run on one machine, so there's
no email verification, password reset flow, or multi-tenant story -- just
"set a password once, log in with it after".

The JWT is delivered as an httpOnly cookie (not read by frontend JS), so the
browser attaches it automatically and it isn't exposed to XSS.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response

import db

ACCESS_TOKEN_COOKIE = "access_token"
_TOKEN_TTL = timedelta(days=30)
_ALGORITHM = "HS256"

_SECRET_FILE = Path(__file__).parent / "data" / ".jwt_secret"


def _load_or_create_secret() -> str:
    env_secret = os.getenv("JWT_SECRET")
    if env_secret:
        return env_secret

    _SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_text(encoding="utf-8").strip()

    secret = secrets.token_hex(32)
    _SECRET_FILE.write_text(secret, encoding="utf-8")
    try:
        _SECRET_FILE.chmod(0o600)
    except OSError:
        pass  # best-effort on platforms without POSIX perms
    return secret


_SECRET = _load_or_create_secret()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False  # malformed stored hash


def create_access_token(username: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": username, "iat": now, "exp": now + _TOKEN_TTL}
    return jwt.encode(payload, _SECRET, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
    except jwt.PyJWTError:
        return None
    return payload.get("sub")


def set_auth_cookie(response: Response, username: str) -> None:
    token = create_access_token(username)
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # local http dev server, not https
        max_age=int(_TOKEN_TTL.total_seconds()),
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=ACCESS_TOKEN_COOKIE, path="/")


def get_current_user(request: Request) -> str:
    token = request.cookies.get(ACCESS_TOKEN_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    username = decode_access_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    if not db.get_user_by_username(username):
        raise HTTPException(status_code=401, detail="Account no longer exists.")

    return username
