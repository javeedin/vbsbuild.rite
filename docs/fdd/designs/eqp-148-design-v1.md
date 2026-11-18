# Functional & Technical Design — EQP-148: Oracle AR Invoice Integration (Section 8.1)

## 1. Overview
This story delivers INT-11, the outbound integration that generates AR (Accounts Receivable) invoices in Oracle Accounts Receivable for external (third-party) customer rentals [FDD 8.1 INT-11]. The integration runs periodically, is gated by two configuration flags, maps EquipRite billing data to the Oracle Fusion `/fscmRestApi/receivablesInvoices` object, and coordinates with RPT-11 so the BI Publisher invoice PDF is attached to the created AR record [FDD 7.15.13][FDD 6.2]. The acceptance target is: an invoice is created in AR, its amount matches EquipRite billing, and the customer account is correct.

The bulk of this story is a back-end/OIC integration (EQP-172 Development). The VBCS app changes are limited to surfacing invoice/billing status to customer and staff users on the existing billing screens; no new invoice-generation UI is added.

## 2. Functional design (FDD)

### 2.1 Business requirement
Generate AR invoices in Oracle Accounts Receivable for external customer rentals via REST API / OIC against `/fscmRestApi/receivablesInvoices` [FDD 8.1 INT-11][FDD 6.2]. The invoice is generated only after all timesheets for the billing period are approved and costs are posted; the invoice number follows the configured sequence prefix (e.g. INV-2026-XXXX); and the RPT-11 BIP PDF is automatically attached to the AR invoice record [FDD 7.15.13]. INT-11 is active only when `AGREEMENTS_ENABLED` and `EXTERNAL_CUSTOMER_ENABLED` config flags are both Yes [FDD 8.1 INT-11].

### 2.2 Scope
In scope:
- Outbound OIC/REST flow (NEW) that reads EquipRite agreement/billing data for a billing period and creates an AR invoice in Oracle Accounts Receivable via `/fscmRestApi/receivablesInvoices`.
- Periodic trigger for the flow [FDD 8.1 INT-11].
- Pre-condition checks: config flags on; all period timesheets approved and costs posted [FDD 7.15.13][FDD 8.1 INT-11].
- Idempotency to prevent duplicate invoices for the same agreement/period, modelled on the INT-08 reprocessing pattern [FDD 9.3.3].
- Coordination with RPT-11 so the BIP invoice PDF is attached to the AR record [FDD 7.15.13].
- Minimal VBCS changes: show AR invoice number / status on the customer **My Billing** page and the **Customer Billing Detail** page, and allow customers to download the invoice PDF [FDD 7.15.13].

Out of scope / to confirm (see 6):
- The RPT-11 BIP report itself and the invoice-number sequence definition, if owned by a separate story.
- Any on-demand "generate now" trigger button (FDD specifies Periodic only) [FDD 8.1 INT-11].
- INT-10 IC Billing (internal rentals) — separate integration [FDD 8.1].

### 2.3 User roles
- **Finance** — audience for RPT-11 / AR invoices; reviews generated invoices in AR [FDD 7.15.13].
- **External Customer (customer portal user)** — views billing status and downloads the invoice PDF from **My Billing** [FDD 7.15.13][FDD 7.18.3]. Portal access is gated by `CUSTOMERS_MODULE_ENABLED` (customersModuleGuardChain) and page RBAC (enforcePageAccessChain).
- **Integration/system account** — the OIC scheduled service account that calls Oracle AR (no interactive UI).

### 2.4 User flow
This integration is system-triggered, not a user action. The periodic flow:
1. On its schedule, the OIC flow (NEW) checks `AGREEMENTS_ENABLED` and `EXTERNAL_CUSTOMER_ENABLED` are Yes; if not, it exits [FDD 8.1 INT-11].
2. For each external agreement with a billing period due, it verifies all period timesheets are approved and costs posted [FDD 7.15.13].
3. It runs the idempotency check (no prior successful invoice for that agreement/period) [FDD 9.3.3].
4. It maps billing data to `/fscmRestApi/receivablesInvoices` (customer account, lines, amounts) and creates the AR invoice [FDD 6.2].
5. The RPT-11 BIP PDF is generated and attached to the AR invoice record [FDD 7.15.13].
6. EquipRite billing records are stamped with the AR invoice number/status.

