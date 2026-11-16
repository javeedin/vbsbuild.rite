## 1. Overview

This story (EQP-211) adds **Equipment Certification / Qualification Management** to the Equipment Master detail view of the EquipRite app (vbredwoodapp). Each equipment record will hold multiple certification/qualification records — each with Type, Issuing Authority, Certificate Number, Issue/Expiry dates, a GREEN/AMBER/RED status badge, and attachments. An aggregate Overall Qualification Status is rolled up to the Equipment Master grid, and RED equipment triggers a warning during request creation [FDD 7.2.5A]. Certification and qualification data is sourced from Oracle Fusion Maintenance asset records via synchronization, and a Certification Summary view appears on the Equipment Master detail page.

The story adds requirements beyond the matched FDD excerpts — Fusion Maintenance qualification sourcing, auto-triggered qualification work orders, type-based validity periods, multi-page document packages with inline viewing, and a **hard block** at allocation/shipment. These are flagged against the FDD below and gathered in Section 6.

## 2. Functional design (FDD)

### 2.1 Business requirement

Equipment Managers and Safety/Compliance staff must track the certification/qualification status of every equipment asset so that no equipment is deployed with an expired or missing certification. Today the Equipment Detail and Equipment Unit Detail pages show master, asset, cost and attachment data, but there is no record of certifications or qualification validity. This story introduces certification records, a validity status indicator, a fleet-level rollup, and deployment controls.

### 2.2 Scope

In scope:
- A **Certifications tab / Certification Summary** on the Equipment Master detail view listing all certifications held by the asset, each with Type, Issuing Authority, Certificate Number, Issue Date, Expiry Date, Status badge and attachment(s) [FDD 7.2.5A].
- Per-certification **Status Indicator**: GREEN (>30 days to expiry), AMBER (within 30 days), RED (expired) [FDD 7.2.5A].
- **Overall Qualification Status** rollup badge on the Equipment Master grid row (worst-case) [FDD 7.2.5A].
- **Warning/confirmation dialog** when RED equipment is selected during request creation, with Equipment Manager override and documented justification [FDD 7.2.5A][FDD 7.2.6A].
- **Synchronization** of qualification data (Type, effective period, Status) from Oracle Fusion Maintenance asset records (story; not in FDD excerpts — see 6).
- **Hard block** at allocation and shipment for expired/missing certification (story; contradicts FDD excerpts — see 6).
- **Auto-triggered qualification work orders** with type-based validity periods (story; not in FDD excerpts — see 6).
- **Multi-page document packages** as attachments, viewable inline (story; FDD covers PDF/image attachments only — see 6).

Out of scope / noted but not built here:
- The **Certification Compliance Report RPT-13** [FDD 7.15.15] — required by the FDD for fleet compliance but omitted from this story (see 6).

### 2.3 User roles

- **Equipment Manager** — views and manages certifications, uploads evidence, triggers Refresh from Fusion, and overrides RED warnings / blocks with justification (maps to FULL access on `EQR_EQUIPMENT_MASTER`, the same guard used by `requireFullAccessChain`).
- **Equipment/Catalog user (READ_ONLY)** — browses certifications and status badges, cannot edit.
- **Safety/Compliance** — audience of the (out-of-scope) RPT-13 report [FDD 7.15.15].

### 2.4 User flow

1. User opens an equipment record (Equipment Detail or Equipment Unit Detail).
2. User opens the **Certifications** tab / Certification Summary; the page loads the asset's certification records (synced from Fusion Maintenance) with status badges.
3. User selects a certification to view details; attachments (including multi-page packages) can be opened inline.
4. Equipment Manager can **Refresh from Fusion** to re-pull qualification data for this asset [FDD 7.2.6A pattern].
5. On the Equipment Master grid, each row shows the **Overall Qualification Status** badge.
6. During request creation, if selected equipment is RED, a **confirmation dialog** appears; an Equipment Manager may override with justification [FDD 7.2.5A]. (Story requires a hard block at allocation/shipment — see 6.)

### 2.5 Business rules

