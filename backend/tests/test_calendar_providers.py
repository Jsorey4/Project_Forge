"""eLeet Coderz — UC-14 / SE-FR-19 calendar authorization, event creation and retry outcomes."""

import base64
import hashlib
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from tests.test_all_requirements import H, _reset_limits, client, new_project, new_task, user_id


@pytest.fixture
def oauth_apps(monkeypatch):
    for prefix in ("GOOGLE_CALENDAR", "OUTLOOK_CALENDAR"):
        monkeypatch.setenv(f"{prefix}_CLIENT_ID", "test-client")
        monkeypatch.setenv(f"{prefix}_CLIENT_SECRET", "test-secret")


def begin(client, path, headers, target, **selection):
    response = client.post(path, headers=headers, json={"target": target, "oauth_consent": True, **selection})
    assert response.status_code == 200, response.text
    auth = response.json()
    return parse_qs(urlsplit(auth["authorization_url"]).query), {
        "state": auth["state"], "ticket": auth["ticket"], "code": "one-use-code",
    }


@pytest.mark.parametrize("target,token_url,events_url", [
    ("google", "https://oauth2.googleapis.com/token", "https://www.googleapis.com/calendar/v3/calendars/primary/events"),
    ("outlook", "https://login.microsoftonline.com/common/oauth2/v2.0/token", "https://graph.microsoft.com/v1.0/me/events"),
])
def test_uc14_se_fr19_provider_creates_only_selected_deadlines(client, monkeypatch, oauth_apps, target, token_url, events_url):
    pid = new_project(client)["id"]
    new_task(client, pid, title="Ship calendar", due_date="2027-04-01T17:00:00-05:00")
    path = f"/api/projects/{pid}/export/calendar"
    headers = H(client, "jon")
    query, callback = begin(client, path, headers, target, include_project_deadline=False)
    assert query["state"] == [callback["state"]]
    assert query["redirect_uri"][0].endswith("/calendar/return/" + target)
    assert query["code_challenge_method"] == ["S256"]
    calls = []

    def respond(transport, request):
        calls.append(str(request.url))
        if str(request.url) == token_url:
            form = parse_qs(request.content.decode())
            assert form["code"] == [callback["code"]] and form["redirect_uri"] == query["redirect_uri"]
            assert form["client_secret"] == ["test-secret"]
            digest = hashlib.sha256(form["code_verifier"][0].encode()).digest()
            assert query["code_challenge"] == [base64.urlsafe_b64encode(digest).decode().rstrip("=")]
            return httpx.Response(200, json={"access_token": "provider-token"})
        assert str(request.url) == events_url and request.headers["authorization"] == "Bearer provider-token"
        event = json.loads(request.content)
        if target == "google":
            assert event["summary"] == "Ship calendar (due)" and len(event["id"]) == 32
            assert event["start"]["dateTime"] == "2027-04-01T22:00:00+00:00"
            assert event["end"]["dateTime"] == "2027-04-01T22:30:00+00:00"
        else:
            assert event["subject"] == "Ship calendar (due)" and event["transactionId"]
            assert event["start"] == {"dateTime": "2027-04-01T22:00:00", "timeZone": "UTC"}
            assert event["end"]["dateTime"] == "2027-04-01T22:30:00"
        return httpx.Response(201, json={"id": "event-id"})

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", respond)
    result = client.post(path + "/complete", headers=headers, json=callback)
    assert result.json() == {"count": 1, "already_present": 0, "message": "1 deadline added"}
    assert calls == [token_url, events_url]


def test_uc14_se_fr19_provider_retry_after_partial_export(client, monkeypatch, oauth_apps):
    pid = new_project(client)["id"]
    new_task(client, pid)
    path = f"/api/projects/{pid}/export/calendar"
    headers = H(client, "jon")
    event_ids = []
    outcomes = [
        httpx.Response(200, json={"id": "saved"}), httpx.Response(503),
        httpx.Response(409, json={"error": {"errors": [{"reason": "duplicate"}]}}),
        httpx.Response(200, json={"id": "also-saved"}),
    ]

    def respond(transport, request):
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "token"})
        event_ids.append(json.loads(request.content)["id"])
        return outcomes.pop(0)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", respond)
    _, callback = begin(client, path, headers, "google")
    result = client.post(path + "/complete", headers=headers, json=callback)
    assert result.status_code == 502 and "confirmed 1 of 2" in result.json()["detail"]
    _, retry = begin(client, path, headers, "google")
    result = client.post(path + "/complete", headers=headers, json=retry)
    assert result.json()["count"] == 1 and result.json()["already_present"] == 1
    assert event_ids[:2] == event_ids[2:]


def test_uc14_se_fr19_rechecks_export_membership_and_state(client, monkeypatch, oauth_apps):
    pid = new_project(client, members=["staff"])["id"]
    path = f"/api/projects/{pid}/export/calendar"
    headers = H(client, "staff")
    _, callback = begin(client, path, headers, "outlook")

    def unexpected(*args):
        pytest.fail("Provider contacted for an unauthorized export")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", unexpected)
    assert client.post(path + "/complete", headers=headers, json={**callback, "state": "wrong"}).status_code == 400
    assert client.post(path + "/complete", headers=H(client, "jon"), json=callback).status_code == 400
    removed = client.delete(f"/api/projects/{pid}/members/{user_id('staff')}", headers=H(client, "jon"))
    assert removed.is_success, removed.text
    assert client.post(path + "/complete", headers=headers, json=callback).status_code == 403


def test_uc14_se_fr19_token_exchange_failure_sends_no_deadlines(client, monkeypatch, oauth_apps):
    path = f"/api/projects/{new_project(client)['id']}/export/calendar"
    headers = H(client, "jon")
    _, callback = begin(client, path, headers, "outlook")

    def reject_code(transport, request):
        assert request.url.host == "login.microsoftonline.com"
        return httpx.Response(400, json={"error": "invalid_grant"})

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", reject_code)
    response = client.post(path + "/complete", headers=headers, json=callback)
    assert response.status_code == 502 and "authorization failed" in response.json()["detail"]


def test_uc14_se_fr19_unconfigured_calendar_offers_actionable_error(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CALENDAR_CLIENT_SECRET", raising=False)
    path = f"/api/projects/{new_project(client)['id']}/export/calendar"
    response = client.post(path, headers=H(client, "jon"), json={"target": "google", "oauth_consent": True})
    assert response.status_code == 503 and "OAuth credentials" in response.json()["detail"]
