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
| **Work** | **Issues**: an issue is logged against a page, then written up and analysed by the AI against the page's code and the FDD. Once approved, the agent applies it on a branch with a pull request, and Jira is kept up to date. **Jira stories**, sprints, daily progress and AI analyses of one story or several. **Standup minutes** and **Follow-ups**. |
| **Application** | **Application pages**: every VB page of your workspace's app, with its technical sheet, screenshots, navigation maps, page code (lines changed since VB Studio are highlighted) and **Code fix**. Code fix writes a change into your working folder only after you approve it, and marks each change in the code with who asked for it, when, and its issue or Jira story. **API Scenarios**: a page's web services put in order and tested through the APIs alone, with no need to open the page (see below). **FDD library**: the FDDs that Analyze with AI reads. **Flows explained**: how Build.Rite's own flows work. |
| **Tools** | **SQL**: a worksheet against an Oracle database, with Ask AI. **AI settings**: which AI Build.Rite asks, either **Claude Code** on your Claude subscription (no API key, no per-call cost) or an **API key** paid per use (Anthropic, OpenAI, Gemini, OCI Generative AI, or any OpenAI-compatible service). You pick one default for everything, and can give a feature its own: Code fix, Issues, Analyze with AI, Application pages, Standup minutes or SQL. **Try it** checks each one; Code fix also has a quick switch on its own tab. |

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

**Application → API Scenarios**, or the **API** button beside any page in Application pages. Pick a page and press
**Draft from the page**: Build.Rite reads the page's code and lays out its calls in the order the page makes them. Calls
made on entry come first, then the rest; calls that only read come before calls that change data. BI Publisher is run as
the page's report, at the point where the page calls it, with the report's parameters taken from the code.

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
  result of each step and its answer. The runs list shows a page's history; the scenario card shows its last run.

- **The page your app's window shows.** An app can have two pages with one title (two "Create Equipment Request"s,
  each with its own lists). When you come back from your app's window (▶ Run), API Scenarios says which page it is on
  and offers to test that one; the page list marks it, and marks pages that share a title.

Calls go out the same way as from the API tester: through the app's own backends, with the app's login.

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