- Status per certification: GREEN if >30 days to Expiry Date; AMBER if ≤30 days and not yet expired; RED if past Expiry Date [FDD 7.2.5A].
- Overall Qualification Status = worst case across all certifications: GREEN if all active, AMBER if any within 30 days, RED if any expired [FDD 7.2.5A].
- RED equipment triggers a warning when selected for a new request; Equipment Managers can override with documented justification [FDD 7.2.5A][FDD 7.2.6A].
- Qualification validity period is driven by qualification type (e.g., calibration = 1 year, load test = 5 years) — story (see 6).
- A single asset may hold multiple concurrent certifications of different types — story.
- "Missing certification" as a block criterion is not defined in the FDD excerpts (see 6).

### 2.6 Acceptance criteria

1. The Equipment Master detail view shows a Certifications tab listing all certifications for the asset with Type, Issuing Authority, Certificate Number, Issue Date, Expiry Date, Status badge and attachment indicator [FDD 7.2.5A].
2. Each certification shows the correct GREEN/AMBER/RED badge per the 30-day rule [FDD 7.2.5A].
3. The Equipment Master grid shows the Overall Qualification Status badge using worst-case rollup [FDD 7.2.5A].
4. Selecting RED equipment during request creation raises a confirmation dialog; an Equipment Manager can override with a justification that is recorded [FDD 7.2.5A][FDD 7.2.6A].
5. Certification data (Type, effective period, Status) is populated from Oracle Fusion Maintenance via sync, with a Last Synced timestamp shown [FDD 7.2.6A pattern] — pending design authority (see 6).
6. A multi-page attachment package can be uploaded and viewed inline — pending design authority (see 6).
7. Hard-block behaviour at allocation/shipment is implemented per the resolution in Section 6 (currently in conflict with the FDD).

## 3. Wireframes

```wireframe
{"screen": "Equipment detail — Certifications tab", "page": "equipment-foundation/equipment-detail", "sections": [{"title": "Certification Summary", "fields": [{"label": "Overall Qualification Status", "type": "readonly", "value": "AMBER"}, {"label": "Last Synced", "type": "readonly", "value": "2026-11-16 10:29"}], "table": {"columns": ["Type", "Issuing Authority", "Certificate Number", "Issue Date", "Expiry Date", "Days to Expiry", "Status", "Attachment"], "rows": 3}}], "actions": ["Refresh from Fusion", "View certificate", "Add certification (NEW)"], "notes": "NEW Certifications tab added to Equipment Detail. Status column is a color badge (GREEN/AMBER/RED). Overall status rolls up worst-case."}
```
The user reviews all certifications for the asset, sees the rollup status, and opens a certificate.

```wireframe
{"screen": "Certification detail / evidence viewer", "page": "NEW: equipment-foundation/equipment-detail (dialog)", "sections": [{"title": "Certification", "fields": [{"label": "Type", "type": "select", "value": "Load Test", "required": true}, {"label": "Issuing Authority", "type": "text", "value": "DNV", "required": true}, {"label": "Certificate Number", "type": "text", "value": "", "required": true}, {"label": "Issue Date", "type": "date", "value": "", "required": true}, {"label": "Expiry Date", "type": "date", "value": "", "required": true}, {"label": "Status", "type": "readonly", "value": "GREEN"}, {"label": "Evidence package (multi-page)", "type": "readonly", "value": "DNV_cert_pkg.pdf"}]}], "actions": ["View inline", "Download", "Close"], "notes": "NEW dialog reusing the existing Attachments dialog pattern for upload and inline PDF preview; multi-page package shown in an iframe preview (viewAttachmentChain pattern)."}
```
The user views one certification and opens the multi-page evidence package inline.

```wireframe
{"screen": "Equipment Master grid — Overall Qualification Status", "page": "equipment-foundation/equipment-master", "sections": [{"title": "Equipment list", "table": {"columns": ["Equipment Number", "Class", "Location", "Overall Qualification Status", "Last Synced"], "rows": 5}}], "actions": ["Open detail", "Refresh from Fusion"], "notes": "NEW column: Overall Qualification Status badge (worst-case rollup) added to the Equipment Master grid row."}
```
The user scans the fleet grid and sees which equipment has expiring/expired certifications.

