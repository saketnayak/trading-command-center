import pytest

pytestmark = pytest.mark.unit


def test_settings_loads():
    from app.config import settings
    assert settings.jwt_secret != ""
    assert len(settings.encryption_key) == 64  # 32 bytes hex
