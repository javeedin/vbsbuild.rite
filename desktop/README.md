# Build.Rite desktop app

The Electron app that runs Build.Rite on your PC. It has one window, which shows Build.Rite's own VB app
(`webApps/buildrite`, built with `npm run build`). That app is served by a local server in this process
(`lib/devserver.js`) at `http://localhost:18893` (`BUILDRITE_PORT`).

- **Your workspace's app** gets a local server of its own when it runs, on a free port:
  - ▶ Run, Run it, Capture screenshot, Try it, and the Run console's `run` and `build`.
  - `lib/workPreview.js` builds it beside the working folder (`build-rite-preview/`), never inside it.
- **Who the app runs as**: Run as (the Run console). The roles offered are the ones found in the app's code (`lib/appRoles.js`).
- **Its backend login**: **File → Sign in for your app…**, kept encrypted on this PC (`lib/identity.js`).
- **Who you are**: your git name and email on this PC.
- **Menus**:
  - **File**: Sign in for your app…, Forget the app's sign-in, Import settings from another folder…, Open Build.Rite's data folder.
  - **View**: Reload Build.Rite, Web services of your app… (its service connections, with a GET tester), Backend calls… (the local servers' log).
- **Where your data is kept**: the OS's app data folder for **Build.Rite**. Keys and passwords there are encrypted with
  the OS keychain (`safeStorage`); nothing is ever written into a project.

```bash
npm run desktop:fresh
```

`desktop:fresh` builds Build.Rite, then starts this app. `npm run desktop` starts it without building.