```wireframe
{"screen": "Request creation — RED warning", "page": "customer-portal/project-create-request", "sections": [{"title": "Certification warning", "fields": [{"label": "Equipment", "type": "readonly", "value": "EQ-00042"}, {"label": "Overall Qualification Status", "type": "readonly", "value": "RED"}, {"label": "Override justification", "type": "textarea", "value": "", "required": true}]}], "actions": ["Override (Equipment Manager)", "Cancel"], "notes": "NEW confirmation dialog when RED equipment is selected; justification required for Equipment Manager override. Hard-block behaviour at allocation/shipment pending Section 6 resolution."}
```
The user is warned about RED equipment and either cancels or (as Equipment Manager) overrides with justification.

## 4. Technical design (TDD)

### 4.1 Pages and components

- **equipment-foundation/equipment-detail** — add a Certifications tab / Certification Summary section with a table of certification rows, status badges, Overall Qualification Status, Last Synced indicator, and a Refresh from Fusion action.
- **equipment-foundation/equipment-unit-detail** — surface certifications at the serial-unit level consistent with the detail view (reuses the Attachments dialog pattern already present on this page).
- **equipment-foundation/equipment-master** — add Overall Qualification Status column to the grid.
- **Request creation page (project-create-request / customer-create-req)** — add RED confirmation dialog with override justification.
- **Certification detail / evidence dialog** — NEW dialog reusing the existing Attachments dialog (`openAttachmentsChain`, `viewAttachmentChain`) for multi-page inline preview.

### 4.2 Data model

**EQR_CERTIFICATION (NEW)** — one row per certification/qualification held by an equipment master or serial unit.

| Field | Type | Key | Notes |
|---|---|---|---|
| ID | number | PK | Certification record id |
| ENTITY_NAME | text | | HEADER (master) or LINE (serial unit), same convention as EQR_ATTACHMENT |
| ENTITY_ID | number | FK | Equipment master id or serial unit id |
| CERT_TYPE | text | | LOV/free-text (Load Test, Calibration, Safety Inspection…) [FDD 7.2.5A] |
| ISSUING_AUTHORITY | text | | Certifying body or inspector [FDD 7.2.5A] |
| CERTIFICATE_NUMBER | text | | Unique reference [FDD 7.2.5A] |
| ISSUE_DATE | date | | Date granted [FDD 7.2.5A] |
| EXPIRY_DATE | date | | Drives status indicator [FDD 7.2.5A] |
| STATUS | text | | Derived GREEN/AMBER/RED (not stored or recomputed on read) [FDD 7.2.5A] |
| VALIDITY_MONTHS | number | | Type-based validity (e.g., calibration 12, load test 60) — story (see 6) |
| SOURCE | text | | FUSION_MAINT or MANUAL — story (see 6) |
| FUSION_QUAL_REF | text | | Source qualification ref from Fusion Maintenance — story (see 6) |
| LAST_SYNCED | datetime | | Timestamp of last sync [FDD 7.2.6A pattern] |
| ATTACHMENT_ID | number | FK | Link to EQR_ATTACHMENT evidence package |

Certification evidence reuses **EQR_ATTACHMENT** (existing) via the Attachments endpoints.

### 4.3 Integration touch points

| # | System | Endpoint or report | Method | Purpose | Sends | Uses from the answer |
|---|---|---|---|---|---|---|
| 1 | eqpt | NEW: eqp-v1/listCertifications `/equiprite/v1/equipment-certifications` | GET | List certifications for one master/unit | `{entityName, entityId}` | certification rows, status, expiry |
| 2 | eqpt | NEW: eqp-v1/getOverallQualStatus `/equiprite/v1/equipment-certifications/overall` | GET | Rollup status for grid rows | `{equipmentIds}` | Overall Qualification Status badge |
| 3 | eqpt | NEW: eqp-v1/syncCertificationsFromFusion `/equiprite/v1/equipment-certifications/sync` | POST | Sync qualification data from Fusion Maintenance | `{entityId}` | Type, effective period, Status, Last Synced |
| 4 | eqpt | eqp-v1/listEquipmentAttachments `/equiprite/v1/equipment-attachments` | GET | List evidence attachments for a certification | `{entityName, entityId}` | attachment list |
| 5 | eqpt | eqp-v1/uploadEquipmentAttachment `/equiprite/v1/equipment-attachments` | POST | Upload multi-page evidence package | multipart file + metadata | stored package |
| 6 | commonService | commonService/getCommonDocumentAccessUrl `/common/documents/v1/{docId}/access-url` | GET | Mint pre-auth URL for inline preview | `{docId}` | inline PDF preview URL |
| 7 | eqpt | eqp-v1/removeEquipmentAttachment `/equiprite/v1/equipment-attachments/{id}` | DELETE | Soft-remove an evidence attachment | `{id}` | — |
| 8 | eqpt | eqp-v1/getEquipriteV1EquipmentMasterById `/equiprite/v1/equipment-master/{id}` | GET | Load master on detail entry | `{id}` | master context for cert load |
| 9 | Oracle BI Publisher (SOAP) | bipService/runBIPReport `/xmlpserver/services/ExternalReportWSSService` — RPT-13 (NEW report) | POST | Certification Compliance Report | report params | out of scope here [FDD 7.15.15] |

