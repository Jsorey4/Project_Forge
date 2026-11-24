---
title: Frontend comparison - Preethi vs Aashwat
date: 2026-11-24
revision: 2 (full interaction pass)
reviewer: Jon (via Claude Code)
branches:
  preethi: origin/frontend-preethi @ 9425d71
  aashwat: aashwat/fullstack-mvp @ d4722c6 (web/ + backend/)
tags: [review, frontend, ui]
---

# Frontend comparison: Preethi vs Aashwat

> [!info] How this revision was tested
> - **Every control was used, not just screenshotted:** buttons, dropdowns, checkboxes, toggles, dialogs, drag-and-drop, clickable cards and rows, and the sub-pages they open (Aashwat's project details and full task page, Preethi's person and task dialogs).
> - **Every state was driven:** timer stopped, running, and paused; empty and invalid form input; past dates; unknown users; empty search results; signed out, wrong password, and wrong 2FA code.
> - **Every role was checked (Aashwat):** Owner (Jon), Manager (Tyler), and Member (Staff), via the demo role switcher.
> - **Widths:** 1440, 1366, 1280, 1200, 1100, 1024, 768, and 375 px, including sub-pages and open dialogs, plus a 1440 × 1200 tall window for Preethi's sidebar.
> - **Clean-up:** Aashwat's demo database was backed up first. All test data was deleted afterwards, and the database was compared against the backup. Only timestamps and re-created dashboard widget rows (same positions) differ.
> - Anything not covered is listed in [[#Not tested]].

> [!warning] Corrections to revision 1
> - Preethi's projects **do** have card colors. The color picker and member chips are in the **Edit project** dialog.
> - Preethi's Tasks board **also** has a per-column "+ Add task" button, which pre-fills the status.
> - Aashwat's Settings email is **not** empty. It is read-only, and the grey disabled text looks like a placeholder.

---

## Overall

### Preethi

**Pros**
- Polished and faithful to the mockups. Spacing, colors, and type are consistent everywhere.
- Most destructive actions ask first in an in-app dialog: delete task, remove member, log out.
- The custom Export-project dropdown on Time tracking is well styled and readable.
- Profile shows **Save / Cancel** only after you change something.
- Reset password shows the same "if an account exists" message for any email (matches UC-11).

**Cons**
- **Fixed 1440 px page.** `body { min-width: 1440px }`, `<meta name="viewport" content="width=1440">`, and every page stylesheet hard-codes `width: 1440px`.
  - Narrower windows scroll sideways and hide the right-hand header buttons and the Tasks details panel.
  - Phones show a shrunken desktop page.
- **Sidebar bug (your note, cause found):** the sidebar and page wrapper use `min-height: 900px` instead of the window height.
  - In a 1440 × 1200 window on a short page, the sidebar ends at 900 px and leaves an empty strip about 300 px tall.
  - The sidebar is also not pinned, so on long pages the nav links scroll off the top.
- **No backend and no real accounts.** Data lives in this browser's `localStorage`. Logging in with a *different* email simply renames the same user and keeps all the same data.
- No MFA, roles, soft deadlines (SE-FR-06–10), comments or mentions, light theme, color-blindness settings, expenses or bids, or assigned hours.
- **Dates never show a year.** A task or project due 1 Jan 2020 displays as "Due Jan 1".
- **Past deadlines are accepted** for new projects (UC-12 requires a future date) and new tasks.
- **Some destructive actions don't confirm:** delete stage, Discard timer, and disconnecting a calendar.

### Aashwat

**Pros**
- Real backend: 2FA sign-in, roles enforced on the server, and live notifications.
- Validation is thorough, and most forms show errors next to the field.
- **Role checks verified as Member:** Cost shows an "access denied" page, People hides the role and remove controls with an explanation, Tasks hides New task and "+", and cards the Member can't move show a lock.
- Comment Markdown is sanitized. A `<script>` tag and raw `<b>` HTML were both stripped.
- Widgets can be moved with the keyboard as well as by dragging.

**Cons**
- **Architecture conflict:** it uses a FastAPI backend. The README says "Supabase only". The team needs to decide.
- **Breaks at common laptop widths.** The task page and the Cost "Add expense" row overflow; details below.
- **Six deletes use the browser's built-in `window.confirm` popup:** stage, expense, task, project, leave project, and restore dashboard. These look different from the rest of the app, and browsers can silence them, which turns the button into a silent no-op.
- **2FA is optional.** Only Tyler has it on. Jon and Staff sign in with a password only, but SE-FR-11 requires MFA.
- **Native dropdowns everywhere.** These are the ones you want redesigned to match Preethi's.
- Leftover `test1` project in the demo data.

---

## Landing page

### Preethi

**Pros**
- The Features and Mission links scroll to their sections. The feature cards and the call-to-action link to sign-up.

**Cons**
- The feature grid still advertises an **"AI assistant"**, which the README lists as out of scope.
- At 1024 px the dashboard preview is cut off on the right.

### Aashwat

**Pros**
- The call to action changes to "Go to your dashboard" when you are signed in. The AI-assistant copy is gone.

**Cons**
- None found.

---

## Log in / Sign up / Reset password

### Preethi

**Pros**
- Clear loading state ("Logging in…"). The Log out confirmation is an in-app dialog.
- Reset password gives the same message whether or not the account exists.

**Cons**
- Errors appear **one at a time** in a banner instead of next to each field.
- Sign-up drops you straight onto the dashboard. UC-08 says to confirm registration and go to log in.
- No username, no password-strength rule, and any email plus a 6-character password logs in.

### Aashwat

**Pros**
- A wrong password shows a generic "Invalid email or password" (matches UC-09). There is a show-password toggle.
- 2FA step: a wrong code shows "Invalid verification code" and clears the boxes. The correct code signs in.
- Reset password gives a generic message, and the demo inbox shows nothing for unknown emails.

**Cons**
- The error banner stays visible after you change the fields or click a demo-account button.
- When digits were typed very fast (automated typing), only the first 2FA digit registered. Typing key by key and pasting both work.
- The demo password and 2FA code are printed under the login card in demo mode.

---

## Home (Dashboard)

### Preethi

**Pros**
- Customize shows and hides cards, and the layout reflows neatly. Clicking a deadline opens that task.

**Cons**
- No drag-to-rearrange, no Restore default, and no add/remove separate from hide (SE-FR-22–25).
- An overdue task counts in "1 overdue" but is **missing from Upcoming deadlines**.

### Aashwat

**Pros**
- Dragging a widget to a free spot saves, and the new position survives a reload.
- Add widget offers My tasks, Notifications, and This week. Hide says "add it back any time". Restore default works.

**Cons**
- Moving a widget leaves an **empty gap**. Nothing slides up to fill it.
- **The arrow keys can't move a widget past another widget.** Each step that would overlap is rejected, so keyboard users can get stuck.
- Restore default uses the native confirm popup.
- The Time tracked card always shows an empty scrollbar (content 180 px in a 176 px box).
- At 1024 px the Cost summary shows "$3,355.0" with an inner scrollbar.

---

## Projects

### Preethi

**Pros**
- School / Personal / Work filters. Selecting a card shows its board below.
- The Edit project dialog has a color picker, member chips, and budget. The chosen color applies to the progress bar.
- New project shows "Give the project a name" when the name is empty.

**Cons**
- A **past deadline is accepted** and then shown as "Due Jan 1" with no year or overdue marker.
- No project status and no card reordering.
- Cost's **Edit budget** opens the whole project dialog, Delete button included.

### Aashwat

**Pros**
- New project rejects a past deadline ("Deadline must be in the future") and flags unknown usernames with removable chips (matches UC-12).
- The project details page (the one you liked) has progress by feature list, team, and shortcuts. Add feature list works.
- The Export dialog offers calendar or spreadsheet export with options. Declining Google permission cancels with "no data was shared".

**Cons**
- **Bug:** after removing the unknown-username chip, the first **Create project** still failed with "Some usernames do not match…". The second click worked.
- Members are typed as comma-separated usernames, with no picker.
- Feature lists can be added but not renamed or deleted from this page.
- Google and Outlook export only build "add to calendar" links (`backend/app/routers/exports.py:191-211`). No real API is called, which matches your "implement an actual API" note.
- The reorder arrows only appear on hover and take up room. The gold Owner badge can be confused with gold avatars (both your notes).
- The board under the cards has 3 columns, but the Tasks page has 4 (the extra one is **Review**).
- **Phone (375 px):** cards are wider than the screen (page is 413 px), so the type badge and "% done" are cut off.

---

## Tasks (board and task detail)

### Preethi

**Pros**
- Drag-and-drop between columns works. The details panel is a fixed column that never covers the board.
- Edit, Mark as done / Reopen, and Delete (with a confirm dialog) all work. "+ Add task" in a column pre-fills that status.

**Cons**
- **No ordering within a column.** The drop handler only changes status (`src/components/Board.jsx:56-61`), so a dropped card always lands at the top.
- A due date in the past is accepted. Dates show no year.
- Opening a task from a link selects it, but doesn't scroll its card into view.

### Aashwat

**Pros**
- "+" on every column. New task requires a title and due date and shows field errors.
- Drag-and-drop **keeps the drop position**, so cards can be reordered within a column (`web/src/pages/BoardPage.tsx:154-180`).
- Search filters instantly. Members see lock icons on tasks they can't move.
- On the task page, soft deadlines all work:
  - A date after the final due date is rejected.
  - Add, edit, change priority, and mark complete all work.
- On the task page, comments all work:
  - @mention autocomplete.
  - Markdown rendering.
  - An invalid @mention posts with a warning.
  - Cmd+Enter posts.

**Cons**
- **Task-page timer overflows (your note, confirmed):**
  - While the timer is **running**, Pause hangs off the Hours card **even at 1440 px**.
  - When idle, Start overflows at every width from 1024 to 1280 px.
  - At 1024 px the Estimated/Assigned labels are cut off and the Plan inputs shrink to empty slivers.
  - Cause: the clock and buttons sit in one row that can't wrap (`web/src/features/time-tracking/TaskTimerWidget.tsx:111-116`).
- **Phone:** the task page is 462 px wide. The soft-deadline inputs, Add, Comment, and the edit/delete icons are cut off.
- The details drawer covers the right side of the board, including New task and the filters.
- An empty search still shows "Drop tasks here" instead of "No matching tasks".
- "Comments (0)" doesn't update after posting until the page refreshes.
- An empty comment just disables the button. UC-21 asks for a "comment can't be empty" message.
- **Cmd+B does nothing** in the description or comment box (your note).
- A task marked Done still lists its soft deadlines as "Due soon".
- The hint says "Ctrl+Enter to post" on a Mac.

---

## Charts

### Preethi

**Pros**
- Clean donut, line, and bar charts that use each project's color.

**Cons**
- No date range, no team-versus-individual view, and no assigned hours. No hover values on the chart points.

### Aashwat

**Pros**
- Date-range picker with validation ("Start date must be on or before end date"). Team view.
- The **Task efficiency table** (the one you liked).

**Cons**
- **Assigned** (light blue) and **Actual** (purple) bars are hard to tell apart (your note).
- The last x-axis label is clipped at the right edge.
- The error banner stays after you switch projects.

---

## Cost

### Preethi

**Pros**
- The stage breakdown (rate × estimated/actual hours) is a clear **direct-labor** view (your note).
- Adding a stage validates input (a negative rate shows "Enter an hourly rate"). The project selector cards and the empty state both work.

**Cons**
- Deleting a stage has **no confirmation**.
- No expenses, bids, search, sort, or filter.

### Aashwat

**Pros**
- Bid, Budget, Stage costs, and Expenses stay separate.
- Unticking a stage relabels the total "Subtotal (1 of 2 stages)" with a warning (matches UC-01).
- Add expense validation: "Description is required" and "Enter an amount of 0 or more". Expenses can be edited in place.
- The Expenses box captures direct materials (your note). Bid and budget save.

**Cons**
- **"Add expense" row breaks at 768–1099 px:** Description shrinks to a sliver and **Add** sticks out of the card. The page is 1054 px wide at 1024. Cause: `web/src/features/costs/ExpenseTable.tsx:169`.
- **Sorting** works only on Date, Category, and Amount, not Description or Stage. **Filtering** is by category only, not stage (both your notes).
- Stage costs over budget ($300.30 vs $250) only show small "-$50.30 left" text, with no red warning.
- The Member access-denied page shows the raw "HTTP 403 · Access denied" text.
- Expense and stage deletes use the native confirm popup.

---

## People

### Preethi

**Pros**
- **Clicking a person opens their assigned tasks,** and clicking a task opens it (your note). Remove from team asks for confirmation.

**Cons**
- Remove takes the person off **all** projects at once.
- No roles. Add member stores only a name, an optional email, and project chips.
- The drill-down lists tasks in one flat list, not split by project (your note: split into Projects and Tasks).

### Aashwat

**Pros**
- A role dropdown on each card, shown next to the name and `@username` (your note).
- Demoting the last owner is blocked: "Project must have at least one owner" (matches UC-20).
- Members see the controls hidden, with a banner explaining why.

**Cons**
- **Clicking a person does nothing.** There is no drill-down like Preethi's.
- Inviting an unknown user says "No ProjectForge user has that username or email". That reveals which emails have accounts, which the reset page deliberately hides.
- Long names are truncated even at 1440 px.

---

## Calendar

### Preethi

**Pros**
- **Month, Week, and Day views.** Clicking an event opens an editor, and an end time before the start time is rejected.

**Cons**
- The Google and Outlook buttons switch to "connected" instantly. No sign-in happens, and disconnecting has no confirmation.
- Week and Day views have no hour labels.

### Aashwat

**Pros**
- Each chip links to its task and shows full details on hover. Legend and project filter.

**Cons**
- No Day view. The Week view stacks items in a list instead of placing them by time, and has no hour labels.
- Chips are heavily truncated.

---

## Time tracking

### Preethi

**Pros**
- Start, Pause, Resume, Stop, and Discard all work, with toasts. The manual entry dialog works.
- The Export project dropdown is a well-styled custom menu.

**Cons**
- **The start-timer task picker is the browser's built-in `<datalist>`** (`src/pages/TimeTracking.jsx:58-66`). The browser draws that popup itself, so the app's CSS can't style it. That explains your "transparent background, dark text" report.
- **Paused state is the wrong color (your note, confirmed):** the record row and its time stay green, and the sidebar dot stays green, while the badge is yellow.
- Free text is accepted as the task name, so the logged time isn't linked to any real task.
- Discard timer has no confirmation.

### Aashwat

**Pros**
- Start, Pause, and Stop work. Manual entry only accepts 0.25–24 hours.
- Mine / Whole project toggle and a weekly total.

**Cons**
- **Paused state says the wrong thing:** the header says "1 timer running", and the "Paused" badge and table pill are green. This is the same color problem as Preethi's.
- Very short timer runs save **0.00 h** entries.
- The export checkboxes have no labels for screen readers (they read as "on").
- **Phone:** the entries table scrolls sideways and the delete icon starts off-screen.

---

## Notifications

### Preethi

**Pros**
- The Unread filter works. Clicking a notification opens the task and lowers the unread count.

**Cons**
- A "mentioned you" notification opens a task that has no comments to read. All notifications are fixed sample data.

### Aashwat

**Pros**
- The Unread filter, clicking through to the task, and per-item **Mark read** all work, and the badge updates.

**Cons**
- None found.

---

## Profile & settings

### Preethi

**Pros**
- Save / Cancel appear only after an edit. An invalid email shows a field error. Notification toggles persist after a reload.

**Cons**
- **Change password** and **Connect** are stubs. No username, avatar, theme, color vision, or 2FA.

### Aashwat

**Pros**
- Username validation ("3–30 letters, numbers or underscores"). Color-vision modes update the preview pills live. Theme, project mode, and a 2FA set-up flow are all there.

**Cons**
- Color vision is a single choice drawn with square checkboxes.
- "Change password" just links to the reset-password page.
- A 2FA account's six code boxes don't fit: the sixth sticks out at 1024 px and is cut off on phones (`web/src/features/auth/MfaCodeInput.tsx:46`).

---

## Your notes vs this pass

| Your note | Result |
| --- | --- |
| ~500 px wasted on the right | Confirmed. Aashwat's content is capped at `max-w-[1200px]` and isn't centered. |
| Preethi's sidebar stops short | Confirmed. Cause: `min-height: 900px` on the sidebar and page wrapper. |
| Preethi's timer dropdown is illegible | Cause confirmed (native `<datalist>`). The popup itself couldn't be captured. |
| Paused "live" should be yellow | Confirmed, in **both** apps. |
| Aashwat's buttons fall out of boxes | Confirmed: Add expense (768–1099 px), task timer (running at 1440; idle at 1024–1280), 2FA boxes. |
| Per-column "+" on Aashwat's Tasks | Confirmed. Preethi's has it too, at the bottom of each column. |
| Charts light blue vs purple | Confirmed (Assigned vs Actual). |
| Costs: sort Description/Stage, filter by Stage | Confirmed missing. |
| Cmd+B in description | Confirmed: no shortcut handling. |
| Real Google/Outlook/Apple connection | Confirmed: both apps only build links or fake it. |

---

## Not tested

- **File downloads** (Excel, Google Sheets CSV, iCal, cost Export) in both apps. Downloads need your approval, so I read the export code instead.
- **Aashwat sign-up.** It would create a real account in the demo database.
- **Aashwat lockout, unlock, and completing a password reset.** These would lock or change the demo accounts.
- **Aashwat's Connect Google / Outlook / Sheets** buttons in Settings and the Calendar header.
- **Aashwat's drag-to-reorder project cards** (you reported it works; I tested the arrows and color only), **Hide vs Remove** widget differences, and **Leave project**.
- **The visual popup of Preethi's `<datalist>`.** The browser draws it outside the page, so it can't be screenshotted.
- **Light theme on pages other than the dashboard,** and color-vision modes outside the Settings preview.
- **Browsers other than Chromium** (Safari, Firefox, Edge, per SE-NFR-05), and real touch devices. Phone and tablet results come from emulated widths.
- **Timing targets:** real-time delivery within 2 s across two sessions, widget load within 3 s, and save within 5 s.

---

## Recommendation

> [!tip] Bottom line
> **Use Aashwat's app as the base. Bring over Preethi's people drill-down, stage breakdown, custom dropdowns and checkboxes, and the fixed task details column.**
>
> 1. Fix the overflow bugs: the task-page timer row (`TaskTimerWidget.tsx:111`), the Add expense row (`ExpenseTable.tsx:169`), the 2FA boxes, and the Projects cards on phones.
> 2. Replace the six `window.confirm` popups with the app's own dialog.
> 3. Fix paused-timer wording and colors (both apps). Stop saving 0.00 h entries.
> 4. Add sort by Description/Stage and a Stage filter on Cost. Add a person drill-down split by Projects and Tasks.
> 5. Decide as a team: FastAPI vs Supabase, mandatory 2FA, and real calendar APIs vs links.
