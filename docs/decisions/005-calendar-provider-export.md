# ADR 005 — One-way Google Calendar and Outlook exports

Proposed for Saaqib Shaik’s review. Covers SE-FR-19 and UC-14.

The existing export dialog lets members select project deadlines, task due dates and soft deadlines. The provider integrations use the same selection and the same 30-minute UTC events as the iCal download.

Each export uses an authorization code with PKCE. FastAPI binds the selection, provider, project and user to a ten-minute ticket. It rechecks membership and reads current deadlines when the browser returns. The backend holds the provider access token in memory for that export.

The destination is the authorizing account’s primary Google calendar or default Outlook calendar. Each deadline has a stable identifier derived from its existing iCal UID. Google receives that identifier as the event ID. A duplicate-ID response counts as already present. Outlook receives it as the transaction ID for retry protection. If an insert fails, the export stops and reports how many deadlines the provider confirmed. Retrying starts a new authorization with the same deadline selections.

Long-term reconciliation of edited or deleted events is outside this export. Microsoft documents transaction IDs for retries. A durable re-export policy would require a separate team decision. [Microsoft Graph event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)