### 4.4 Action chains and modules

- **loadCertificationsChain (NEW)** — on detail entry, calls `listCertifications` (and `getOverallQualStatus`), computes badges, sets Last Synced. Mirrors `loadAttachmentsChain`.
- **syncCertificationsChain (NEW)** — on "Refresh from Fusion", calls `syncCertificationsFromFusion`, shows spinner and success/failure toast (same pattern as [FDD 7.2.6A] Detail-Level Refresh).
- **openCertificationChain / viewCertEvidenceChain (NEW)** — open certification dialog; reuse `viewAttachmentChain` logic to mint an access URL and render the multi-page package in an iframe.
- Reuse existing **uploadAttachmentChain**, **removeAttachmentChain**, **downloadAttachmentChain** for evidence.
- Reuse **equipmentAttachments.js** module for shared attachment rules; add a **certifications.js (NEW)** module for status computation and rollup.

### 4.5 Security and roles

- Create/edit/sync certifications require FULL access to `EQR_EQUIPMENT_MASTER` — reuse the `requireFullAccessChain` guard pattern.
- READ_ONLY users may view certifications and badges.
- RED override at request creation is restricted to Equipment Manager and records the justification [FDD 7.2.5A][FDD 7.2.6A].
- Signed-in user resolved via the existing **currentUser.js** module.

### 4.6 Error handling and messages

- Sync failure: inline error next to the item with a Retry link; failure logged in **EQR_ERROR_LOG** with an appropriate `error_source` (follow the SELECTIVE_SYNC pattern [FDD 7.2.6A]).
- Attachment upload: validate type/size on pick (reuse `pickAttachmentFileChain`); show inline errors before submit.
- RED override: block the request action until a justification is entered.
- Access-URL mint failure: toast error, no preview.

### 4.7 Performance and limits

- `getOverallQualStatus` for the grid should accept a batch of equipment ids to avoid per-row calls on the Equipment Master list (which already loads up to 10000 rows).
- Multi-page packages should be previewed via short-lived (15 min) access URLs, streamed, not fully buffered into VB state.
- Badge computation runs client-side from Expiry Date to avoid extra calls.

## 5. Developer reference

### 5.1 Files to change

- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-detail-page.json` / `.html` / `.js` — add Certifications tab, table, badges, Overall status, Last Synced, Refresh from Fusion.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-detail-page-chains/vbEnterChain.js` — call the new certifications load.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-detail-page-chains/loadCertificationsChain.js` — **NEW**.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-detail-page-chains/syncCertificationsChain.js` — **NEW**.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-detail-page-chains/viewCertEvidenceChain.js` — **NEW** (or reuse `viewAttachmentChain`).
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-unit-detail-page.json` / `.html` / `.js` — surface certifications at serial-unit level.
- `webApps/vbredwoodapp/flows/equipment-foundation/pages/equipment-master-page.json` / `.html` / `.js` — add Overall Qualification Status column (grid page present in app list).
- Request creation page (`customer-portal/project-create-request` and/or `customer-portal/customer-create-req`) `.json`/`.html`/chains — add RED warning dialog + override justification.
- `webApps/vbredwoodapp/resources/js/certifications.js` — **NEW** module: status computation, worst-case rollup.
- Service connection definitions for eqpt — add **NEW** endpoints `listCertifications`, `getOverallQualStatus`, `syncCertificationsFromFusion`.

### 5.2 Existing patterns to reuse

