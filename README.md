# Build.Rite

The team's tools for an **Oracle Visual Builder Studio** project, on your PC.

Build.Rite clones a VB Studio workspace into a folder on your PC and works on it there. It builds and runs the
workspace's app from its working folder. It takes issues from "logged" to a fix on a branch, and it shows every page
of the app with its code and a technical sheet. It also keeps the team's Jira, standups and follow-ups in one place.

It is an independent app: it works with any VB Studio project and keeps its own data apart from your projects.

## What it does

| Area | Screens |
|---|---|
| **Workspace** | **Organizations & projects**: your VB Studio organizations (the sign-in is kept encrypted on this PC) and their projects and workspaces. **Set up your workspace**: a wizard that clones a workspace into `main` and `working` (a worktree on its own branch). **▶ Run** and the **Run console**: your workspace's app built from its working folder and run in a window of its own, with the build, its requests and its console shown live, and commands typed as in an editor's terminal. **Run as**: the user and roles the app runs as; the roles offered are the ones found in the app's own code. |
| **Work** | **Issues**: an issue is logged against a page, then written up and analysed by the AI against the page's code and the FDD. Once approved, the agent applies it on a branch with a pull request, and Jira is kept up to date. **Jira stories**, sprints, daily progress and AI analyses of one story or several; under a story's analysis, **Create the functional design** writes its design document as a PDF (see below). **Standup minutes** and **Follow-ups**, with the messages you keep for them (see below). |
| **Application** | **Application pages**: every VB page of your workspace's app, with its technical sheet, screenshots, navigation maps, page code (lines changed since VB Studio are highlighted) and **Code fix**. Code fix writes a change into your working folder only after you approve it, and marks each change in the code with who asked for it, when, and its issue or Jira story. **API Scenarios**: a page's web services put in order and tested through the APIs alone, with no need to open the page (see below). **FDD library**: the FDDs that Analyze with AI reads. **Flows explained**: how Build.Rite's own flows work. |
| **Tools** | **SQL**: a worksheet against an Oracle database, with Ask AI. **Fusion SQL**: read-only SQL on your Oracle Fusion Cloud pod through one BI Publisher report, with a schema browser, saved queries and Ask AI (see below). **AI settings**: which AI Build.Rite asks, either **Claude Code** on your Claude subscription (no API key, no per-call cost) or an **API key** paid per use (Anthropic, OpenAI, Gemini, OCI Generative AI, or any OpenAI-compatible service). You pick one default for everything, and can give a feature its own: Code fix, Issues, Analyze with AI, Application pages, Standup minutes or SQL. **Try it** checks each one; Code fix also has a quick switch on its own tab. |

## Start

You need Node.js 20 or later, and git on your PATH.

```bash
npm install
```

```bash
npm run desktop:fresh
```

`desktop:fresh` builds Build.Rite with Oracle's VB build tool, then starts the desktop app. After that, `npm run desktop`
starts it without building. Build.Rite is itself a Visual Builder app (`webApps/buildrite`), served by a local server
inside the desktop app (`desktop/lib/devserver.js`) at `http://localhost:18893` (set `BUILDRITE_PORT` to change it).

Then:

1. **Organizations & projects**: add your VB Studio organization and sign in.
2. **Workspace** (in the top bar): **Set up your workspace**. Choose a VB Studio workspace and a folder on this PC.
   Build.Rite clones it into `<folder>/<project>-<workspace>/main` and `…/working`.
3. **▶ Run** (in the top bar) builds the workspace's app from its working folder and opens it in a window of its own.
   Choose who it runs as in **Run console → Run as**. **File → Sign in for your app…** sets the backend login its
   service calls go out with, kept encrypted on this PC.

### Who you are

Build.Rite knows you by your git name and email on this PC (`git config user.name` / `user.email`), the same as your
commits. Change notes in the code and approvals carry that name.

### Your settings

