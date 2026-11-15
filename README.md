# Build.Rite data

What the Build.Rite desktop app saves for everyone, kept apart from the code (the app commits and pushes here, never
to a code branch):

- `webApps/buildrite/resources/pages`: Application pages: every VB page's technical sheet, screenshots, AI
  explanation and the Jira stories mapped to it (`catalog.json`, `sheets/`, `screens/`).
- `docs/fdd` and `webApps/buildrite/resources/fdd`: the FDD library: the documents and their outlines.
- `code-history`: Code fix: every change made to a page's code from the app — what was asked, the AI's analysis, the
  diff, who approved and applied it, the tests, the commit (or the undo).
- `issues`: Issues: each issue logged in Build.Rite, its write-up, the AI's verdict, the approval, the branch and pull request.

The app checks this branch out next to the code, in `<project>/.buildrite-data` (a git worktree), and merges what
others pushed before it pushes. Nothing here is code: do not merge this branch into a code branch.
