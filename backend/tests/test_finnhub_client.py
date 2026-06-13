import httpx
import pytest

from app.services.finnhub_client import (
    FinnhubCapability,
    FinnhubReason,
    aggregate_unavailable_reason,
    classify_error_body,
    classify_http_status,
    classify_response,
    should_cache_error,
    user_message_for_reason,
)


def test_classify_http_status_invalid_key():
    assert classify_http_status(401) == FinnhubReason.INVALID_KEY


def test_classify_http_status_premium_required():
    assert classify_http_status(403, "Premium subscription required") == FinnhubReason.PREMIUM_REQUIRED


def test_classify_http_status_access_denied():
    assert classify_http_status(403, "You don't have access to this resource.") == FinnhubReason.ACCESS_DENIED


def test_classify_error_body_premium():
    assert classify_error_body({"error": "This endpoint requires premium access"}) == FinnhubReason.PREMIUM_REQUIRED


def test_classify_response_403_news():
    response = httpx.Response(
        403,
        json={"error": "You don't have access to this resource."},
        request=httpx.Request("GET", "https://finnhub.io/api/v1/company-news"),
    )
    error = classify_response(response, FinnhubCapability.COMPANY_NEWS)
    assert error is not None
    assert error.reason in {FinnhubReason.ACCESS_DENIED, FinnhubReason.PREMIUM_REQUIRED}


def test_classify_response_success_list():
    response = httpx.Response(
        200,
        json=[{"headline": "Test", "datetime": 1}],
        request=httpx.Request("GET", "https://finnhub.io/api/v1/company-news"),
    )
    assert classify_response(response, FinnhubCapability.COMPANY_NEWS) is None


def test_should_not_cache_entitlement_errors():
    from app.services.finnhub_client import FinnhubError

    err = FinnhubError(
        capability=FinnhubCapability.COMPANY_NEWS,
        reason=FinnhubReason.PREMIUM_REQUIRED,
        message="premium",
    )
    assert should_cache_error(err) is False


def test_aggregate_unavailable_reason_prefers_premium():
    from app.services.finnhub_client import FinnhubError

    errors = [
        FinnhubError(FinnhubCapability.COMPANY_NEWS, FinnhubReason.ACCESS_DENIED, "denied"),
        FinnhubError(FinnhubCapability.COMPANY_NEWS, FinnhubReason.PREMIUM_REQUIRED, "premium"),
    ]
    assert aggregate_unavailable_reason(errors) == FinnhubReason.PREMIUM_REQUIRED.value


def test_user_message_for_premium_news():
    msg = user_message_for_reason(FinnhubReason.PREMIUM_REQUIRED, FinnhubCapability.COMPANY_NEWS)
    assert "company news" in msg
    assert "Premium" in msg
