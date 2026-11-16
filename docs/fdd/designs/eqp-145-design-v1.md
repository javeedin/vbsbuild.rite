## 1. Overview

This story (EQP-145) adds an Equipment Watch feature so users can subscribe to notification events for specific equipment items. From the Equipment Detail page a user clicks a Watch/Subscribe icon, choosing a notification preference (ALL or CRITICAL_ONLY) and a delivery channel (Bell, Email, or Both). A new My Subscriptions page, reached from the user menu, lists all watched equipment and lets the user change preferences or unsubscribe. Subscriptions are delivered via Oracle Fusion Cloud BPM bell notifications and email. A per-user limit of 50 watched items (admin-configurable) applies, and Equipment Managers auto-receive notifications for their inventory orgs without subscribing [FDD 11.1].

Note: the story summary cites "Section 7.2.5A", which is Certification/Qualification Management and does not describe watch subscriptions. The governing content is FDD 11.1. This mismatch is logged as an open question [FDD 7.2.5A][FDD 11.1].

## 2. Functional design (FDD)

### 2.1 Business requirement

Users need a way to follow specific equipment and be notified of important events (status changes, transfers, certification expiry, maintenance work orders, request actions) without monitoring records manually. Notifications must respect each user's chosen scope (all events vs critical only) and delivery channel (bell, email, or both) [FDD 11.1][FDD 6.2 EQR_EQUIPMENT_WATCH][FDD 6.2 EQR_NOTIFICATION_SUBSCRIPTION].

### 2.2 Scope

In scope:
- Watch/Subscribe icon on the Equipment Detail view [FDD 11.1].
- Subscribe / unsubscribe for a single equipment item.
- Notification preference ALL or CRITICAL_ONLY, honored per subscription [FDD 11.1][FDD 6.2 EQR_EQUIPMENT_WATCH].
- Delivery channel Bell / Email / Both [FDD 11.1][FDD 6.2 EQR_NOTIFICATION_SUBSCRIPTION].
- My Subscriptions page from the user menu to list, re-configure, and unsubscribe [FDD 11.1].
- 50-item per-user watch limit, configurable by admins [FDD 11.1].
- Equipment Managers auto-receive notifications for their assigned inventory orgs without subscribing [FDD 11.1].

Out of scope:
- Authoring/customizing the Oracle Fusion Cloud BPM bell and email notification templates (admin-configured in Fusion) [FDD 11.1].
- The event-detection engine that raises notifications (parent epic EQP-125 Notification Engine); this story records subscriptions and preferences and wires delivery.

### 2.3 User roles

- End user (any EquipRite user with equipment access) — subscribes/unsubscribes and manages their own subscriptions.
- Equipment Manager — auto-receives notifications for equipment in assigned inventory orgs; may also subscribe to others [FDD 11.1].
- Administrator — adjusts the subscription limit in Configuration Settings [FDD 11.1].

