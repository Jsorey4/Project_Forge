"""eLeet Coderz — one-way Google Calendar and Microsoft Graph exports (UC-14, SE-FR-19)."""

import base64
import hashlib
import html
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode
from uuid import NAMESPACE_URL, uuid5

import httpx
from fastapi import HTTPException

from app.core.config import get_settings
from app.core.database import to_naive_utc
from app.core.security import create_token, decode_token
from app.schemas.dto import CalendarAuthorization, CalendarCallback, CalendarExportRequest, CalendarExportResult

EVENT_LENGTH = timedelta(minutes=30)
TICKET_TYPE = "calendar-export"


@dataclass(frozen=True)
class Deadline:
    uid: str
    title: str
    starts_at: datetime
    description: str
    category: str


@dataclass(frozen=True)
class Provider:
    name: str
    env_prefix: str
    authorize_url: str
    token_url: str
    events_url: str
    scope: str


PROVIDERS = {
    "google": Provider(
        "Google Calendar", "GOOGLE_CALENDAR", "https://accounts.google.com/o/oauth2/v2/auth",
        "https://oauth2.googleapis.com/token", "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        "https://www.googleapis.com/auth/calendar.events.owned",
    ),
    "outlook": Provider(
        "Outlook", "OUTLOOK_CALENDAR", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "https://login.microsoftonline.com/common/oauth2/v2.0/token", "https://graph.microsoft.com/v1.0/me/events",
        "https://graph.microsoft.com/Calendars.ReadWrite",
    ),
}


def _credentials(provider: Provider) -> tuple[str, str]:
    client_id = os.getenv(f"{provider.env_prefix}_CLIENT_ID")
    secret = os.getenv(f"{provider.env_prefix}_CLIENT_SECRET")
    if not client_id or not secret:
        raise HTTPException(503, f"{provider.name} export needs OAuth credentials. Contact the project administrator.")
    return client_id, secret


def _redirect_uri(target: str) -> str:
    return f"{get_settings().frontend_url}/calendar/return/{target}"


def authorize(user_id: str, project_id: str, selection: CalendarExportRequest) -> CalendarAuthorization:
    provider = PROVIDERS[selection.target]
    client_id, _ = _credentials(provider)
    verifier = secrets.token_urlsafe(48)
    # Only the random state and PKCE challenge leave for the provider. The signed ticket
    # stays in this tab and binds the verifier and deadline selections to the current member.
    ticket, state = create_token(user_id, TICKET_TYPE, 10, {
        "project": project_id, "selection": selection.model_dump(), "verifier": verifier,
    })
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    query = urlencode({
        "client_id": client_id, "redirect_uri": _redirect_uri(selection.target), "response_type": "code",
        "scope": provider.scope, "state": state, "code_challenge_method": "S256", "code_challenge": challenge,
    })
    return CalendarAuthorization(authorization_url=f"{provider.authorize_url}?{query}", ticket=ticket, state=state)


def verify_callback(user_id: str, project_id: str, body: CalendarCallback) -> tuple[CalendarExportRequest, str]:
    claims = decode_token(body.ticket, TICKET_TYPE)
    if not claims or claims["sub"] != user_id or claims["project"] != project_id or claims["jti"] != body.state:
        raise HTTPException(400, "Calendar authorization expired or does not match this export. Start the export again.")
    return CalendarExportRequest.model_validate(claims["selection"]), claims["verifier"]


def _event(target: str, deadline: Deadline) -> dict:
    start = to_naive_utc(deadline.starts_at)
    end = start + EVENT_LENGTH
    # The same deadline has the same identifier even if a response was lost after a successful POST.
    event_id = uuid5(NAMESPACE_URL, deadline.uid)
    if target == "google":
        return {
            "id": event_id.hex, "summary": deadline.title, "description": html.escape(deadline.description),
            "start": {"dateTime": start.replace(tzinfo=UTC).isoformat()},
            "end": {"dateTime": end.replace(tzinfo=UTC).isoformat()},
        }
    return {
        "transactionId": str(event_id), "subject": deadline.title,
        "body": {"contentType": "Text", "content": deadline.description},
        "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
    }


def _google_duplicate(response: httpx.Response) -> bool:
    if response.status_code != 409:
        return False
    errors = response.json().get("error", {}).get("errors", [])
    return any(error.get("reason") == "duplicate" for error in errors)


def publish(target: str, code: str, verifier: str, deadlines: list[Deadline]) -> CalendarExportResult:
    provider = PROVIDERS[target]
    client_id, secret = _credentials(provider)
    added = already_present = 0
    with httpx.Client(timeout=15) as client:
        try:
            response = client.post(provider.token_url, data={
                "grant_type": "authorization_code", "code": code, "redirect_uri": _redirect_uri(target),
                "client_id": client_id, "client_secret": secret, "code_verifier": verifier,
            })
            response.raise_for_status()
            token = response.json()["access_token"]
            if not isinstance(token, str) or not token:
                raise ValueError("Missing access token")
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise HTTPException(502, f"{provider.name} authorization failed. Authorize the export again.") from exc

        for deadline in deadlines:
            try:
                response = client.post(provider.events_url, headers={"Authorization": f"Bearer {token}"},
                                       json=_event(target, deadline))
                if target == "google" and _google_duplicate(response):
                    already_present += 1
                    continue
                response.raise_for_status()
                if response.status_code not in (200, 201) or not response.json().get("id"):
                    raise ValueError("Missing event confirmation")
                added += 1
            except (httpx.HTTPError, ValueError, AttributeError, TypeError) as exc:
                confirmed = added + already_present
                raise HTTPException(502, f"{provider.name} confirmed {confirmed} of {len(deadlines)} deadlines. "
                                         "Retry the export using the same calendar account.") from exc

    noun = "deadline" if added == 1 else "deadlines"
    message = f"{added} {noun} added"
    if already_present:
        message += f" · {already_present} already present"
    return CalendarExportResult(message=message, count=added, already_present=already_present)
