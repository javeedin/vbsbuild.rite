## 1. Overview

This story (EQP-16) adds per-user private saved searches to two places in EquipRite: the **Equipment Master** page (`equipment-foundation/equipment-master`) and the **Request Cart** equipment selection panel (`customer-portal/request-cart`). A user sets filters, saves the combination under a name, reloads it later from a dropdown, marks one as the default (auto-applied on page load), and manages the list (rename, reorder, delete) in a dialog. Saved searches are validated on load; when a referenced filter value no longer exists, the search loads with the available values and the user is notified [FDD 7.2.5D][FDD 7.5.3][FDD 7.2.6A].

This document covers the functional and technical design for sub-task EQP-41. Both the storage object and the saved-search REST endpoints are **NEW** — they do not exist in the working folder and must be built.

## 2. Functional design (FDD)

### 2.1 Business requirement

- Each user can save frequently used filter combinations as named, private (per-user) search profiles, stored in EquipRite [FDD 7.2.5D].
- A **Save Search** icon captures the current filter combination and prompts for a name [FDD 7.2.5D].
- A **Saved Search selector** dropdown at the top of the search panel lists the current user's saved searches; selecting one auto-populates all filter fields [FDD 7.2.5D].
- One saved search can be designated the **default**, automatically applied when the user navigates to the page [FDD 7.2.5D].
- A **Manage Searches** dialog, reachable from the dropdown, supports rename, reorder, and delete [FDD 7.2.5D].
- The identical capability is provided on the Create Request / Request Cart equipment selection panel, including a default search [FDD 7.5.3].
- Saved searches are validated on load; if referenced filter values no longer exist (e.g., a deleted equipment class), the search loads with the available values and the user is notified [FDD 7.2.6A].

### 2.2 Scope

In scope:
- Save / load / set-default / rename / reorder / delete of saved searches on the Equipment Master page.
- The same on the Request Cart equipment selection panel [FDD 7.5.3].
- Auto-apply of the default search on page load.
- Stale-value validation and user notification on load [FDD 7.2.6A].
- NEW EquipRite storage object and NEW REST endpoints for saved searches.

Out of scope:
- Shared / public searches (searches are per-user private) [FDD 7.2.5D].
- Changes to the global Region / Inventory Org filter; its interaction with saved searches is confirmed in design but the filter itself is unchanged [FDD 7.1.1] (see 6).
- Equipment Kit Templates [FDD 7.5.4] — a separate structured grouping feature.

### 2.3 User roles

- Any authenticated user who can reach the Equipment Master page or the Request Cart may create and manage their **own** private saved searches. Page access continues to be enforced by the existing `enforcePageAccessChain` RBAC guard on each page.
- No new role is introduced; saved searches are scoped to the signed-in user, not to a role.

### 2.4 User flow

**Equipment Master — save**
1. User sets filters in the smart-search / facet panel.
2. User clicks the **Save Search** icon, enters a name, optionally ticks "Set as default", and saves.
3. The combination is stored against the user; the new search appears in the selector.

**Equipment Master — load**
1. User opens the **Saved Search** selector and picks a saved search.
2. All filter fields are populated from the stored combination and the list re-queries.
3. If a stored value no longer exists, the search loads with the available values and a notification is shown [FDD 7.2.6A].

**Equipment Master — default on load**
1. User navigates to the page.
2. If a default saved search exists, its filters are applied automatically after the page initialises.

**Manage Searches**
1. From the selector, user opens **Manage Searches**.
2. User renames, reorders (drag or up/down), or deletes entries, and sets/clears the default.
3. Changes persist; the selector reflects the new order and names.

**Request Cart** — identical flow on the equipment selection panel [FDD 7.5.3].

### 2.5 Business rules

- Saved searches are **per-user private**; a user sees only their own [FDD 7.2.5D].
- At most **one** default per user per page context; setting a new default clears the previous one [FDD 7.2.5D].
- Selecting a saved search **replaces** the current filter values with the stored ones [FDD 7.2.5D].
- On load, each stored filter value is validated against the current list of available values. Missing values are dropped, the search loads with the remaining available values, and the user is notified [FDD 7.2.6A].
- Saved search names should be unique per user per page context (see 6 — not stated in the FDD excerpts, flagged as an assumption).
- Reorder position persists per user per page context [FDD 7.2.5D].
- Saved searches store filter criteria only; the global Region / Inventory Org filter remains a separate persistent session setting [FDD 7.1.1] (interaction confirmed in 6).

