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
| **Application** | **Application pages**: every VB page of your workspace's app, with its technical sheet, screenshots, navigation maps, page code (lines changed since VB Studio are highlighted) and **Code fix**. Code fix writes a change into your working folder only after you approve it — approving applies it, checks it and saves it there (a commit on this PC, never pushed) — and marks each change in the code with who asked for it, when, and its issue or Jira story. **Change requests**: a change asked of a page, with who asked, the customer, the Jira story and the issue, made with Code fix and followed until it is fixed (see below). **API Scenarios**: a page's web services put in order and tested through the APIs alone, with no need to open the page (see below). **FDD library**: the FDDs that Analyze with AI reads. **Flows explained**: how Build.Rite's own flows work. |
| **Tools** | **AI Assistant** (Ctrl+J from anywhere): ask anything about your app — its code, integrations and processes — answered from your workspace, formatted, with its sources (see below). **SQL**: a worksheet against an Oracle database, with Ask AI. **Fusion SQL**: read-only SQL on your Oracle Fusion Cloud pod through one BI Publisher report, with a schema browser, saved queries and Ask AI (see below). **AI settings**: which AI Build.Rite asks, either **Claude Code** on your Claude subscription (no API key, no per-call cost) or an **API key** paid per use (Anthropic, OpenAI, Gemini, OCI Generative AI, or any OpenAI-compatible service). You pick one default for everything, and can give a feature its own: Code fix, Issues, Analyze with AI, Application pages, Standup minutes, SQL or the AI Assistant. **Try it** checks each one; Code fix also has a quick switch on its own tab. |

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

