define([], function () {
  'use strict';

  // Build.Rite's menu: the team's tools for a VB Studio project — your workspace and its app, the work (issues, Jira,
  // standups, follow-ups), the application (its pages with code fix, the FDD, how it flows) and tools (SQL).
  // Everything runs on this PC for the person using it, so every item shows: there is no page access to load.
  //
  // Item:
  //   id          the tab id of the screen, and what the menu and the command bar open
  //   route       { flow, page } of the screen
  //   keywords    extra words the command bar matches
  var PRODUCT = { id: 'buildrite', isBuild: true, name: 'Build.Rite', home: 'issues' };

  var GROUPS = [
    { key: 'workspace', label: 'Workspace', items: [
      // Organizations & projects: the VB Studio organizations the team works in (their sign-in kept encrypted on this
      // PC) and their projects, each added by its Git address (flows/insights projects; desktop/lib/vbs.js).
      { id: 'projects', label: 'Organizations & projects', icon: 'oj-ux-ico-building', route: { flow: 'insights', page: 'projects' },
        keywords: 'setup organization project vb studio visual builder studio git repository branches build jobs sign in connect' },
      // Run console: run your workspace's app and watch what happens — the build, the requests its app makes, its own
      // console — with commands typed like an editor's terminal (flows/insights run-console; desktop/lib/runConsole.js)
      { id: 'run-console', label: 'Run console', icon: 'oj-ux-ico-play', route: { flow: 'insights', page: 'run-console' },
        keywords: 'run console terminal build log output devtools developer tools vs code vscode git status changes sign in login test' }
    ] },
    { key: 'work', label: 'Work', items: [
      // Issues (the first screen): an issue logged against a page, written up and analyzed by the AI against the page's
      // code and the FDD, approved, then applied by the agent on a branch of its own with a pull request; Jira kept up
      // to date (flows/insights issues; desktop/lib/issues.js).
      { id: 'issues', label: 'Issues', icon: 'oj-ux-ico-clipboard-list', route: { flow: 'insights', page: 'issues' },
        keywords: 'issues bugs defects log report fix approve approval ai branch pull request triage out of scope jira' },
      // Your Jira project's backlog read from Jira and analysed (flows/insights jira; services/jira, read only).
      { id: 'jira', label: 'Jira stories', icon: 'oj-ux-ico-list', route: { flow: 'insights', page: 'jira' },
        keywords: 'jira stories backlog epics sprint release analysis acceptance criteria tester gaps' },
      // The daily standup on the Jira backlog, written down and kept in DuckDB on this PC (flows/insights minutes):
      // a meeting's header and lines (tied to a story or generic) with a next action, voice→text and Format by AI,
      // tracked by epic and customer, sent as an email or to Teams.
      { id: 'minutes', label: 'Standup minutes', icon: 'oj-ux-ico-note', route: { flow: 'insights', page: 'minutes' },
        keywords: 'minutes standup meeting notes mom action items attendees epic customer daily scrum voice ai teams email' },
      // Follow-ups drafted on the Jira pages (Copy to follow-up -> Save), kept in DuckDB on this PC (flows/insights
      // followups): a header (title, scope, recipients, when) and the stories.
      { id: 'followups', label: 'Follow-ups', icon: 'oj-ux-ico-email', route: { flow: 'insights', page: 'followups' },
        keywords: 'follow-ups followup email stories sprint reminder close chase saved' }
    ] },
    { key: 'application', label: 'Application', items: [
      // Every VB page of your workspace's app with its technical sheet — screenshot, features, business logic,
      // integrations — and the Jira stories mapped to it, kept in git (flows/insights app-pages).
      { id: 'app-pages', label: 'Application pages', icon: 'oj-ux-ico-layers', route: { flow: 'insights', page: 'app-pages' },
        keywords: 'application pages vb page code technical sheet screenshot business logic integrations rest fusion oic bip chains jira map story developer' },
      // API Scenarios: a page's calls in order, tested purely through the APIs — values handed from one call to the
      // next, each answer checked, every run kept on this PC (flows/insights api-scenarios; desktop/lib/apiScenarios.js)
      { id: 'api-scenarios', label: 'API Scenarios', icon: 'oj-ux-ico-check-circle', route: { flow: 'insights', page: 'api-scenarios' },
        keywords: 'api scenarios test tests rest calls web services sequence order run record results regression bip report check' },
      // Change requests: a change asked of a page — who asked, the customer, the Jira story, the issue — made with Code
      // Fix and followed until it is fixed (flows/insights change-requests; desktop/lib/changeRequests.js)
      { id: 'change-requests', label: 'Change requests', icon: 'oj-ux-ico-edit', route: { flow: 'insights', page: 'change-requests' },
        keywords: 'change requests cr enhancement fix bug request customer jira issue code fix page approve applied saved fixed due priority new page menu knowledge base fdd analytics' },
      // Page Flows (id integrations): every system the app talks to and every call it makes, read from its code — page
      // by page and between systems, saved flows, the data sheet
      // (source → target), the diagrams, a PDF / Excel copy (flows/insights integrations; desktop/lib/integrations.js)
      { id: 'integrations', label: 'Page Flows', icon: 'oj-ux-ico-link', route: { flow: 'insights', page: 'integrations' },
        keywords: 'page flows integrations interfaces saved flows plain english systems source target data sheet rest services endpoints fusion oic bip ords jira diagram landscape pdf excel' },
      // The FDD documents "Analyze with AI" reads (flows/fdd library): uploaded into the project's data and pushed to
      // git, so every user has them; one is the latest.
      { id: 'fdd-library', label: 'FDD library', icon: 'oj-ux-ico-upload', route: { flow: 'fdd', page: 'library' },
        keywords: 'fdd library upload document word pdf version latest git analyze ai sections outline functional design' },
      // Flows explained: every flow of Build.Rite, step by step (flows/insights flows; resources/js/flowsGuide.js).
      { id: 'flows', label: 'Flows explained', icon: 'oj-ux-ico-network-flow-diagram', route: { flow: 'insights', page: 'flows' },
        keywords: 'flows explained guide steps issues code fix approval branch pull request data branch who does what' }
    ] },
    { key: 'tools', label: 'Tools', items: [
      // AI Assistant: any question about the app — its code, integrations and processes — answered from the workspace,
      // formatted, with its sources (flows/insights assistant; desktop/lib/assistant.js); Ctrl+J from anywhere
      { id: 'assistant', label: 'AI Assistant', icon: 'oj-ux-ico-chat', route: { flow: 'insights', page: 'assistant' },
        keywords: 'ai assistant ask question chat copilot help explain code integration process how does where is claude gpt answer' },
      // SQL against an Oracle database from this PC, as in SQL Developer (flows/insights sql): the desktop app connects
      // for it (desktop/lib/oracleSql.js), so it works in the desktop app only.
      { id: 'sql', label: 'SQL', icon: 'oj-ux-ico-database', route: { flow: 'insights', page: 'sql' },
        keywords: 'query database oracle developer tns select statement worksheet' },
      // Fusion SQL: read-only SQL on an Oracle Fusion Cloud pod through one BI Publisher query-runner report, with the
      // schema browser, saved queries and Ask AI (flows/insights fusion-sql; desktop/lib/fusionSql.js), desktop app only
      { id: 'fusion-sql', label: 'Fusion SQL', icon: 'oj-ux-ico-file-code', route: { flow: 'insights', page: 'fusion-sql' },
        keywords: 'fusion sql bi publisher bip query runner dbmsxmlgen saas pod schema tables views select ask ai cloud erp scm' },
      // BIP Reporting: the BI Publisher catalog of a Fusion pod — browse, search, run reports (in date buckets), runs kept
      // on this PC, favourites, a dashboard (flows/insights bip; desktop/lib/bipReports.js), desktop app only
      { id: 'bip', label: 'BIP Reporting', icon: 'oj-ux-ico-chart-bar', route: { flow: 'insights', page: 'bip' },
        keywords: 'bip bi publisher reports reporting catalog run report xdo xdm data model buckets dashboard csv pdf excel fusion oracle' },
      // AI settings: Claude Code on your subscription or an API key — the default for everything, and one per feature
      // (flows/insights ai; desktop/lib/aiSql.js)
      { id: 'ai', label: 'AI settings', icon: 'oj-ux-ico-lightbulb', route: { flow: 'insights', page: 'ai' },
        keywords: 'ai llm claude code subscription api key anthropic openai gemini oci model tokens cost code fix issues default' }
    ] }
  ];

  var ITEMS = {};
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { it.group = g.key; it.built = true; ITEMS[it.id] = it; }); });

  // Screens that open a record in a tab of its own: the tab id is kind + ':' + key, so a record opens once.
  var RECORDS = {
    // API Scenarios on one page ({ page: app/flow/page, label }), from a journey's linked page: its scenarios and APIs
    // in a tab of its own (flows/insights api-scenarios, its page variable given).
    // One API scenario ({ scId, page, title }) — a row of the list, or + New scenario ('new-…', the page it starts on):
    // its header and its Main scenario / Flow / Runs, in a tab of its own.
    'api-scenario': { flow: 'insights', page: 'api-scenarios', icon: 'oj-ux-ico-check-circle', navId: 'api-scenarios',
      key: function (p) { return p ? String(p.scId || '') : ''; },
      title: function (p) { return (p && p.title) || 'Scenario'; } },
    // One change request ({ crId, page, title }) — a row of the list, or + New change request ('new-…'): its header and its
    // Request / Code fix / History, in a tab of its own (flows/insights change-requests).
    'change-request': { flow: 'insights', page: 'change-requests', icon: 'oj-ux-ico-edit', navId: 'change-requests',
      key: function (p) { return p ? String(p.crId || '') : ''; },
      title: function (p) { return (p && p.title) || 'Change request'; } },
    // One saved flow ({ flowId: FL-0001, title }) — from Page Flows → Saved flows, or just saved from By page: its
    // diagram (plain English or technical), editor, comments, versions and a check against the app (flows/insights saved-flow).
    'saved-flow': { flow: 'insights', page: 'saved-flow', icon: 'oj-ux-ico-link', navId: 'integrations',
      key: function (p) { return p ? String(p.flowId || '') : ''; },
      title: function (p) { return (p && p.title) || 'Saved flow'; } },
    'api-scenarios-page': { flow: 'insights', page: 'api-scenarios', icon: 'oj-ux-ico-check-circle', navId: 'api-scenarios',
      key: function (p) { return p ? String(p.page || '') : ''; },
      title: function (p) { return 'API · ' + ((p && p.label) || String((p && p.page) || '').split('/').pop() || 'page'); } },
    // One Jira sprint ({ id: Jira's sprint id, name }), from Jira stories' By sprint: its report in a tab of its own.
    'jira-sprint': { flow: 'insights', page: 'jira-sprint', icon: 'oj-ux-ico-list', navId: 'jira',
      key: function (p) { return p ? String(p.id || p.name || '') : ''; },
      title: function (p) { return 'Sprint ' + ((p && (p.name || p.id)) || ''); } },
    // A VB Studio project ({ key: '<host>/<org>/<project>', name }), from Organizations & projects: its workspaces
    // (Refresh workspaces), its repositories, in a tab of its own (flows/insights vbs-project).
    'vbs-project': { flow: 'insights', page: 'vbs-project', icon: 'oj-ux-ico-folder', navId: 'projects',
      key: function (p) { return p ? String(p.key || '') : ''; },
      title: function (p) { return (p && (p.name || String(p.key || '').split('/').pop())) || 'Project'; } },
    // Set up your workspace (the top bar): a wizard — the VB Studio workspace, the folder on this PC, a preview, then
    // main and working made (flows/insights vbs-setup). One tab.
    'vbs-setup': { flow: 'insights', page: 'vbs-setup', icon: 'oj-ux-ico-settings', navId: 'projects',
      key: function () { return 'setup'; },
      title: function () { return 'Set up your workspace'; } },
    // Jira · Daily progress (Jira stories → Daily progress, the Jira updates bell): what moved in Jira day by day —
    // closed, new, reopened, moved, touched, by whom — in a tab of its own (flows/insights jira-progress). One tab.
    'jira-progress': { flow: 'insights', page: 'jira-progress', icon: 'oj-ux-ico-chart-bar', navId: 'jira',
      key: function () { return 'daily'; },
      title: function () { return 'Jira · Daily progress'; } },
    // "Analyze with AI" for one Jira story ({ key }): the story + its sub-tasks and comments, an AI analysis and a
    // chatbot, in a tab of its own (flows/insights jira-analysis). Opened by the AI icon on a story.
    'jira-analysis': { flow: 'insights', page: 'jira-analysis', icon: 'oj-ux-ico-brain', navId: 'jira',
      key: function (p) { return p ? String(p.key || '') : ''; },
      title: function (p) { return 'AI · ' + ((p && p.key) || 'Story'); } },
    // "Analyze with AI" for several stories at once ({ keys: 'ABC-23,ABC-36' }): the stories, their activity, one AI
    // analysis across them and a chatbot (flows/insights jira-analysis-set). The same set opens the same tab.
    'jira-analysis-set': { flow: 'insights', page: 'jira-analysis-set', icon: 'oj-ux-ico-brain', navId: 'jira',
      key: function (p) { return p ? String(p.keys || '').toUpperCase().split(/[\s,]+/).filter(Boolean).sort().join(',') : ''; },
      title: function (p) {
        var k = p ? String(p.keys || '').split(/[\s,]+/).filter(Boolean) : [];
        return 'AI · ' + (k.length <= 2 ? k.join(', ') : k.length + ' stories');
      } }
  };

  /** The page the tab of a menu item shows. */
  function routeOf(it) {
    return it ? { flow: it.route.flow, page: it.route.page, params: {} } : null;
  }

  /** Every item shows (the arguments are kept so the screens' calls stay as they are). */
  function itemVisible(it) { return !!it && !!ITEMS[it.id]; }

  /** The menu: every group with its items. */
  function visibleGroups() {
    return GROUPS.map(function (g) { return { key: g.key, label: g.label, items: g.items.slice() }; });
  }

  /** Command bar: menu items matching the text (label, group, keywords), best first. */
  function search(text, groups) {
    var q = String(text || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    (groups && groups.length ? groups : GROUPS).forEach(function (g) {
      g.items.forEach(function (it) {
        var label = it.label.toLowerCase();
        var hay = label + ' ' + (g.label || '').toLowerCase() + ' ' + (it.keywords || '');
        var score = label.indexOf(q) === 0 ? 0 : (label.indexOf(q) !== -1 ? 1 : (hay.indexOf(q) !== -1 ? 2 : -1));
        if (score >= 0) out.push({ id: it.id, label: it.label, icon: it.icon, group: g.label, score: score });
      });
    });
    return out.sort(function (a, b) { return a.score - b.score || a.label.localeCompare(b.label); });
  }

  return {
    GROUPS: GROUPS,
    ITEMS: ITEMS,
    RECORDS: RECORDS,
    item: function (id) { return ITEMS[id] || null; },
    product: PRODUCT,
    routeOf: routeOf,
    newUrl: function () { return ''; },
    visibleGroups: visibleGroups,
    itemVisible: itemVisible,
    customerOnly: function () { return false; },
    search: search
  };
});