### 2.6 Acceptance criteria

- A search can be saved, loaded, set as default, renamed, reordered, and deleted successfully on the Equipment Master page.
- The default search auto-applies on Equipment Master page load.
- When a stored filter value no longer exists, the search loads with available values and the user is notified [FDD 7.2.6A].
- The same save / load / default / manage behaviour works on the Request Cart equipment selection panel [FDD 7.5.3].
- Only the signed-in user's own searches are visible and editable.
- Exactly one default exists per user per page context at any time.

## 3. Wireframes

```wireframe
{"screen": "Equipment Master — saved search bar", "page": "equipment-foundation/equipment-master", "sections": [{"title": "Search panel header", "fields": [{"label": "Saved Search", "type": "select", "value": "", "required": false}, {"label": "Save Search (icon)", "type": "toggle", "value": "", "required": false}]}], "actions": ["Save Search", "Manage Searches"], "notes": "NEW row above the existing smart-search / facet filters. Selecting a saved search repopulates all filter fields and re-queries the list. Default search auto-applies on page load."}
```
The user picks a saved search to populate filters, or clicks Save Search to store the current filters.

```wireframe
{"screen": "Save Search dialog", "page": "equipment-foundation/equipment-master (NEW dialog)", "sections": [{"title": "Save current search", "fields": [{"label": "Search name", "type": "text", "value": "", "required": true}, {"label": "Set as default", "type": "checkbox", "value": "false", "required": false}]}], "actions": ["Save", "Cancel"], "notes": "NEW dialog. Captures a name for the current filter combination and optional default flag."}
```
The user names the current filter combination and saves it.

```wireframe
{"screen": "Manage Searches dialog", "page": "equipment-foundation/equipment-master (NEW dialog)", "sections": [{"title": "My saved searches", "fields": [], "table": {"columns": ["Name", "Default", "Reorder", "Delete"], "rows": 3}}], "actions": ["Save changes", "Close"], "notes": "NEW dialog. Rename inline, toggle one default, reorder rows, delete rows. Per-user private list."}
```
The user renames, reorders, sets default, or deletes their saved searches.

```wireframe
{"screen": "Request Cart — saved search bar", "page": "customer-portal/request-cart", "sections": [{"title": "Equipment selection panel header", "fields": [{"label": "Saved Search", "type": "select", "value": "", "required": false}, {"label": "Save Search (icon)", "type": "toggle", "value": "", "required": false}]}], "actions": ["Save Search", "Manage Searches"], "notes": "NEW row above the catalog filters (Equipment Class, Subclass, Equipment Name, availability). Identical behaviour to Equipment Master [FDD 7.5.3]."}
```
The requestor picks a saved equipment search to speed up catalog selection.

## 4. Technical design (TDD)

### 4.1 Pages and components

- **`equipment-foundation/equipment-master`** — add a saved-search selector and Save Search icon to the search panel header; add two NEW `oj-dialog`s (Save Search, Manage Searches). Wire selection to repopulate the existing filter variables that feed `LoadMapDataChain` / the `getEquipriteV1EquipmentMaster` SDP, and `equipmentMasterFilters.js`.
- **`customer-portal/request-cart`** — add the same selector, Save Search icon, and the two NEW dialogs over the equipment selection panel filters (Equipment Class, Subclass, Equipment Name, availability) [FDD 7.5.3].
- NEW shared module to serialise/deserialise filter criteria and run stale-value validation so both pages behave identically.

### 4.2 Data model

**NEW object: EQR_SAVED_SEARCH** (per-user saved search profile, stored in EquipRite)

| Field | Type | Key | Notes |
|---|---|---|---|
| saved_search_id | number | PK | Generated |
| user_id | string | FK (user) | Owner; searches are per-user private [FDD 7.2.5D] |
| page_context | string | | `EQUIPMENT_MASTER` or `REQUEST_CART` — scopes the list per page |
| search_name | string | | Display name; unique per user per page_context (see 6) |
| filter_criteria | string (JSON) | | Serialised filter combination (class, subclass, name, status, availability, etc.) |
| is_default | boolean | | Only one true per user per page_context [FDD 7.2.5D] |
| display_order | number | | Reorder position per user per page_context [FDD 7.2.5D] |
| created_at | datetime | | Audit |
| updated_at | datetime | | Audit |