Build.Rite keeps everything in its data folder on this PC (**File → Open Build.Rite's data folder**). That covers:

- connections, keys and passwords, encrypted with your OS account;
- standup minutes, follow-ups, issues, Code fix history and Run as.

None of it is ever written into a project.

**File → Import settings from another folder…** copies these files in from another desktop app's data folder, for
example the one you used before. The copies are made on this PC; nothing is moved.

### Its shared data

Some of what Build.Rite saves is shared with the team through git, on a branch of its own: **`buildrite-data`**. That
covers the Application pages' sheets and screenshots, the FDD library and the change history. Build.Rite checks the
branch out next to the code in `.buildrite-data/`, and it commits and pushes there, never to the code branch.

## Every VB app is different: Build.Rite reads it

Build.Rite assumes nothing about an app. When it runs, builds or tests one, it first reads the app's own files
(`desktop/lib/appProfile.js`). You can see what it found in **Run console → Your app**, and **Scan again** reads it
again.

| What it reads | What it does with it |
|---|---|
| Where the VB project is: the working folder itself, or a subfolder of the repo | builds and runs that folder |
| The Visual Builder version (`visual-application.json`) and the build tool the app's `package.json` names | builds with that build tool version: Build.Rite's own copy when it is the same, otherwise one installed once into its data folder (`build-tools/`) and shared by every app on that version |
| The service connections, both the project's (`services/`) and the app's own (`webApps/<app>/services/`), and how each backend signs in | every backend that signs in gets your app's login (**File → Sign in for your app…**), whatever it is named. A backend that doesn't sign in gets no login. |
| The BI Publisher report call, whatever its service is named | the API tester runs the app's reports through it |
| The roles in its code, and the report its users' roles are read from | **Run as** offers those roles; the local server answers that report, and `/_currentuser`, with them |
| Its Component Exchange components: on Oracle's CDN, or only in the exchange | warns about the ones the CDN doesn't serve |
| An App UI extension of Oracle Cloud Applications | says it runs inside those apps, not on its own |

Calls to backends also trust your PC's certificate store, so a corporate network that inspects HTTPS works. A Fusion
404 page answering a call that needs a login is reported as a refused login, because that's how Fusion answers a wrong
password.

## API Scenarios: test a page's web services without opening it

**Application → API Scenarios** opens the list of every scenario: its ID (SC-0001…), name, the page it tests, its
status (Passed, Failed, *(main page)* when only the main page was run, Not run, Draft), when it was last tested and by
whom. Find searches the ID, name and page; the chips filter by status; ▶ Run runs one from the list; 🗑 deletes it.
The **API** button beside a page in Application pages opens the list on that page's scenarios (× on the *Page:* chip
shows them all again). When you come back from your app's window, the list says which page it is on, with
**+ New scenario for it**.

**+ New scenario** opens a scenario in a tab of its own:

- **The header:** its ID (given when first saved), its name, the **page it tests**, its type (happy path, negative…),
  when it was made and by whom, when it was last tested (the main page or the whole flow) and by whom, *Allow writes*,
  and notes. Picking another page for a scenario that has steps asks first: its steps are cleared.
- **Main scenario** tab: **Draft from the page** reads the page's code and puts its calls in the order a user meets
  them: its lists of values in the order the form shows them (a list that depends on another, such as Task on Project
  or Delivery Location on Contract, sends what that one handed on; a field shown in one case only says when), the calls
  run as the page opens, then the calls of the actions that take a user on (Next, Add to cart, Submit…). Calls that
  change data come last, creates first. BI Publisher is run as the page's report, with its parameters from the code.
  **Save & run** runs the main page's APIs alone.