- **Attachments dialog** on equipment-unit-detail (`openAttachmentsChain`, `loadAttachmentsChain`, `uploadAttachmentChain`, `removeAttachmentChain`, `viewAttachmentChain`, `downloadAttachmentChain`) — for certification evidence and inline multi-page preview.
- **equipmentAttachments.js** — shared HEADER/LINE attachment rules.
- **requireFullAccessChain** — write-access guard.
- **Refresh from Fusion** spinner + toast pattern [FDD 7.2.6A].
- **currentUser.js** — signed-in user for override logging.
- **bipService/runBIPReport** — existing BIP SOAP pattern if/when RPT-13 is added.

### 5.3 Build steps

1. Define and stand up the NEW eqpt endpoints (list, overall, sync) and the `EQR_CERTIFICATION` object.
2. Add `certifications.js` with status/rollup logic.
3. Build `loadCertificationsChain` and wire it into `equipment-detail` `vbEnterChain`.
4. Add the Certifications tab/table, badges, Overall status and Last Synced to `equipment-detail`.
5. Add `syncCertificationsChain` and the Refresh from Fusion action with spinner/toast and error logging.
6. Reuse the Attachments dialog for certification evidence and multi-page inline preview.
7. Add the Overall Qualification Status column to `equipment-master`.
8. Add the RED warning dialog + override justification to the request creation page.
9. Resolve the hard-block vs warning conflict (Section 6) before wiring allocation/shipment blocks.

### 5.4 Test plan

**API scenario (calls in order):**
1. `GET getEquipriteV1EquipmentMasterById {id}` — load master.
2. `GET listCertifications {entityName, entityId}` — returns certification rows.
3. `GET getOverallQualStatus {equipmentIds}` — returns rollup badge.
4. `POST syncCertificationsFromFusion {entityId}` — Fusion pull; verify Last Synced updates and status/type/period populated.
5. `GET listEquipmentAttachments {entityName, entityId}` — evidence list.
6. `GET getCommonDocumentAccessUrl {docId}` — inline preview URL.
7. `POST uploadEquipmentAttachment` (multipart) — upload multi-page package; re-list shows it.

**UI checks:**
- Certifications tab renders all records with correct badge per the 30-day rule.
- Overall Qualification Status badge is worst-case and matches grid column.
- Multi-page package opens inline in the iframe preview; download works.
- Refresh from Fusion shows spinner then success/failure toast; failure shows Retry and logs to EQR_ERROR_LOG.
- RED equipment at request creation raises the confirmation dialog; override requires justification and is restricted to Equipment Manager.
- READ_ONLY user can view but not edit/sync.

## 6. Assumptions and open questions

1. **Hard block vs warning (must resolve before build).** The story requires a HARD BLOCK at allocation and shipment for expired/missing certification, but [FDD 7.2.5A] and [FDD 7.2.6A] mandate only a warning/confirmation dialog with Equipment Manager override. This contradiction needs a ruling from the FDD owner before the allocation/shipment behaviour is built.
2. **Fusion Maintenance qualification sourcing.** Sync of qualification Type, effective period and Status from Fusion Maintenance asset records is in the story but not in the matched FDD excerpts (which cover maintenance work-order status [FDD 7.2.5B] and selective sync [FDD 7.2.6A], not qualification data). The exact field mapping and design authority are open; endpoint `syncCertificationsFromFusion` is marked NEW.
3. **Auto-triggered qualification work orders and type-based validity** (calibration = 1 year, load test = 5 years) are not in the FDD excerpts — design authority unclear; captured as `VALIDITY_MONTHS`/`SOURCE` placeholders.
4. **Multi-page document packages / inline viewing** go beyond the FDD, which covers PDF/image attachments only [FDD 7.2.5A]. Assumed to reuse the existing attachment + access-URL preview; confirm acceptable.
5. **"Missing certification" block criterion** is in the story but not defined in the FDD excerpts — definition needed.
6. **RPT-13 Certification Compliance Report** [FDD 7.15.15] is required by the FDD but omitted from this story — confirm whether it is a separate story or belongs here.
7. **Schedule.** Due date 2026-09-30 predates the assigned 2026-11 A sprint; needs realignment.
8. **Serial-unit vs master level.** Confirm whether certifications are held at master (HEADER) or serial unit (LINE) level, or both, to size the `ENTITY_NAME`/`ENTITY_ID` usage.