import base64
import hashlib
import hmac

import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from config import get_settings
from cryptography.fernet import Fernet, InvalidToken

# Sprint 4, the original implementation plan: argon2id is the hash new passwords get.
# bcrypt (and the older reversible Fernet format below) are read-only from
# here on — `verify_password` still accepts them so existing accounts can
# still log in, and `needs_password_rehash` flags them so a successful
# login upgrades the stored hash to argon2id on the spot. Nothing forces a
# mass rehash; accounts that never log in again simply keep their old hash,
# which is fine — the format is still verified correctly either way.
BCRYPT_ROUNDS = 12
_ARGON2_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)


def hash_password(plain_text: str) -> str:
    """Return a one-way argon2id password hash."""
    if not plain_text:
        raise ValueError("Password is required")
    return _ARGON2_HASHER.hash(plain_text)


def is_argon2_hash(value: str) -> bool:
    return isinstance(value, str) and value.startswith("$argon2")


def is_bcrypt_hash(value: str) -> bool:
    return isinstance(value, str) and value.startswith(("$2a$", "$2b$", "$2y$"))


def is_password_hash(value: str) -> bool:
    """True for any one-way hash this module recognises (argon2id or the
    legacy bcrypt format) — as opposed to the still-older reversible Fernet
    encoding `decrypt_legacy_password` reads."""
    return is_argon2_hash(value) or is_bcrypt_hash(value)


def verify_password(plain_text: str, stored_value: str) -> bool:
    if not plain_text or not stored_value:
        return False

    if is_argon2_hash(stored_value):
        try:
            return _ARGON2_HASHER.verify(stored_value, plain_text)
        except (VerifyMismatchError, InvalidHashError):
            return False

    if is_bcrypt_hash(stored_value):
        try:
            return bcrypt.checkpw(plain_text.encode("utf-8"), stored_value.encode("utf-8"))
        except ValueError:
            return False

    legacy_plain_text = decrypt_legacy_password(stored_value)
    return bool(legacy_plain_text) and hmac.compare_digest(legacy_plain_text, plain_text)


def needs_password_rehash(stored_value: str) -> bool:
    """True whenever the stored hash isn't the current argon2id parameters
    — covers bcrypt/legacy-Fernet hashes (always rehash) and argon2id
    hashes whose cost parameters have since been raised."""
    if is_argon2_hash(stored_value):
        try:
            return _ARGON2_HASHER.check_needs_rehash(stored_value)
        except InvalidHashError:
            return True
    return True


def _legacy_fernet() -> Fernet:
    secret = get_settings().secret_key.encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def decrypt_legacy_password(cipher_text: str) -> str:
    """Read the retired reversible format only for migration and login upgrade."""
    if not cipher_text or is_password_hash(cipher_text):
        return ""
    try:
        return _legacy_fernet().decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return ""


# Compatibility name retained while existing creation call sites are migrated.
encrypt_password = hash_password


def decrypt_password(cipher_text: str) -> str:
    """Deprecated compatibility helper for one-time legacy migration scripts."""
    return decrypt_legacy_password(cipher_text)