- **Flow — expected pages** tab: the pages the main page leads to. It stays locked until every API of the main page
  has run without failing (a call that changes data and was held back counts as done); the lock says how far it got
  ("0 of its 3 APIs passed, 1 failed"). **Continue anyway** opens it early. Once open:
  - **The pages it leads to**: one column per step out (*This page*, *It leads to*, *Then, 2 pages on*…, up to 5).
    Each page card shows how it is reached ("from Order Workbench · row click"), its APIs and how many passed, and its
    state from the saved scenarios that go through it (*tested: every API passed*, *failed in the last run*, *not
    tested yet*…). The headline counts it up (5 pages · 2 tested · 19 of 33 APIs passed) and says when the flow's
    testing is complete. **Add to the flow** on a page adds the pages on the way to it to this scenario.
  - **Continue the flow** adds the page the last page goes to; its calls come after the main page's, under the page
    they are on, with the values picked so far handed on. **▶ Run the whole flow** runs the main page, then each page.
  - **The flow** bar (1 Order Workbench → 2 Order …) shows each page's steps and how they went in the last run, and
    on hover when and by whom it was linked. **APIs** opens a dialog with that page's calls in this scenario in the
    order they run (**Step n** takes you to that step, in its tab), and every API the page makes, with **+ Add** for
    the ones not in the scenario. On a linked page: **Open in a tab** (that page's own scenarios), **Remove link** (its
    steps go, and any page after it; asked first) and **Reconnect** (linked again, its steps read fresh from its code).
- **Runs** tab: every run of this scenario, newest first (the main page or the whole flow, who ran it, how it went).
- **The page's APIs.** The list icon beside *Page it tests* opens the APIs the page uses: how many REST calls, BI
  Publisher reports, lists of values and calls that change data it has, which of them are steps of this scenario (in the
  order they run, with how each went), and every API in the order the page makes them, with **+ Add** for the others.
- **Test report: PDF and Excel.** **Test report › PDF / Excel** on a run's results (or **Report** on a run in Runs)
  opens a preview of that run's report:
  - **PDF**: the report as it prints (A4 landscape): the verdict, what ran, when and by whom, the counts, the
    scenario's facts, each step with its page, API, result, HTTP status, time and rows, every check with what came
    back, and each request with its answer as evidence (leave *Include each request and its answer* off for a short
    report). **Save PDF** prints it to a PDF in the desktop app; **Print** opens the print dialog.
  - **Excel**: the workbook as sheets (Summary, Steps, Checks, Evidence), previewed like a spreadsheet; **Download
    Excel (.xlsx)** saves it. Long answers are whole in the workbook.