User-facing view flow (read-only):
1. External customer opens **My Billing** → sees their billed requests list.
2. Customer selects a row → **Customer Billing Detail** shows per-line invoice schedules plus the AR invoice number/status (NEW fields).
3. Customer downloads the invoice PDF [FDD 7.15.13].

### 2.5 Business rules
- INT-11 runs only when `AGREEMENTS_ENABLED` = Yes AND `EXTERNAL_CUSTOMER_ENABLED` = Yes [FDD 8.1 INT-11].
- An invoice is generated only after all timesheets for the billing period are approved and costs are posted [FDD 7.15.13].
- One invoice per agreement/period: no duplicate invoice may be created where a prior successful invoice exists for the same agreement/period [FDD 9.3.3, modelled on INT-08].
- Invoice number follows the configured sequence prefix (e.g. INV-2026-XXXX) [FDD 7.15.13].
- The RPT-11 PDF is automatically attached to the Oracle AR invoice record [FDD 7.15.13].
- The AR invoice customer account must be the external customer's Oracle AR Customer Account (linked via EQR_CUSTOMER_PORTAL_USER → HZ_CUST_ACCOUNTS) [FDD 7.18.3].
- Invoice amount must match the EquipRite billing total for the period (acceptance criterion).

### 2.6 Acceptance criteria
1. Invoice is created in Oracle AR via `/fscmRestApi/receivablesInvoices` for an eligible external agreement/period [FDD 8.1 INT-11][FDD 6.2].
2. The AR invoice total amount matches the EquipRite billing amount for that period.
3. The AR invoice is raised against the correct external customer account.
4. No invoice is created when either config flag is off, or when any period timesheet is unapproved / costs unposted [FDD 8.1 INT-11][FDD 7.15.13].
5. Re-running the flow for an agreement/period that already has a successful invoice does not create a duplicate [FDD 9.3.3].
6. The RPT-11 PDF is attached to the AR invoice record and is downloadable by the customer from **My Billing** [FDD 7.15.13].

## 3. Wireframes

```wireframe
{"screen": "My Billing — invoice status", "page": "customer-portal/customer-my-billing", "sections": [{"title": "My Billing", "fields": [{"label": "Search by request #, customer, or contact...", "type": "search", "value": "", "required": false}], "table": {"columns": ["Request #", "Customer Name", "Status", "Lines", "Contract Number", "AR Invoice #", "Invoice Status"], "rows": 2}}], "actions": ["Open billing detail"], "notes": "NEW read-only columns AR Invoice # and Invoice Status added to the existing billed-requests table; populated from the AR invoice stamped back after INT-11 runs."}
```
The customer scans their billed requests and sees whether an AR invoice has been generated; they click a row to open the detail.

```wireframe
{"screen": "Customer Billing Detail — AR invoice", "page": "customer-portal/customer-billing-detail", "sections": [{"title": "Invoice", "fields": [{"label": "AR Invoice Number", "type": "readonly", "value": "INV-2026-0001", "required": false}, {"label": "Invoice Date", "type": "readonly", "value": "", "required": false}, {"label": "Due Date", "type": "readonly", "value": "", "required": false}, {"label": "Invoice Status", "type": "readonly", "value": "Open", "required": false}, {"label": "Total Amount Due", "type": "readonly", "value": "", "required": false}], "table": {"columns": ["Equipment Name", "Rate Period", "Rate", "Hours/Days", "Line Amount"], "rows": 3}}], "actions": ["Download Invoice PDF"], "notes": "NEW invoice header fields and a Download Invoice PDF action; PDF is the RPT-11 attachment on the AR record [FDD 7.15.13]."}
```
The customer reviews the AR invoice header and lines and downloads the invoice PDF.