While it starts, a splash plays the logo (`desktop/splash.html`): the BR box and *Build.Rite* letter by letter, then
*Build* flips to *Write* (the box to WR) — *Write.Rite* — and once the app has loaded the box opens out into the app.
It plays for about seven seconds at least and never keeps the app hidden for more than 18. Set `BUILDRITE_NO_SPLASH=1`
to start without it.

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
- **Each step is a simple card.** Its number (green, red or amber after a run), its name (click to rename), ▶ Run, and
  one line with the API: method, name and the request in full. Chips say what kind of step it is (*List of values ·
  Customer → {{customer}}*, *Shown only in some cases*, *changes data*), and the **ⓘ** beside each explains it (the
  list's fields, the condition the page shows it on, the request, how to pick a value). A list of values has its picker
  on one row. One line says what the step **sends**, **hands on** and **checks**; **Edit** opens those fields (each
  with its own ⓘ). A step missing a value says so (⚠ Give P_CUSTOMER_ID a value) and opens by itself.
- **The page's APIs.** The list icon beside *Page it tests* opens the APIs the page uses: how many REST calls, BI
  Publisher reports, lists of values and calls that change data it has, which of them are steps of this scenario (in the
  order they run, with how each went), and every API in the order the page makes them, with **+ Add** for the others.
- **Test report: PDF and Excel.** **Test report › PDF / Excel** in the scenario's header (beside Save), on a run's results, or
  **Report** on a run in Runs. Before any run it is the **test script**: the steps in the order they run, each with its
  API and request, the values it sends, what it hands on and the checks it will make (NOT RUN). After a run, *Last run's
  results* or *Test script* chooses what it shows. It
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

## Change requests: a change asked of a page, made with Code fix

**Application → Change requests** lists every change asked of a page of your app: its number (CR-0001…), title, kind
and priority, the page, the customer, who asked and when, its Jira story and issue, its status and when it was fixed
or is due. The chips filter it (New, In progress, Fixed, On hold, Closed) and Find searches every field.

**+ New change request** (or a row) opens one in a tab of its own:

- **The header**: the page it is for (and a button to its sheet in Application pages), kind (fix a bug, enhance,
  change), priority, customer, requested by and on, Jira story, issue, due on, fixed on and by, and its state (open, on
  hold, closed, rejected). Save gives it its number.
- **Request**: what should change, said as you would to a developer, and notes. **Save & ask the AI to make it** opens
  Code fix with the AI's proposal for that page.
- **Code fix**: the same as Application pages → Code fix. The AI's analysis, the exact change and the checks on it;
  ask again with what to change; **Approve and apply** writes it into your workspace's working folder, checks it and
  saves it there. Then **What now?**: 1 **Try it** opens the page from your working copy, 2 **Send it on** (Apply to
  main, then Push, in its project's tab), or **Undo**, which reverts the saved commit. If a check fails, the change is
  written but not saved, so you can look first (**Save anyway** or **Undo**). Every attempt is kept with the request.
- **How it was fixed**: the change told as a story — what was asked, how it worked before, what was changed and why,
  after the change, the risks, how it was tested (the steps to try, the checks and tests that ran) and where the change
  is now — with its proof (files, lines added and taken away, checks passed, the commit) and every step with who and
  when. Under it **the code**: each changed file **in full**, the change marked line by line — *With the change* (added
  lines green, changed amber, a red line where lines were taken away, the change note tinted), *As it was* (what was
  taken away struck through in red, a green line where lines were put in) or *Only the change* — with Previous / Next
  change. It comes from the change's commit once it is saved (so it still shows after an undo), from the folder while
  it is applied, or from the AI's proposal before it is written.
- **History**: every step (created, asked the AI, saved in working, undone, state changed), when and by whom.

Its status follows its Code fix — New, Proposed, Applied, **Fixed** once its change is saved (fixed on and by fill in
by themselves), Undone — unless you set it On hold, Closed or Rejected. A request kept past its due date and not fixed
says *overdue*. Change requests are kept on this PC per VB Studio project.

### A new page, linked into your app's menu

A change request of the kind **New page** makes a page that is not there yet. Pick the page it is **like** (in the
header): the new one gets the same template, layout and style. Then, in **The new page**: its title (the page name and
its files follow it — `flows/<flow>/pages/<name>-page.html`, `.js`, `.json`), its flow, and where it goes in the menu:
a group of your app's menu (or *not in the menu*), its label, its icon and its place (after which item).

Build.Rite does not assume how your app's menu works: it **learns it from the code** — the groups and items of the
menu (an `app-flow.js` like `NAV_GROUPS`, a `nav.js`, the shell page) with each item's route, the flows and their
pages — and finds **every place a page in the menu is registered**: its flow's list of pages, the menu item, the maps
of menu id → flow and page or page → menu id, the navigation chain. **How it gets linked** lists them; links from other
pages (a page that opens it) are kept apart, as a new page does not need them. The AI is told to add the new page to
every one of those places the same way, with the exact text of those files to copy from, and the proposal is checked
for it: the page's files are made, the page is linked in every place, and its label is in the menu — a place left out
is asked again. Approving writes the page and its links in your working folder and saves them, like any Code fix.

**Knowledge base** (a tab of every change request; for a new page, asking the AI asks for it first): what the AI
builds from besides the code. Choose an **FDD of the FDD library** and tick its sections — **functional and technical**
alike (a section whose heading, or a heading above it, says technical design, integration, interface, API, service,
data model, table, report, security, errors… is tagged *Technical*; the chips filter All / Functional / Technical) —
or let **Tick the sections that match the request** choose; add your **notes and rules**. *What the AI will read* shows
the text exactly. (Analyze with AI on a Jira story keeps choosing its FDD as before.)

**Analytics** (the tab beside Requests) works the figures out across every change request: how many, open and fixed,
the average and median time to fix (from the day it was asked to the day its change was saved), how many were fixed at
the first try, the lines and files changed, what is overdue; where they are (status) and what kind of change they are;
**page by page** — requests and how many are fixed, their kinds, open, lines, files, time to fix, overdue, the last one
(a row shows that page's requests in the list); asked and fixed week by week; priority; how old the open ones are; who
fixed them, for which customers, who asks, by area (the app's flows); the files changed most; and the overdue and latest
fixed requests (each opens it).

## Page Flows: how each page works with other systems — flows, data sheet, diagrams

**Application → Page Flows** (it was called Integrations) reads your workspace's app — every page, its chains and modules, and its services
(`services/catalog.json` and each service's OpenAPI document) — and lists every system it talks to and every call it
makes. Nothing is run and nothing is called: it is all read from the code. When the working folder holds more than one
app, it reads the one with the most pages; the header lets you choose another. **Scan again** reads it afresh.

- **The figures**: the systems it talks to, the endpoints, the calls (page × endpoint), the pages that have
  integrations, how many read, write (change data) or run a BI Publisher report, and any call to a service that is
  not in `services/`.
- **Overview**: the **integration landscape** — the app's flows on the left (the source), the systems on the right (the
  target), a line per flow and system, as thick as its calls — and each system's reads, writes and reports.
- **System flows** — between systems, not page by page:
  - **Flow between systems**: the app on one side, each system on the other, and what goes each way **by business
    object** — what the app **sends** it (writes), what it **returns** (reads) and the BI Publisher **reports** it runs.
    The business object is read from each call's path: `…/salesOrdersForOrderHub/{id}/child/lines` is *Sales orders for
    order hub › lines*; `…/requests/{id}/returns/plan` is *Requests › returns*, with *plan* kept as an action on it; an
    OIC integration is named by its integration; a report by its name. **Summary / Detailed** switches it to the
    detailed flow, kept beside it: the app's flows → the systems (as on Overview), and **each system in detail** — the
    pages that call it → its endpoints → the system — with Save SVG and its rows, page by page.
  - **Interfaces**: one line per system and business object (IF-001…) — which way the data goes (*Fusion → app*,
    *app → Fusion*, *app ⇄ Fusion*), read / write / report, its methods, what sets it off (*"Submit" button · when 3
    pages open*), how many endpoints, calls and pages. **Its rows** opens the data sheet on just that interface.
  - **Cross-system flows**: one action — a button, a page opening — that calls two or more systems, in the order its
    code calls them (SF-01…), e.g. *1. reads customers from the shop → 2. runs the customers report in BI Publisher*,
    with where it happens — as steps or as a diagram; and **system to system**: which systems one action calls one
    after the other, how often, and what goes from the first to the second.
- **By page** — page by page: pick a page (find, the list, Previous / Next).
  - **One page — flow**: the page's flow **in swimlanes** — a lane for the page and one per system it calls. Each
    action starts at what sets it off (the page opening, a button…) and goes down call by call, each call in the lane
    of the system it calls (method and business object, e.g. *Oracle Fusion · GET Items* → *your backend · POST
    Items*); a dark arrow marks where it moves on to another system.
  - **One page — details**: the page → **what sets each call off** (the page opening, each button by its label, its data loading — with the chain
  that runs it) → **what it calls, in the order its code calls it** (numbered, method, endpoint, business object; a
  call made through a module says *via* that module) → the systems. Actions that make exactly the same calls are one
  box with every trigger on it. Under the diagram, its calls in order (action, set off by, #, method, endpoint, object,
  system, direction, data sheet row). **All pages → the systems** draws every page with integrations, by flow, with a
  line to each system it calls. A page in the data sheet (or a cross-system flow's *Its page's diagram*) opens here.
- **Data sheet**: the integration data sheet, one row per page and endpoint — its ID (INT-0001…), the **source** page
  and its flow, what **sets it off** (*when the page opens*, a button by its label, or the chain or module that runs
  it), the **target** system and its kind (Oracle Fusion Cloud, Oracle Integration Cloud, BI Publisher, APEX / ORDS,
  Jira, VB Business Objects, a REST service), the method, the endpoint with its summary, what it sends and the report
  it runs, and the direction (Read, Write, Report). Find searches every column; filter by system, flow and direction.
- **Endpoints**: each endpoint once, with the pages that call it.
- **Systems**: one card per system — its base URL, how it signs in (and whether it goes through the proxy), its calls,
  pages and services — with its diagram and its rows in the data sheet.
- **Diagrams**: the landscape; **between systems**; the **cross-system flows**; **all pages**; **a system** (the pages
  that call it → its endpoints → the system); **a page — flow** (swimlanes) and **a page — details**. **Save SVG** keeps the diagram as a
  file.

**PDF** writes the whole report, A4 landscape: a cover with the figures and contents, the landscape, the flow between
systems (with system to system), the interfaces, the cross-system flows, the systems, the data sheet, the endpoints,
flows × systems, a section per system with its diagram, then **Page by page** — all pages → the systems, and for
every page its flow in swimlanes and its details (untick *with every page's flow* beside PDF to leave them out; the page shown in
Diagrams is then added). In the desktop app it is a real PDF; in a browser, Print and choose Save as PDF. **Excel**
writes the same as a workbook: Summary, Interfaces, Cross-system flows, Page flows (each page's actions and their calls
in order), System to system, Systems, Integrations, Endpoints, Flows x systems.

### Plain English and saved flows

**Plain English** (the switch on By page, and on a saved flow) says every step the way a business user would: each
call as a sentence — *Reads the list of projects from Oracle Fusion*, *Starts the Project integration in Oracle
Integration Cloud*, *Promotes the equipment import in your backend* — and each action as when it happens — *When the
page opens*, *When the user clicks "Fetch"*, *When the user selects a row*, *When the user changes the project*. No
paths, methods or chain names. The steps table under the diagram becomes *What happens, step by step* (step, when, what
happens, system).

**Edit & save as flow…** (By page) saves the page's flow under a name. It asks for the **flow name** (required),
its **purpose**, the **business area / process**, the **owner**, the **status** (Draft, In review, Approved, Retired),
the **Jira story** and **tags**, then opens the saved flow in a tab of its own (FL-0001…). **New flow (blank)** on
Saved flows starts an empty one to draw by hand.

**Saved flows** (a tab of Page Flows) lists every saved flow: its ID, name and purpose, the page it came from, its
systems, steps and actions, status and version, owner, when and by whom it was saved, open comments. Find, filter by
status, open, save as a copy, remove; **Check all against the app** compares each with the app's code now and says
whether it still matches.

A **saved flow** has:

- **Flow** — its diagram in swimlanes (plain English or technical), its purpose, and its steps one by one with their
  notes and comments.
- **Edit steps** — its systems (lanes: rename them, set their kind, add one for a step outside the app such as e-mail,
  a file or a person); each action with when it happens in your words (the plain-English wording as a placeholder),
  where it comes from in the app and a note; each step's system, its words (empty keeps the plain sentence), a note,
  moved up or down (into the next or previous action at the ends), removed; **Add a step** (by hand: reads or writes),
  **Add an action**.
  Each step and action **starts with its description** (the automatic wording) — edit it to put it in your words; left
  as it is, or cleared, it keeps following the app's wording.
- **Sticky notes** — anything you want to write on the flow, right on the diagram (the Flow tab): **Sticky note**
  puts one where you are looking — in a free spot, ready to type — and you stay on the Flow tab. Drag a note by its top
  bar to place it anywhere (it moves smoothly with the mouse and stays where you drop it, over what you dropped it
  on); resize it by its bottom-right corner; write in it on as many lines as you like (Enter: a new line); point at it
  for its colour circles (yellow, pink, green, blue); × removes it. Notes added on Edit steps (**Sticky note** on an
  action, or on the whole flow) are laid out under the action's steps or in a band at the top until you drag them;
  choosing an action or a lane for a note on Edit steps puts it back there. They are drawn in the SVG, the PDF (with
  where each sits) and the History, and **Save** keeps where each one is and its size.
- **▶ Run** — each step's call sent for real to the app's backend, with the app's login (through the API tester, as in
  Application pages → Test). **Run** on a step opens its panel under it: where the call goes and as whom, its
  parameters (each filled from the value you used last, its default, or one an earlier answer gave — an id from a list,
  with the others to pick), more parameters, its body. A call that only reads is sent at once: its status, time, size
  and rows, the rows as a table, the answer itself, and a chip beside the step (click it to open the panel again). A
  step that runs a BI Publisher report runs the page's report (its path and parameters read from the page's code), its
  rows decoded. **A call that changes data is never sent by itself**: its panel says so and where it would go, and only
  **Send — it changes data** sends it, after you confirm. **Run** on an action runs its steps in order, each read with
  the values the steps before it gave; **Run the flow** (on the Flow tab) runs every step, shows what it did in words and
  a **Last run** chip per step (a chip opens its panel). Neither ever sends a call that changes data, and a step added by
  hand has no call to run. Runs are not saved with the flow (answers hold live data); the values used are kept on this
  PC for the next run.
- **Details** — name, purpose, area, owner, Jira story, tags, where it came from.
- **Comments** — on the whole flow or one step (shown with its words), resolved and reopened, removed; kept at once.
- **History** — every version (who, when, what changed): view an earlier one, or restore it into the editor; and what
  was done to the flow, step by step.
- **Check against the app** — its steps that came from the app compared with what the page's code does now: steps the
  page no longer makes, calls it makes that the flow does not have (**Add them to the flow**).

**Save** keeps a new version (with *what changed*, if you say) and the one before in History; **Discard** puts back
the version saved; **Save as copy** asks for a name; **SVG** exports the diagram; **PDF** opens a preview first — the
document as it prints (its details, the diagram with its sticky notes, its steps, its open comments), in plain English
or technical, your unsaved changes included — with **Download PDF** and **Print**. Saved flows are kept on this PC per VB Studio project.

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

## AI Assistant: ask anything about your app

**Tools → AI Assistant** (or **Ctrl+J** from any screen) answers any question about your workspace's app: how a page
works, where something is in the code, which systems it talks to and what it sends, how a business process runs end to
end, what to check before a change — and general questions about VB, Oracle Fusion, OIC and BI Publisher. It uses the
AI set up in **AI settings** (its own choice for "AI Assistant", else the default: Claude Code on your subscription or
an API key).

- **Answered from your workspace.** Before each question it gathers what is relevant, never the whole app: the app at a
  glance (its pages, its systems); the pages the question is about (their facts read from the code — action chains,
  calls, reports, variables — and their AI-written sheet); the code files that match, as excerpts with their line
  numbers (rarer words count more, words in a file's name more still); the integrations (interfaces, each page's calls
  in order); saved flows; and the FDD library's sections. Each item is numbered and the AI cites them. A follow-up
  question uses the conversation so far, so "and where is it saved?" knows what "it" is.
- **What to look through**: **Everything**, **Code**, **Integrations** or **Process** (saved flows and design
  documents), and **About a page** to make sure one page is looked at.
- **Formatted to read**: a direct answer first (the key point in bold), then sections, numbered steps, tables, code
  blocks (their language, colours, **Copy**), callouts (Note, Tip, Warning…) and flows between systems drawn as steps.
  A citation chip opens what the AI was given for it (a page's facts, a saved flow, a design section — with **Open** to
  go to it); a file reference such as `webApps/…/LoadCustomersChain.js:7` opens the file with that line marked.
  **Sources** under each answer (and what else was looked at), **follow-up questions** to ask next, **Copy** (as
  written, for Jira or Teams) and **Copy as text** (for an e-mail), **Ask again**.
- **Conversations** are kept on this PC per VB Studio project: listed by their first question, opened again, removed.
- **What leaves the PC**: only the question, the conversation so far and the context gathered for it, sent to the AI
  you chose. An answer is drawn from the HTML it is allowed to make (every text escaped; links only http, https and
  mailto), so nothing an answer says can run in the app.

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
- **Fusion Setups** is a module-by-module checklist of the pod's setup: 83 starter tasks in 13 modules (Enterprise
  Structures, General Ledger, Tax, Cash Management, Payables, Receivables, Fixed Assets, Procurement, Inventory,
  Shipping, Order Management, Users & Security, HCM Core), each with its FSM task. Each task holds a SQL that lists the
  records proving the setup exists. **Check** runs `SELECT COUNT(*) FROM (that SQL)` on the pod in use through the
  runner: **Done** when the count reaches the task's minimum rows, **Not done** below it, **Error** with the pod's own
  words (a missing table, or data roles that do not cover it). **Check the n shown** checks every task of the filter or
  module one after another (Stop at any time). KPI tiles and the module list show what is done; filter by status and
  search. **Records** shows what the SQL finds (1,000 at most) in a grid with search, sort and Excel / CSV, or opens it
  in the SQL tab. **Add task** / Edit: module, name, FSM task, minimum rows, mandatory or optional, **Test the SQL** on
  the pod, or **Ask AI to write it** (the AI looks the tables up and Build.Rite checks its SQL on the pod). Changing a
  task's SQL drops its old result. Results are kept on this PC **per pod**, so PROD and TEST each have their own.
  The checklist exports to Excel or PDF.
- **API calls** shows the last 30 SOAP calls as sent and answered, with passwords as `***`.

Not ported yet from the WMS module: Flows, Watchdogs, Knowledge, Format Results, Datasets and Pipelines (they need the
WMS app's APEX tables and services).

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
| `desktop/` | the Electron desktop app: `main.js` (the window, the stores, ▶ Run, the Run console), `lib/` (the engines: `vbs.js` VB Studio and your workspace, `workPreview.js` building it, `codeFix.js` and `changeNote.js`, `changeRequests.js` (+ `resources/js/crAnalytics.js`, `crKnowledge.js`), `appMenu.js` (your app's menu and where its pages are registered), `issues.js`, `pages.js`, `pageScan.js`, `devserver.js` the local server, `appRoles.js` the roles in your app's code, …) |
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