- **Build it yourself from the page's APIs.** **Add from the page's APIs** (Main scenario) lists every REST call and
  BI Publisher report the page's code makes, with where the page uses it (a list of values and its field, as it opens,
  when you go on, elsewhere): **▶ Test** one with its values, **+ Add to scenario** the ones you want, then **Done
  adding**. **Suggest order** proposes the order to run them in: a step after the one that hands it what it
  sends, otherwise as the page runs them, writes last; it says what is missing ("sends {{projectId}}, which no step
  hands on — Add: the Project list") with **+ Add it**, and **Apply this order** puts the steps in it.
- **Delete** a scenario from its header (its tab closes) or from the list (🗑). Its runs stay.
- **Values handed on.** A value one call answers feeds the next: `id = auto:id` takes `id` from the first row of the
  answer, and `{{id}}` uses it. The values the page itself sends with a call are filled in from its code (a page value
  becomes `{{name}}`), and the hint lists every value the call accepts. A value the page gets from the screen before it
  is asked for under **Data**. Each row of Data runs the scenario once, so one scenario can cover many cases.
- **Lists of values, as on the page.** Build.Rite finds each dropdown in the page's code: the field, the call that
  fills it (a ServiceDataProvider, or the call whose answer a chain puts in the dropdown's array), what it shows and
  keeps, and the page value it sets. Its step shows the list's values after a run; pick one as a user would, on that
  step or on any later step that sends it, and it is handed on (`customerRefId = data[id=7].id`). The first value is
  used until you pick one, and a picked value that has gone from the list is reported.
- **Searched as on the page.** The picker is the same component the app uses (`oj-select-single`). A list the page
  loads whole is loaded from the API and filtered as you type. A search as you type (a provider in the page module
  that fires an event, answered by a chain that runs a BI Publisher report or a call with the text) runs that report
  or call with what you type, so you search the real data: `P_SEARCH = harbor` → HARBOR STEEL WORKS INC · CR10042.
  Once picked, the step searches for that value's number, so a full run finds the same row.
- **Each API in full, and ▶ Run.** Every step shows the request as it will go: method, the backend this PC reaches,
  the path and values, with the values known so far filled in. ▶ Run sends that one API now, with the values handed
  on so far (the last run's, the data row, the values picked), and shows what was sent and what came back. It is not
  kept as a run.
- **Checks on every answer.** The status (`2xx`, or `200,404` when a 404 is expected), how many rows, how long it took,
  whether the answer still has the same shape as the example the page was built with, and given fields
  (`items[0].status = OPEN`).
- **Writes held.** A call that changes data runs only when the scenario and the run both allow writes, and never
  against a host that looks like production.
- **Every run kept** on this PC (`userData/api-scenarios`, under each project's hashed key), with who ran it, the
  result of each step and its answer. The Runs tab shows a scenario's history; the list shows its last run.

- **The page as on your screen.** A page can show different fields in different cases (Customer Type Internal:
  a Customer searched in a BI Publisher report; External: the app's own customer refs). Build.Rite reads the
  choices its parts are shown by (lists written in the code, such as Customer Type or Location Type) and each
  field's condition (its oj-bind-if). The scenario starts as the page does (the first value); a step for a field not
  shown in the case chosen is shown as such and skipped when run, and the values chosen are there for the calls.
- **The page your app's window shows.** An app can have two pages with one title (two "Create Equipment Request"s,
  each with its own lists). The pages to pick from in the header say which ones share a title, the page's APIs name
  the other one (**Test that one**), and the list says which page your app's window is on.

Calls go out the same way as from the API tester: through the app's own backends, with the app's login.

## Follow-ups: chase stories by email, with your own messages

On **Jira stories** or a sprint, tick some stories and choose **Copy to follow-up**. The dialog drafts the email: a
greeting that names the assignees ("Dear Priya and Sam,"), a message you pick, the stories as a table, and your sign-off.
Copy it for an email, open it in Outlook, send it through Microsoft 365, or **Save** it to Follow-ups.

The messages to pick from include *Ask to close*, *Status update*, *Overdue — act today*, *After standup*, *Ready for
testing?*, *Sprint closing*, *Provide test scripts*, *Provide proof of testing*, *Need more info*, *Any blockers?*,
*UAT sign-off* and *Write my own*.

**Recipients.** Typing in To or Cc suggests people as you type:

1. The addresses you sent to before from this PC come first (marked *used before*).
2. With Microsoft 365 connected: the people you work with, your saved contacts and, when turned on, the whole company
   directory.
3. Without it, or when it finds no one: Outlook on this PC.

When no one is found, a line under the box says where it looked and what would help: connect Microsoft 365, connect
again because the sign-in expired, or turn on the company directory. Its **Microsoft 365…** link opens the panel below.

**Microsoft 365 in the top bar.** The **365** button shows whether Microsoft 365 is connected (green dot), whether the
sign-in kept on this PC has expired (amber: Microsoft no longer renews it), or whether it is not connected (grey). Its
panel offers:

- **Connect** in a Microsoft sign-in window, or **Use a code instead** (sign in on Microsoft's page in your browser).
- **Send a test email to me** and **Check now** (asks Microsoft, so an expired sign-in shows as expired).
- **Search the whole company** in the suggestions. This needs an admin to approve User.ReadBasic.All for the app;
  connect again after turning it on.
- **Disconnect**.

When no app is set up yet, it asks for the Tenant ID and the App (client) ID of the app registered in Microsoft Entra.
**Change the app** edits them. Nothing but the session's tokens is kept, encrypted on this PC.

**Follow-ups › Messages** is where you keep them. **Manage messages…**, the last chip in the dialog, opens it.

- **+ New message** adds one of your own: the name on its button, a subject and the message. A built-in message can be
  changed (it shows as *changed*, with what it said before), hidden from the dialog, or **put back as it came**.
  **Duplicate** starts a new one from any message; **↑ ↓** set the order the dialog shows them in.
- **Words filled in from the stories**: `{names}` (the assignees' first names), `{count}` (7 stories), `{sprint}`,
  `{due}` (the earliest due date) and `{today}`, in the subject or the message. A preview shows the email with two sample
  stories as you type.
- The dialog reads the messages each time it opens, and an open dialog picks up a change at once.
- They are kept on this PC with your saved follow-ups (DuckDB, `followups.duckdb`, table `followup_messages`).
  **Export** writes yours, your changes and the order to a file; **Import** loads a teammate's file.

## Create the functional design: a story's design document, from your app's real code

Under a story's AI analysis (Analyze with AI), **Create the functional design** writes the story's design document
and saves it as a PDF in the FDD library:

- **What it reads.** The story (its sub-tasks, comments and history), its saved AI analysis, the FDD sections the
  analysis matched, and your working folder: the pages the story is mapped to, then the pages its words name, with
  their fields, lists of values, actions, chains (with their files), modules, REST calls and BI Publisher reports.
  The list of every page of the app comes too.
- **What it writes.** 1 Overview · 2 Functional design (FDD): requirement, scope, roles, user flow, business rules,
  acceptance criteria · 3 Wireframes: each screen drawn (fields, tables, buttons) · 4 Technical design (TDD): pages and
  components, data model, **integration touch points** (a table of endpoints and reports), chains and modules, security,
  errors, performance · 5 Developer reference: the files to change (real paths), the patterns to reuse, build steps, a
  test plan with the API scenario · 6 Assumptions and open questions. The AI may name only what is in your code and
  marks anything new as NEW; it cites the FDD as [FDD n].
- **The document.** An A4 PDF with a cover and a control table (story, sprint, epic, assignee, status, version, date,
  who prepared it, the FDD it read, the pages considered), a table of contents and page numbers. The desktop app prints
  it; its HTML and Markdown are kept too (the Markdown, to edit it).
- **Where it goes.** `docs/fdd/designs/<story>-design-v<n>.pdf|.html|.md`, listed in
  `webApps/buildrite/resources/fdd/designs.json`. That is on the FDD library's branch, and with **Push to git** ticked
  it is committed and pushed there as soon as it is saved (or later, with **Push to git** on the result). Each run is a
  new version.
- **Where you see it.** Under the analysis (each version with Preview, PDF, MD and Open in this PC's PDF reader), and in
  **FDD library → Design documents**: every story's designs with story, sprint, version (the newest marked Latest),
  date, author, the FDD read and size; search, Preview, Download, Delete; the story's key opens its analysis.

## Fusion SQL: read-only SQL on your Fusion pod

Fusion Cloud gives no database connection, so **Tools → Fusion SQL** runs your SELECT inside the pod through one BI
Publisher report, the **query runner**. Build.Rite sends the statement base64-encoded in the report's `P_QRY_STMT`
parameter through BI Publisher's `runReport` web service (SOAP, ReportService v2). The runner's data model runs it with
`DBMS_XMLGEN`, which returns any query as XML rows, and Build.Rite reads them into the grid. It was ported from the WMS
app's Fusion SQL module.

- **Read-only.** Only `SELECT` and `WITH` run, one statement at a time, with no inline PL/SQL. Each statement is
  capped by the row limit (`SELECT * FROM (…) WHERE ROWNUM <= n`). Anything else is refused before it is sent. It runs
  as the Fusion user you sign in with, who needs BI Consumer and the data roles for what you read.
- **Pods.** Add one or more (PROD, TEST…) under **Connection**. For each, choose how to sign in: **your app's login**
  (File → Sign in for your app…), or **a Fusion user of its own**. The password is kept in the PC's keychain and is
  never sent back to the screen. The address of the pod your workspace's app calls is offered for you.
- **Deploy the runner.** If the pod has no runner yet, one click puts the folder, data model and report in the BI
  catalog (`/Custom/BuildRite/…`, through BI Publisher's CatalogService; needs BI Author once) and tests it. A pod that
  already has a DBMS_XMLGEN runner just needs its **Report path** set.
- **The SQL tab.** The schema browser lists owners, then tables, views, packages and more, then columns, indexes,
  foreign keys or arguments. It is read once and cached on this PC until Refresh; **Search Fusion** looks beyond the list.
  The editor runs the selection, or the statement under the cursor (Ctrl+Enter). `{{NAME}}` and `:NAME` placeholders
  ask for a value first and remember it: blank means NULL, dates may be typed in any common format. The grid has
  search, sort and pages of 100; ids show as text and amounts with separators. You can export to Excel, CSV, print or
  copy. Logs and the history of the last 30 statements are kept too.
- **Ask AI** (the AI chosen for SQL in AI settings). Ask in words. The AI looks things up in the pod's data dictionary
  (objects, columns, descriptions, PL/SQL source, dependencies, sample rows) before it writes the SQL. Build.Rite then
  **checks the SQL on the pod** (`… WHERE 1 = 0`): if Fusion refuses it, the error goes back to the AI to fix. Its SQL
  reaches the editor, or runs, only when you choose.
- **Saved queries** are kept on this PC. Export them to a JSON file to share, and Import someone else's.
- **API calls** shows the last 30 SOAP calls as sent and answered, with passwords as `***`.

Not ported yet from the WMS module: Flows, Setups checklist, Watchdogs, Knowledge, Format Results, Datasets and
Pipelines (they need the WMS app's APEX tables and services).

## Run any VB app from its own folder

Your workspace's working folder, or any other VB Studio app on this PC, can run straight from its folder without
opening Build.Rite. It is built from a copy of the folder. In the copy, its Component Exchange list is emptied, so the
components load from Oracle's CDN. The folder itself is never changed. The app is served at one address with its
backends forwarded, and it is built again each time you save a file there: reload the page to see the change.

```bash
# from the app's own folder (VS Code's terminal too):
node C:\path\to\vbsbuild.rite\tools\run-vb-app.js
```

```bash
# or from Build.Rite's folder, naming the app's folder:
npm run vb -- C:\path\to\workspace\working
```

Options:

- `--app <name>` picks the app when the folder has several.
- `--port <n>` changes the port (8890 by default).
- `--open` opens the app in your browser.
- `--user <name> --roles <ROLE,…>` sets who the app runs as. The roles are answered on this PC.
  `BUILDRITE_USER` and `BUILDRITE_ROLES` work too, and `BUILDRITE_FUSION_USER` / `BUILDRITE_FUSION_PASSWORD` set the
  backend login.

## Layout

| Path | What |
|---|---|
| `webApps/buildrite/` | Build.Rite's screens: a Visual Builder app (`app-flow.*`, `pages/shell-page*`, `flows/insights`, `flows/fdd`, `resources/js`, `resources/css`) |
| `desktop/` | the Electron desktop app: `main.js` (the window, the stores, ▶ Run, the Run console), `lib/` (the engines: `vbs.js` VB Studio and your workspace, `workPreview.js` building it, `codeFix.js` and `changeNote.js`, `issues.js`, `pages.js`, `pageScan.js`, `devserver.js` the local server, `appRoles.js` the roles in your app's code, …) |
| `services/jira/` | the Jira service connection the Jira screens read through (read only) |
| `tools/` | `run-vb-app.js` (run a VB app from its folder), `check-tools.js` (build preflight), `get-electron.js`, `fdd.js` (the FDD library from a terminal) |
| `tests/` | dependency-free `node` test suites (`npm test`), and browser tests in `tests/e2e` (Playwright) |

## Tests

```bash
npm test
```

```bash
npm run build
```

```bash
node tests/e2e/run-all.js
```

The unit suites need nothing but Node. The e2e suites drive Build.Rite's built screens in Chromium (Playwright), each
against stand-ins for the desktop app's engines, so they need no VB Studio, Jira or AI account.