## 4. Technical design (TDD)

### 4.1 Pages and components
- **customer-portal/customer-my-billing** (existing) — add two read-only table columns (AR Invoice #, Invoice Status). Backed by the existing `getEquipriteV1ViewsCustomerMyRequests` view; the view (or a NEW view) must expose the invoice fields.
- **customer-portal/customer-billing-detail** (existing) — add AR invoice header fields and a Download Invoice PDF action.
- **No new VBCS page** is required for invoice generation; generation is the OIC flow (back end).
- INT-11 itself is an **Integration (OIC/REST)** artifact, best tracked on the interfaces sheet, consistent with the suggested page in the analysis.

### 4.2 Data model
Objects below are Oracle Fusion standard objects referenced; no new EquipRite custom business object is introduced by this story except optional stamp-back fields (marked NEW).

**Receivables Invoices (Oracle Fusion — `/fscmRestApi/receivablesInvoices`)** [FDD 6.2]
| Field | Type | Key | Notes |
|---|---|---|---|
| InvoiceNumber | text | Y | Follows configured sequence prefix, e.g. INV-2026-XXXX [FDD 7.15.13] |
| BillToCustomerAccount | text | Y | External customer AR account; must match agreement customer |
| InvoiceDate | date | N | Invoice header date |
| DueDate | date | N | Derived from payment terms |
| TransactionType | text | N | AR invoice transaction type (Oracle config) |
| InvoiceLines | array | N | One line per agreement rate line (Equipment, Rate Period, Rate, Hours/Days, Line Amount) [FDD 7.15.13] |
| TotalAmount | number | N | Must equal EquipRite billing total for the period |
| Attachment (RPT-11 PDF) | binary | N | BIP PDF auto-attached to the AR record [FDD 7.15.13] |

**EquipRite agreement/billing stamp-back (eqpt — NEW fields)**
| Field | Type | Key | Notes |
|---|---|---|---|
| arInvoiceNumber | text | N | NEW — AR invoice number stamped after successful creation |
| arInvoiceStatus | text | N | NEW — Open / Paid / Overdue, mirrored for display [FDD 7.15.13] |
| arInvoicedPeriod | text | N | NEW — agreement/period key used for the idempotency check [FDD 9.3.3] |

### 4.3 Integration touch points
| # | System | Endpoint or report | Method | Purpose | Sends | Uses from the answer |
|---|---|---|---|---|---|---|
| 1 | Oracle Accounts Receivable (NEW INT-11 flow) | `/fscmRestApi/receivablesInvoices` | POST | Create the AR invoice for an external agreement/period | Customer account, invoice header, invoice lines, amounts | Created InvoiceNumber, invoice id |
| 2 | Oracle AR (Customers) | `/crmRestApi/accounts` | GET | Resolve/confirm external customer AR account [FDD 6.2] | Customer ref / account no. | BillToCustomerAccount |
| 3 | BI Publisher — RPT-11 | AR Invoice Report (NEW / coordinate) | Generate | Produce invoice PDF and attach to AR record [FDD 7.15.13] | Customer, invoice period, agreement ref | PDF attachment on AR invoice |
| 4 | eqpt | `GET /equiprite/v1/views/customer-my-requests` (getEquipriteV1ViewsCustomerMyRequests) | GET | Feed My Billing list; must expose AR invoice #/status | page, size | arInvoiceNumber, arInvoiceStatus |
| 5 | eqpt | AR invoice stamp-back endpoint (NEW) | PATCH | Write arInvoiceNumber/arInvoiceStatus back to agreement/billing | agreement id, period, invoice no./status | — |
| 6 | eqpt | Config flags read (`AGREEMENTS_ENABLED`, `EXTERNAL_CUSTOMER_ENABLED`) | GET | Gate INT-11 execution [FDD 8.1 INT-11] | — | flag values |

### 4.4 Action chains and modules
- **OIC flow (NEW)** — periodic orchestration: read flags → select due external agreements → validate timesheets approved & costs posted → idempotency check → POST `/fscmRestApi/receivablesInvoices` → trigger RPT-11 PDF attach → stamp back via NEW PATCH. No VBCS chain owns invoice generation.
- **customer-my-billing** — `BilledRequestInitChain` (existing) loads the billed-requests view; no new chain if the view carries the invoice fields. `customersModuleGuardChain` / `enforcePageAccessChain` remain as gates.
- **customer-billing-detail** — its init chain (existing) to be extended to bind AR invoice header fields and a NEW DownloadInvoicePdfChain to fetch the RPT-11 PDF.
- Reuse module **fetchAllPages** (`webApps/vbredwoodapp/resources/js/fetchAllPages.js`) when reading paged lists, per existing pattern.

### 4.5 Security and roles
- Customer portal pages remain guarded by `customersModuleGuardChain` (`CUSTOMERS_MODULE_ENABLED`) and `enforcePageAccessChain` (RBAC deep-link guard); the `externalProjectAssignGuardChain` continues to withdraw the billing screen when `EXTERNAL_PROJECT_ASSIGN_ENABLED` is ON.
- Customers may only see invoices for their own account; enforced by the customer-portal session link to their AR Customer Account (HZ_CUST_ACCOUNTS) [FDD 7.18.3].
- The OIC flow runs under a dedicated integration service account with AR create privileges; not an interactive user.
- INT-11 is further gated by `AGREEMENTS_ENABLED` and `EXTERNAL_CUSTOMER_ENABLED` [FDD 8.1 INT-11].

### 4.6 Error handling and messages
- Config flags off → flow exits cleanly, no error, no invoice [FDD 8.1 INT-11].
- Period has unapproved timesheets or unposted costs → skip that agreement, log "Invoice not generated: timesheets not approved / costs not posted" [FDD 7.15.13].
- Duplicate detected (prior successful invoice for agreement/period) → skip, log and continue; no duplicate created [FDD 9.3.3].
- AR POST failure → mark period as failed; flow re-invokes with the original payload on reprocess, preconditioned on no existing invoice (idempotency) — pattern per INT-08 [FDD 9.3.3].
- UI: if no AR invoice yet exists for a billed request, My Billing shows a blank/"Pending" invoice status; Download Invoice PDF is disabled until the PDF attachment exists.

### 4.7 Performance and limits
- Periodic batch run; scope by billing period, not real-time per rental [FDD 8.1 INT-11].
- Paged reads of agreements/billing use `fetchAllPages` to avoid dropping records beyond the first page (same rationale as `loadEquipmentClassesChain`).
- My Billing currently loads with `size=200`; confirm this covers a customer's billed requests, else paginate.
- Oracle AR REST throttling/batch limits apply — the OIC flow should process agreements in controlled batches.

## 5. Developer reference

### 5.1 Files to change
- `webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page.json` — add AR Invoice # and Invoice Status columns to the Requests table.
- `webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page.html` — render the two new columns.
- `webApps/vbredwoodapp/flows/customer-portal/pages/customer-billing-detail-page.json` / `.html` / `.js` — add AR invoice header fields and the Download Invoice PDF action (page files exist under `customer-portal/pages/`).
- `webApps/vbredwoodapp/flows/customer-portal/pages/customer-billing-detail-page-chains/DownloadInvoicePdfChain.js` — **NEW** chain to retrieve the RPT-11 PDF attachment.
- OIC integration project for INT-11 — **NEW** (goes to the integration repo / OIC, not the VBCS app).
- eqpt service: **NEW** AR invoice stamp-back PATCH endpoint and the view fields `arInvoiceNumber` / `arInvoiceStatus` on `views/customer-my-requests` (back-end, eqpt).

### 5.2 Existing patterns to reuse
- **Idempotency / reprocessing** — model INT-11 on the INT-08 IC Billing reprocess rule: "no prior invoice for same period" [FDD 9.3.3].
- **Config-flag page/flow gating** — `agreementsFlagGuardChain` (AGREEMENTS_ENABLED) and the module-guard pattern (`customersModuleGuardChain`) show how flags gate behaviour; apply equivalent flag reads in the OIC flow.
- **Paged reads** — `fetchAllPages.js`.
- **Oracle Fusion REST LOV** — the `ProjectLOV/getFscmRestApiResources11_13_18_05ShippingCustomersLOV` / `/crmRestApi/accounts` usage shows how the app resolves customer accounts [FDD 6.2].
- **Billing list loader** — `BilledRequestInitChain` on My Billing already filters to billed requests; extend its row shape rather than adding a new view where possible.

### 5.3 Build steps
1. Confirm `AGREEMENTS_ENABLED` and `EXTERNAL_CUSTOMER_ENABLED` are Yes in configurations [FDD 8.1 INT-11].
2. Add `arInvoiceNumber` / `arInvoiceStatus` / `arInvoicedPeriod` to the eqpt billing/agreement data and expose on `views/customer-my-requests`.
3. Build the NEW OIC flow: flag check → due-agreement selection → timesheet/cost precondition → idempotency check → map to `/fscmRestApi/receivablesInvoices` → POST → RPT-11 attach → stamp-back PATCH.
4. Set the periodic schedule for the flow [FDD 8.1 INT-11].
5. Add the two columns to My Billing and the invoice header + Download PDF to Customer Billing Detail.
6. Wire `DownloadInvoicePdfChain` to the RPT-11 attachment.
7. Move EQP-172 into development and execute the test plan.

### 5.4 Test plan
**API scenario (in order):**
1. Set both config flags Yes; confirm an eligible external agreement with an approved, posted billing period.
2. Run the OIC flow → assert POST `/fscmRestApi/receivablesInvoices` returns 201 with an InvoiceNumber matching the configured prefix.
3. Assert the created invoice `TotalAmount` equals the EquipRite billing total for the period.
4. Assert `BillToCustomerAccount` = the agreement's external customer AR account (resolved via `/crmRestApi/accounts`).
5. Assert the RPT-11 PDF is attached to the AR invoice record [FDD 7.15.13].
6. Re-run the flow for the same agreement/period → assert no second invoice is created (idempotency) [FDD 9.3.3].
7. Turn one flag off → run → assert no invoice is created.
8. With a period that has an unapproved timesheet → run → assert the agreement is skipped and logged.

**UI checks:**
- My Billing shows AR Invoice # and Invoice Status for a billed request after the flow runs; blank/"Pending" before.
- Customer Billing Detail shows invoice header fields and line amounts matching the AR invoice.
- Download Invoice PDF returns the RPT-11 PDF; disabled when no attachment exists.
- A customer cannot see another customer's invoices (portal account scoping) [FDD 7.18.3].
- Page still blocked when `CUSTOMERS_MODULE_ENABLED` is off (customersModuleGuardChain).

## 6. Assumptions and open questions
- **Config-flag gating vs acceptance criteria:** the acceptance criteria do not mention the flag gates; we assume INT-11 must honour `AGREEMENTS_ENABLED` and `EXTERNAL_CUSTOMER_ENABLED` [FDD 8.1 INT-11]. Confirm.
- **Trigger:** FDD says Periodic/Scheduled; the story is silent. We assume scheduled, with no on-demand button. Confirm whether an on-demand run is needed.
- **Reprocessing/idempotency:** FDD 9.3.3 defines this for INT-08 (IC Billing), not INT-11. We assume the same pattern applies to INT-11 — confirm the preconditions/post-conditions for INT-11 specifically.
- **RPT-11 and invoice-number sequence:** confirm whether the BIP report build and the sequence-prefix setup are in this story's scope or a separate story [FDD 7.15.13].
- **View fields:** assumes `views/customer-my-requests` can carry AR invoice number/status, or a NEW billing view is provided (back-end decision).
- **Customer-billing-detail page internals** are not fully listed in the context; field/chain additions assume the standard customer-portal page structure.
- Ownership has changed repeatedly (current assignee JAVEED SHAIK); confirm scope is frozen before EQP-172 starts development.