(Map to the app's existing roles via `setup/rbac-admin`; see 4.5.)

### 2.4 User flow

1. User opens an equipment record on `equipment-foundation/equipment-detail`.
2. User clicks the Watch/Subscribe icon.
3. A dialog shows notification preference (ALL / CRITICAL_ONLY) and delivery channel (Bell / Email / Both). User confirms.
4. System checks the user's active watch count against the limit (default 50). If under the limit, it creates the subscription; the icon switches to "watching".
5. If at the limit, the system blocks and shows a message.
6. To manage subscriptions, the user opens My Subscriptions from the user menu, sees all watched equipment, changes a preference/channel, or unsubscribes.
7. Unsubscribe removes/deactivates the subscription; the Watch icon on the detail view reflects the unsubscribed state.

### 2.5 Business rules

- A user may hold at most 50 active watches; limit is admin-configurable [FDD 11.1].
- notification_preference is one of ALL or CRITICAL_ONLY; CRITICAL_ONLY delivers only critical events (e.g., certification expiry) [FDD 11.1][FDD 6.2].
- delivery_channel is one of BELL, EMAIL, BOTH [FDD 11.1][FDD 6.2 EQR_NOTIFICATION_SUBSCRIPTION].
- Each (user, equipment) pair has at most one active subscription.
- Equipment Managers receive notifications for equipment in their assigned inventory orgs with no explicit subscription row required [FDD 11.1].
- Notification events covered: status changes, location/project changes, certification expiry (30-day/7-day), maintenance WO create/complete, request allocation/approval [FDD 11.1].

### 2.6 Acceptance criteria

1. From Equipment Detail, clicking Watch/Subscribe creates a subscription; the icon shows the watching state. Unsubscribe removes it.
2. notification_preference (ALL / CRITICAL_ONLY) is saved and honored for the equipment.
3. delivery_channel (Bell / Email / Both) is saved and the correct channel is used.
4. My Subscriptions page lists all watched equipment and allows preference/channel change and unsubscribe [FDD 11.1].
5. A user cannot exceed the watch limit (default 50, admin-configurable); attempting to exceed it is blocked with a message [FDD 11.1].
6. Notifications are raised for all listed events on watched equipment [FDD 11.1].
7. Equipment Managers receive notifications for their inventory orgs without subscribing [FDD 11.1].

## 3. Wireframes

```wireframe
{"screen": "Equipment Detail — Watch icon & subscribe dialog", "page": "app/equipment-foundation/equipment-detail", "sections": [{"title": "Header actions", "fields": [{"label": "Watch / Subscribe", "type": "toggle", "value": "off", "required": false}]}, {"title": "Subscribe dialog", "fields": [{"label": "Notify me about", "type": "select", "value": "ALL", "required": true}, {"label": "Delivery channel", "type": "select", "value": "BOTH", "required": true}]}], "actions": ["Subscribe", "Cancel"], "notes": "Adds a Watch icon to the detail header; opens a dialog to pick preference and channel. Icon toggles to 'watching' after save."}
```
The user clicks the Watch icon, picks a preference and channel in the dialog, and confirms to start watching this equipment.

```wireframe
{"screen": "My Subscriptions", "page": "NEW: equipment-foundation/my-subscriptions", "sections": [{"title": "Watched equipment", "fields": [], "table": {"columns": ["Equipment", "Preference", "Channel", "Subscribed date", "Actions"], "rows": 3}}], "actions": ["Edit preference", "Unsubscribe"], "notes": "New page reached from the user menu; lists all active watches with inline edit of preference/channel and an Unsubscribe action per row. Shows count vs limit."}
```
The user reviews all watched equipment, changes a preference or channel, or unsubscribes from a row.

```wireframe
{"screen": "Application Configurations — Watch limit", "page": "app/setup/configurations", "sections": [{"title": "Notifications", "fields": [{"label": "Max equipment watches per user", "type": "number", "value": "50", "required": true}]}], "actions": ["Save"], "notes": "NEW setting row added to the existing configurations page so admins can change the watch limit."}
```
The administrator sets the maximum number of equipment a user may watch.

## 4. Technical design (TDD)

### 4.1 Pages and components

- `equipment-foundation/equipment-detail` (existing) — add a Watch/Subscribe icon to the header and a subscribe dialog (preference + channel). State reflects whether the current user already watches this equipment.
- `equipment-foundation/my-subscriptions` (NEW) — table of active watches with inline edit and unsubscribe; reached from the user menu (menu entry added in `shell`).
- `setup/configurations` (existing) — add a "Max equipment watches per user" number setting.

### 4.2 Data model

**EQR_EQUIPMENT_WATCH** [FDD 6.2]

| Field | Type | Key | Notes |
|---|---|---|---|
| watch_id | number | PK | |
| user_id | string | FK | Fusion User |
| equipment_id | number | FK | EQR_EQUIPMENT_MASTER |
| notification_preference | string | | ALL / CRITICAL_ONLY |
| subscribed_date | date | | Set on create |
| active_flag | boolean | | Unsubscribe sets to false |

**EQR_NOTIFICATION_SUBSCRIPTION** [FDD 6.2]

| Field | Type | Key | Notes |
|---|---|---|---|
| subscription_id | number | PK | |
| user_id | string | | |
| subscription_type | string | | EQUIPMENT_WATCH for this story |
| entity_id | number | | equipment_id |
| delivery_channel | string | | BELL / EMAIL / BOTH |
| active_flag | boolean | | |
| created_date | date | | |

Authoritative mapping is an open question (see 6). Working assumption: EQR_EQUIPMENT_WATCH holds the preference and the (user, equipment) link; EQR_NOTIFICATION_SUBSCRIPTION holds the delivery_channel with subscription_type = EQUIPMENT_WATCH and entity_id = equipment_id. Both are written per subscribe action.

### 4.3 Integration touch points

| # | System | Endpoint or report | Method | Purpose | Sends | Uses from the answer |
|---|---|---|---|---|---|---|
| 1 | EquipRite REST | NEW: EQR_EQUIPMENT_WATCH collection | POST | Create a watch | user_id, equipment_id, notification_preference, subscribed_date, active_flag | watch_id |
| 2 | EquipRite REST | NEW: EQR_EQUIPMENT_WATCH item | PATCH | Change preference / unsubscribe (active_flag) | notification_preference, active_flag | updated record |
| 3 | EquipRite REST | NEW: EQR_EQUIPMENT_WATCH collection (query) | GET | List current user's active watches; count vs limit | filter user_id, active_flag=true | watch rows, count |
| 4 | EquipRite REST | NEW: EQR_NOTIFICATION_SUBSCRIPTION collection | POST | Record delivery channel | user_id, subscription_type, entity_id, delivery_channel, active_flag | subscription_id |
| 5 | EquipRite REST | NEW: EQR_NOTIFICATION_SUBSCRIPTION item | PATCH | Change channel / deactivate | delivery_channel, active_flag | updated record |
| 6 | EquipRite REST | NEW: Configuration Settings (watch limit) | GET | Read configurable watch limit | key = max_equipment_watches | limit value |
| 7 | Oracle Fusion Cloud BPM | NEW: BPM bell + email notification (admin-configured templates) | — | Deliver notifications on watched events | event, recipient, channel | delivery confirmation |

### 4.4 Action chains and modules

- `WatchSubscribeChain` (NEW, on `equipment-detail`) — read current user's watch for this equipment; on Subscribe, check count against limit (touch point 6, then 3), then POST watch (1) and POST subscription (4); update icon state.
- `WatchUnsubscribeChain` (NEW) — PATCH watch active_flag=false (2) and PATCH subscription active_flag=false (5).
- `LoadSubscriptionsChain` (NEW, on `my-subscriptions`) — GET active watches (3) joined with subscription channel; bind to table.
- `UpdatePreferenceChain` (NEW, on `my-subscriptions`) — PATCH preference (2) and/or channel (5) for a row.
- Reuse the app's existing REST call pattern and shared toast/error module (see 5.2).

### 4.5 Security and roles

- All end users with equipment access can subscribe/unsubscribe and open My Subscriptions; each user sees only their own rows (filter by user_id).
- The watch-limit setting on `setup/configurations` is editable by Administrators only, aligned with existing page access in `setup/rbac-admin`.
- Equipment Manager auto-subscription is driven by inventory-org assignment (no UI subscription row); map via the existing Equipment Manager role.

### 4.6 Error handling and messages

- At limit: "You can watch up to {limit} equipment items. Unsubscribe from one to add another." (block Subscribe).
- Duplicate active watch: silently open the existing subscription for edit instead of creating a new one.
- REST failure on subscribe/unsubscribe: show error toast and leave icon state unchanged; no partial save (if the watch POST succeeds but the subscription POST fails, roll back the watch).
- BPM template not available: subscription still saves; log a warning that delivery templates are admin-configured [FDD 11.1].

### 4.7 Performance and limits

- Per-user watch cap default 50, admin-configurable (touch point 6) [FDD 11.1].
- My Subscriptions list is bounded by the cap, so a single paged GET is sufficient.
- Count check should use a server-side count query (3) rather than loading all rows.

## 5. Developer reference

### 5.1 Files to change

- `vbredwoodapp/equipment-foundation/equipment-detail` (page) — add Watch/Subscribe icon, subscribe dialog, and bind the new chains.
- `vbredwoodapp/equipment-foundation/my-subscriptions` (NEW page) — create the My Subscriptions list/edit page.
- `vbredwoodapp//shell` (page) — add a "My Subscriptions" entry to the user menu.
- `vbredwoodapp/setup/configurations` (page) — add the "Max equipment watches per user" setting.
- Action chains (NEW): `WatchSubscribeChain`, `WatchUnsubscribeChain`, `LoadSubscriptionsChain`, `UpdatePreferenceChain` under the relevant page's chains.
- Service definitions (NEW): REST endpoints for EQR_EQUIPMENT_WATCH, EQR_NOTIFICATION_SUBSCRIPTION, and the configuration setting (per touch points 1–6).

### 5.2 Existing patterns to reuse

- The list-detail pattern already used across `equipment-foundation` pages (e.g., `equipment-master` / `equipment-detail`) for the My Subscriptions table and row actions.
- The existing configuration-setting pattern on `setup/configurations` for the new limit field.
- The app's existing REST service connector and shared toast/notification messaging used by other pages.

### 5.3 Build steps

1. Reconcile FDD reference (11.1 vs the summary's 7.2.5A) and confirm the authoritative object mapping (open questions).
2. Define REST service endpoints for EQR_EQUIPMENT_WATCH and EQR_NOTIFICATION_SUBSCRIPTION and the watch-limit config read.
3. Add the Watch icon + dialog on `equipment-detail`; wire `WatchSubscribeChain` / `WatchUnsubscribeChain`.
4. Create `my-subscriptions` page with table, inline edit, unsubscribe; wire `LoadSubscriptionsChain` / `UpdatePreferenceChain`.
5. Add the user-menu entry in `shell`; add the limit setting in `setup/configurations`.
6. Coordinate with Fusion admin on BPM bell/email templates for delivery.
7. Test per 5.4.

### 5.4 Test plan

API scenario (in order):
1. GET config limit (6) → returns 50.
2. GET active watches for user (3) → count below limit.
3. POST watch (1) → returns watch_id.
4. POST subscription with delivery_channel (4) → returns subscription_id.
5. PATCH preference to CRITICAL_ONLY (2) → updated.
6. PATCH channel to EMAIL (5) → updated.
7. Create watches up to the limit, then POST one more (1) → blocked by limit check.
8. PATCH watch active_flag=false (2) and subscription active_flag=false (5) → unsubscribed; re-GET (3) excludes it.

UI checks:
- Watch icon toggles to "watching" after subscribe and back after unsubscribe.
- Subscribe dialog saves preference and channel; values persist on reload.
- My Subscriptions lists all active watches; inline edit updates preference/channel; unsubscribe removes the row and updates the detail icon.
- At the limit, Subscribe is blocked with the limit message.
- Config limit change by admin is reflected in the limit check.

## 6. Assumptions and open questions

- Which FDD section governs this story — the summary's "Section 7.2.5A" (Certification/Qualification) or FDD 11.1 (Watch Subscriptions)? FDD 11.1 is the matching content; treat 7.2.5A as a mis-tag pending confirmation [FDD 7.2.5A][FDD 11.1].
- Authoritative object: both EQR_EQUIPMENT_WATCH (notification_preference) and EQR_NOTIFICATION_SUBSCRIPTION (delivery_channel) appear in FDD 6.2; this design writes both. Confirm whether one should be the single source of truth.
- Availability of Oracle Fusion Cloud BPM bell/email notification templates (admin-configured) is unknown — a dependency for delivery [FDD 11.1].
- Equipment Manager auto-subscription: exact mapping of "assigned inventory organizations" to the Equipment Manager role needs confirmation; no UI is defined for it in this story [FDD 11.1].
- Due date 2026-09-30 has passed and the sprint moved to 2026-11 A; a revised timeline is needed.
- The event-detection engine (which events fire notifications) is assumed delivered under epic EQP-125; this story covers subscription storage, preferences, and delivery wiring only.