### 4.3 Integration touch points

| # | System | Endpoint or report | Method | Purpose | Sends | Uses from the answer |
|---|---|---|---|---|---|---|
| 1 | eqpt (NEW) | /equiprite/v1/saved-searches | GET | List current user's saved searches for a page context | `{pageContext}` | selector list, default, order |
| 2 | eqpt (NEW) | /equiprite/v1/saved-searches | POST | Create a saved search | `{pageContext, searchName, filterCriteria, isDefault}` | new saved_search_id |
| 3 | eqpt (NEW) | /equiprite/v1/saved-searches/{id} | PATCH | Rename / set default / update order / update criteria | `{searchName?, isDefault?, displayOrder?, filterCriteria?}` | updated record |
| 4 | eqpt (NEW) | /equiprite/v1/saved-searches/{id} | DELETE | Delete a saved search | `{id}` | — |
| 5 | eqpt | GET /equiprite/v1/equipment-master | GET | Re-query the Equipment Master list after a saved search is applied | existing filter params | existing SDP (unchanged) |

### 4.4 Action chains and modules

New chains on **`equipment-master`** (under `equipment-master-page-chains/`):
- `LoadSavedSearchesChain.js` — calls endpoint #1 on page init; applies the default if one exists; runs stale-value validation.
- `SaveSearchChain.js` — serialises current filters and calls endpoint #2.
- `ApplySavedSearchChain.js` — on selector change: load criteria, validate against available values [FDD 7.2.6A], set the filter variables, trigger the existing list re-query.
- `ManageSavedSearchChain.js` — rename / reorder / set-default / delete via #3 and #4.

Mirror the same four chains on **`request-cart`** (under `request-cart-page-chains/`).

New shared module:
- `resources/js/savedSearch.js` — serialise/deserialise filter criteria and validate stored values against currently available LOV values; returns the cleaned criteria plus a list of dropped values for the notification. Reused by both pages, mirroring how `equipmentMasterFilters.js` and `orgFilterOptions.js` are shared.

Existing chains reused: Equipment Master init (`EquipmentInitChain`) is extended to also kick off `LoadSavedSearchesChain`; the existing list re-query (`LoadMapDataChain` / the `getEquipriteV1EquipmentMaster` SDP) is triggered after applying a search — no change to its logic.

### 4.5 Security and roles

- Each saved-search endpoint (#1–#4) filters by the signed-in `user_id`; a user can read and modify only their own rows [FDD 7.2.5D].
- Page entry continues to be guarded by the existing `enforcePageAccessChain` on each page; no new page-level role is added.
- No elevation beyond the role already required to view Equipment Master / Request Cart.

### 4.6 Error handling and messages

- **Stale filter values on load:** drop the missing values, load with the available ones, show a notification naming what was dropped [FDD 7.2.6A].
- **Duplicate name:** block save and show an inline message on the Save Search dialog (see 6 — uniqueness rule to be confirmed).
- **Save/update/delete failure (endpoints #2–#4):** show a failure toast; do not alter the selector list until the call succeeds.
- **Empty list:** selector shows no saved searches; Save Search remains available.
- **Set-default conflict:** the backend clears the prior default atomically so only one `is_default=true` remains per user per page context.

### 4.7 Performance and limits

- Saved searches load once on page init (endpoint #1) and are held in page state; no per-keystroke calls.
- Applying a saved search reuses the existing paged list query; no new list endpoint is introduced.
- Per-user count limit is not specified in the FDD excerpts (see 6); a reasonable cap should be confirmed to keep the selector usable.

## 5. Developer reference

### 5.1 Files to change

- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page.html` — add saved-search selector, Save Search icon, and the two NEW dialogs to the search panel header.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page.json` — declare variables (saved search list, selected search, dialog state) and the new action chains / events.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page.js` — any page-module helpers for dialog state.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page-chains/EquipmentInitChain.js` — also start `LoadSavedSearchesChain`.
- NEW `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page-chains/LoadSavedSearchesChain.js`
- NEW `.../equipment-master-page-chains/SaveSearchChain.js`
- NEW `.../equipment-master-page-chains/ApplySavedSearchChain.js`
- NEW `.../equipment-master-page-chains/ManageSavedSearchChain.js`
- `webApps/vbredwoodapp/flows/customer-portal/pages/request-cart-page.html` / `.json` / `.js` — add the same selector, icon, and dialogs on the equipment selection panel [FDD 7.5.3].
- NEW `.../customer-portal/pages/request-cart-page-chains/LoadSavedSearchesChain.js`, `SaveSearchChain.js`, `ApplySavedSearchChain.js`, `ManageSavedSearchChain.js`.
- NEW `webApps/vbredwoodapp/resources/js/savedSearch.js` — shared serialise / validate module.
- Service definition for the `eqpt` backend — add the four NEW saved-search endpoints (#1–#4).

### 5.2 Existing patterns to reuse

- Shared filter modules: `equipmentMasterFilters.js` (filter → query params) and `orgFilterOptions.js` (one shared chip definition) show the established pattern for a cross-page shared module — model `savedSearch.js` on these.
- `oj-dialog` usage and close handling from the Import From Fusion dialog (`CancelImportDialogChain`) for the Save Search and Manage Searches dialogs.
- Existing list re-query via `LoadMapDataChain` / the `getEquipriteV1EquipmentMaster` SDP — reuse unchanged after applying a saved search.
- `enforcePageAccessChain` on both pages — leave in place.

### 5.3 Build steps

1. Create the NEW `EQR_SAVED_SEARCH` storage and the four `eqpt` endpoints (#1–#4), scoped to the signed-in user.
2. Add `resources/js/savedSearch.js` (serialise, deserialise, stale-value validation).
3. On `equipment-master`: add variables, selector, Save Search icon, and the two dialogs; add the four chains; extend `EquipmentInitChain` to load searches and apply default.
4. Wire `ApplySavedSearchChain` to set filter variables and trigger the existing list re-query.
5. Repeat steps 3–4 on `request-cart` for the equipment selection panel.
6. Add stale-value notification wiring on load [FDD 7.2.6A].

### 5.4 Test plan

**API scenario (calls in order)**
1. `GET /equiprite/v1/saved-searches?pageContext=EQUIPMENT_MASTER` → empty list for a new user.
2. `POST /equiprite/v1/saved-searches` with a name, filter criteria, `isDefault=true` → returns an id.
3. `POST` a second search `isDefault=false`.
4. `GET` again → two searches; exactly one `is_default=true`.
5. `PATCH /equiprite/v1/saved-searches/{id}` set second as default → first is cleared; only one default remains.
6. `PATCH` rename and change `displayOrder` → values updated.
7. `DELETE /equiprite/v1/saved-searches/{id}` → removed; `GET` confirms.
8. `GET` as a different user → none of the first user's searches appear.

**UI checks**
- Save a filter combination, confirm it appears in the selector.
- Select it, confirm all filter fields repopulate and the list re-queries.
- Set a search as default, reload the page, confirm it auto-applies.
- Open Manage Searches: rename, reorder, delete, confirm persistence.
- Simulate a deleted filter value: load the search, confirm it loads with available values and shows the notification [FDD 7.2.6A].
- Repeat all checks on the Request Cart equipment selection panel [FDD 7.5.3].
- Confirm the global Region / Inventory Org filter remains applied alongside the saved search [FDD 7.1.1].

## 6. Assumptions and open questions

- **Due date vs sprint:** the 2026-09-30 due date is inconsistent with the current sprint (2026-11 B) — needs realignment.
- **Request Cart coverage:** the story AC does not explicitly cover the Request Cart panel, but the FDD mandates identical functionality [FDD 7.5.3]; this design includes it.
- **Request Cart page path:** the working-folder detail provided covers `equipment-master`; the Request Cart page (`customer-portal/request-cart`) file paths are assumed to follow the same `flows/customer-portal/pages/...` convention and must be confirmed against the repo.
- **Global filter interaction:** how saved searches combine with the persistent, multi-select Region / Inventory Org filter needs confirmation [FDD 7.1.1]. Assumed: saved searches store filter criteria only; the global org filter stays separate.
- **Name uniqueness:** uniqueness per user per page context is assumed; not stated in the FDD excerpts.
- **Saved-search count limit:** no per-user limit is specified in the excerpts; a cap should be agreed for usability.
- **Stale-value notification wording / channel** (toast vs inline) is not specified; FDD requires only "notifies the user" [FDD 7.2.6A].
- The NEW `EQR_SAVED_SEARCH` object and the four NEW `/equiprite/v1/saved-searches` endpoints do not exist in the provided context and must be built.