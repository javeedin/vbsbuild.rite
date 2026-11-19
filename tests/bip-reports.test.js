#!/usr/bin/env node
'use strict';
/**
 * BIP Reporting: its rules (webApps/buildrite/resources/js/bipKit.js — the WMS app's BIP engine checks, ported) and the
 * desktop engine (desktop/lib/bipReports.js) against a stand-in pod (tests/fakeFusionPod.js with a BI Publisher catalog):
 * a folder read from Fusion then from this PC, the index walked and updated (added / changed / removed), search, a report's
 * definition (parameters, formats; parameters asked apart when the definition only names them), a run (parameters sent the
 * way BIP wants them, rows, CSV and XML, a big output in chunks, PDF kept as a file), buckets joined into one table, a failed
 * bucket (PARTIAL), Stop, the runs kept on this PC, favourites, dashboard cards (dates that move with today), the data model
 * (plain or zipped), and no password in what is kept.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const E = require('../webApps/buildrite/resources/js/bipKit.js');
const B = require('../desktop/lib/bipReports');
const F = require('../desktop/lib/fusionSql');
const Pod = require('./fakeFusionPod');

const T0 = H.makeAsserter();
const T = Object.assign({}, T0, { eq: (name, a, b) => T0.eq(name, JSON.stringify(a), JSON.stringify(b)) });

(async () => {
  T.section('the rules (bipKit)');
// parameter kinds
T.check('kind: date by dataType', E.kind({ name: 'P_FROM_DATE', dataType: 'Date' }) === 'date');
T.check('kind: date by format string', E.kind({ name: 'P_X', dataType: 'String', dateFormatString: 'MM-dd-yyyy' }) === 'date');
T.check('kind: menu by LOV labels', E.kind({ name: 'P_BU', dataType: 'String', lovLabels: ['A', 'B'] }) === 'menu');
T.check('kind: hidden', E.kind({ name: 'P_H', uiType: 'Hidden' }) === 'hidden');
T.check('kind: number', E.kind({ name: 'P_N', dataType: 'Integer' }) === 'number');
T.check('kind: text', E.kind({ name: 'P_T', dataType: 'String' }) === 'text');
const params = [{ name: 'P_ORG', dataType: 'String', lovLabels: ['GIC', 'VAN'], multiValuesAllowed: true },
    { name: 'P_FROM_DATE', dataType: 'Date', dateFormatString: 'MM-dd-yyyy' }, { name: 'P_TO_DATE', dataType: 'Date', dateFormatString: 'MM-dd-yyyy' },
    { name: 'P_CUSTOMER', dataType: 'String' }, { name: 'P_FLAG', dataType: 'Boolean' }];
T.check('datePairs: FROM / TO found', JSON.stringify(E.datePairs(params)) === JSON.stringify([{ from: 'P_FROM_DATE', to: 'P_TO_DATE' }]));
T.check('datePairs: START / END with a stem', JSON.stringify(E.datePairs([{ name: 'P_START_DATE', dataType: 'Date' }, { name: 'P_END_DATE', dataType: 'Date' }])) === JSON.stringify([{ from: 'P_START_DATE', to: 'P_END_DATE' }]));
T.check('datePairs: two plain dates fall back to first / second', E.datePairs([{ name: 'P_D1', dataType: 'Date' }, { name: 'P_D2', dataType: 'Date' }])[0].to === 'P_D2');
T.check('datePairs: one date → none', E.datePairs([{ name: 'P_AS_OF', dataType: 'Date' }]).length === 0);

// dates
T.check('toDate: ISO', E.iso(E.toDate('2026-03-05')) === '2026-03-05');
T.check('toDate: dd-mm-yyyy', E.iso(E.toDate('05-03-2026')) === '2026-03-05');
T.check('toDate: dd-MMM-yyyy', E.iso(E.toDate('05-Mar-2026')) === '2026-03-05');
T.check('format: MM-dd-yyyy', E.format('2026-03-05', 'MM-dd-yyyy') === '03-05-2026');
T.check('format: dd-MMM-yyyy', E.format('2026-03-05', 'dd-MMM-yyyy') === '05-Mar-2026');
T.check('format: yyyy-MM-dd HH:mm:ss', E.format('2026-03-05', 'yyyy-MM-dd HH:mm:ss') === '2026-03-05 00:00:00');
T.check('format: default ISO', E.format('2026-03-05') === '2026-03-05');
T.check('parse: with the parameter pattern', E.iso(E.parse('03-05-2026', 'MM-dd-yyyy')) === '2026-03-05');
T.check('parse: dd/MM/yy', E.iso(E.parse('05/03/26', 'dd/MM/yy')) === '2026-03-05');
T.check('parse: falls back to ISO', E.iso(E.parse('2026-03-05', 'MM-dd-yyyy')) === '2026-03-05');

// buckets
const d7 = E.buckets({ from: '2026-01-01', to: '2026-01-20', by: 'days', n: 7 });
T.check('buckets: 7 days → 3 ranges, consecutive, inclusive', d7.length === 3 && d7[0].from === '2026-01-01' && d7[0].to === '2026-01-07' && d7[1].from === '2026-01-08' && d7[2].to === '2026-01-20', d7);
const mo = E.buckets({ from: '2026-01-15', to: '2026-04-10', by: 'month' });
T.check('buckets: month → partial first, whole middles, partial last', mo.length === 4 && mo[0].to === '2026-01-31' && mo[1].label === 'Feb 2026' && mo[3].from === '2026-04-01' && mo[3].to === '2026-04-10', mo);
const wk = E.buckets({ from: '2026-01-01', to: '2026-01-14', by: 'week' });
T.check('buckets: week ends on Sunday', wk[0].from === '2026-01-01' && wk[0].to === '2026-01-04' && wk[1].to === '2026-01-11' && wk[2].to === '2026-01-14', wk);
const q = E.buckets({ from: '2025-01-01', to: '2025-12-31', by: 'quarter' });
T.check('buckets: quarters labelled', q.length === 4 && q[0].label === 'Q1 2025' && q[3].to === '2025-12-31', q);
const y = E.buckets({ from: '2024-06-01', to: '2026-02-01', by: 'year' });
T.check('buckets: years', y.length === 3 && y[1].label === '2025' && y[2].to === '2026-02-01', y);
T.check('buckets: none → one range', E.buckets({ from: '2026-01-01', to: '2026-01-31', by: 'none' }).length === 1);
T.check('buckets: swapped dates are put in order', E.buckets({ from: '2026-01-31', to: '2026-01-01', by: 'days', n: 10 })[0].from === '2026-01-01');
T.check('buckets: a bad date → nothing', E.buckets({ from: 'x', to: '2026-01-01', by: 'days' }).length === 0);

// encode
const enc = E.encode(params, { P_ORG: ['GIC', 'VAN'], P_FROM_DATE: '2026-01-01', P_TO_DATE: '2026-01-31', P_CUSTOMER: 'Acme', P_FLAG: true });
T.check('encode: dates in the parameter format', enc.P_FROM_DATE[0] === '01-01-2026' && enc.P_TO_DATE[0] === '01-31-2026', enc);
T.check('encode: multi-value menu stays a list', enc.P_ORG.length === 2 && enc.P_ORG[1] === 'VAN');
T.check('encode: text and boolean', enc.P_CUSTOMER[0] === 'Acme' && enc.P_FLAG[0] === 'true');
T.check('encode: an empty value is left out', E.encode(params, { P_CUSTOMER: '' }).P_CUSTOMER === undefined);
T.check('encode: All on a menu → *', E.encode(params, { P_ORG: ['__ALL__'] }).P_ORG[0] === '*');
T.check('encode: All with useNullForAll → omitted', E.encode([{ name: 'P_X', lovLabels: ['a'], useNullForAll: true }], { P_X: '__ALL__' }).P_X === undefined);

// plan
const plan = E.plan({ params, dateBucket: { fromParam: 'P_FROM_DATE', toParam: 'P_TO_DATE', by: 'month', from: '2026-01-01', to: '2026-02-28' } });
T.check('plan: one run per month with the dates in the parameter format', plan.length === 2 && plan[0].params.P_FROM_DATE[0] === '01-01-2026' && plan[1].params.P_TO_DATE[0] === '02-28-2026', plan);
const plan2 = E.plan({ params, dateBucket: { fromParam: 'P_FROM_DATE', toParam: 'P_TO_DATE', by: 'month', from: '2026-01-01', to: '2026-02-28' }, valueBucket: { param: 'P_ORG', values: ['GIC', 'VAN'] } });
T.check('plan: dates × values = 4 runs, labelled', plan2.length === 4 && plan2[1].label === 'Jan 2026 · VAN' && plan2[1].params.P_ORG[0] === 'VAN' && plan2[3].params.P_FROM_DATE[0] === '02-01-2026', plan2);
T.check('plan: values alone', E.plan({ params, valueBucket: { param: 'P_ORG', values: ['A', 'B', ''] } }).length === 2);
T.check('plan: nothing to split → no buckets', E.plan({ params }).length === 0);

// search
const items = [{ absolutePath: '/Custom/Finance/AR Aging.xdo', displayName: 'AR Aging', type: 'Report' }, { absolutePath: '/Custom/Finance', displayName: 'Finance', type: 'Folder' },
    { absolutePath: '/Custom/SCM/Aging of stock.xdo', displayName: 'Aging of stock', type: 'Report' }, { absolutePath: '/Custom/SCM/Aging of stock DM.xdm', displayName: 'Aging of stock DM', type: 'DataModel' }];
const s1 = E.search(items, 'aging');
T.check('search: reports first, by name', s1.length === 3 && s1[0].type === 'Report' && s1[2].type === 'DataModel', s1.map(x => x.displayName));
T.check('search: every word must match', E.search(items, 'aging finance').length === 1 && E.search(items, 'aging finance')[0].displayName === 'AR Aging');
T.check('search: empty → nothing', E.search(items, '').length === 0);

// data helpers
const rows = [{ BU: 'A', AMT: 10, D: '2026-01-01' }, { BU: 'A', AMT: 5.5, D: '2026-01-02' }, { BU: 'B', AMT: null, D: '' }];
const sum = E.summary(rows, ['BU', 'AMT', 'D']);
T.check('summary: kinds and sums', sum[0].kind === 'text' && sum[0].distinct === 2 && sum[1].kind === 'number' && sum[1].sum === 15.5 && sum[1].nulls === 1 && sum[2].kind === 'date', sum);
const ag = E.agg(rows, { groupBy: 'BU', valueCol: 'AMT', fn: 'sum' });
T.check('agg: sum by group sorted desc', ag[0].key === 'A' && ag[0].value === 15.5 && ag[1].key === 'B' && ag[1].value === 0, ag);
T.check('agg: count', E.agg(rows, { groupBy: 'BU', fn: 'count' })[0].value === 2);
T.check('cardValue: count / sum / first', E.cardValue(rows, { mode: 'count' }) === 3 && E.cardValue(rows, { mode: 'sum', column: 'AMT' }) === 15.5 && E.cardValue(rows, { mode: 'first', column: 'BU' }) === 'A');
T.check('fmtNum', E.fmtNum(1234567.891) === (1234568).toLocaleString() && E.fmtNum(12.5) === (12.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
T.check('fmtMs / fmtBytes', E.fmtMs(125000) === '2 min 5 s' && E.fmtBytes(2048) === '2 KB');


// output formats from the report definition
const DEF1 = { defaultOutputFormat: 'pdf', templates: [{ id: 'T1', formats: [{ key: 'PDF', value: 'pdf' }, { key: 'Excel (*.xlsx)', value: 'xlsx' }] }, { id: 'T2', formats: [{ key: 'PDF', value: 'pdf' }, { key: 'HTML', value: 'html' }] }] };
const DEF2 = { defaultOutputFormat: 'csv', templates: [{ id: 'T', formats: [{ key: 'CSV', value: 'csv' }, { key: 'Data', value: 'xml' }, { key: 'PDF', value: 'pdf' }] }] };
T.check('formats: the templates\' formats in their order + XML data always, no csv unless offered', E.formats(DEF1).map(f => f.value).join(',') === 'pdf,xlsx,html,xml' && E.formats(DEF1)[3].always === true);
T.check('formats: labels from the definition, templates listed per format', E.formats(DEF1)[1].label === 'Excel (*.xlsx)' && E.formats(DEF1)[0].templates.join(',') === 'T1,T2');
T.check('formats: csv kept when a layout offers it, xml not doubled', E.formats(DEF2).map(f => f.value).join(',') === 'csv,xml,pdf');
T.check('formats: no definition → xml only', E.formats(null).map(f => f.value).join(',') === 'xml');
T.check('defaultFormat: the definition\'s default when offered', E.defaultFormat(DEF1) === 'pdf' && E.defaultFormat(DEF2) === 'csv');
T.check('defaultFormat: a default no layout offers → csv when offered, else xml', E.defaultFormat({ defaultOutputFormat: 'rtf', templates: DEF2.templates }) === 'csv' && E.defaultFormat({ defaultOutputFormat: 'rtf', templates: DEF1.templates }) === 'xml');
T.check('dataFormat: a card runs with the default when it is data, else csv when offered, else xml', E.dataFormat(DEF2) === 'csv' && E.dataFormat(DEF1) === 'xml' && E.dataFormat({ defaultOutputFormat: 'pdf', templates: [{ id: 'T', formats: [{ key: 'PDF', value: 'pdf' }, { key: 'CSV', value: 'csv' }] }] }) === 'csv');
T.check('isData', E.isData('csv') && E.isData('XML') && E.isData('data') && !E.isData('pdf'));


  T.section('a stand-in pod with a BI Publisher catalog');
  const ROWS = (from, to, bu) => {
    const out = [];
    for (let d = E.toDate(from); d <= E.toDate(to); d = E.addDays(d, 1)) out.push({ ORDER_ID: '30000' + E.iso(d).replace(/-/g, ''), ORDER_DATE: E.iso(d), BU: bu, AMOUNT: (d.getDate() * 10).toFixed(2) });
    return out;
  };
  const DM = '<?xml version="1.0" encoding="utf-8"?>\n<dataModel xmlns="http://xmlns.oracle.com/oxp/xmlp" defaultDataSourceRef="ApplicationDB_FSCM"><description><![CDATA[Orders by day]]></description>'
    + '<dataSets><dataSet name="Q_ORDERS" type="simple"><sql dataSourceRef="ApplicationDB_FSCM"><![CDATA[SELECT order_id, order_date FROM doo_headers_all WHERE order_date BETWEEN :P_FROM_DATE AND :P_TO_DATE]]></sql></dataSet></dataSets>'
    + '<parameters><parameter name="P_FROM_DATE" dataType="xsd:date" defaultValue=""><input label="From date"/></parameter><parameter name="P_BU" dataType="xsd:string"/></parameters></dataModel>';
  const bip = {
    folders: {
      '/': [{ absolutePath: '/Custom', type: 'Folder' }, { absolutePath: '/Shared Folders', type: 'Folder' }],
      '/Custom': [{ absolutePath: '/Custom/Sales', type: 'Folder' }, { absolutePath: '/Custom/Finance', type: 'Folder' }],
      '/Custom/Sales': [{ absolutePath: '/Custom/Sales/Orders by day.xdo', displayName: 'Orders by day', type: 'Report' }, { absolutePath: '/Custom/Sales/Orders DM.xdm', displayName: 'Orders DM', type: 'DataModel' },
        { absolutePath: '/Custom/Sales/Big extract.xdo', displayName: 'Big extract', type: 'Report' }],
      '/Custom/Finance': [{ absolutePath: '/Custom/Finance/Invoice print.xdo', displayName: 'Invoice print', type: 'Report' }, { absolutePath: '/Custom/Finance/Open invoices.xdo', displayName: 'Open invoices', type: 'Report' }],
      '/Shared Folders': [],
    },
    reports: {
      '/Custom/Sales/Orders by day.xdo': {
        def: { reportName: 'Orders by day', defaultOutputFormat: 'csv', dataModelURL: '/Custom/Sales/Orders DM.xdm', templates: [{ id: 'Data', formats: [['CSV', 'csv'], ['Data', 'xml'], ['PDF', 'pdf']] }],
          params: [{ name: 'P_FROM_DATE', label: 'From date', dataType: 'Date', dateFormatString: 'MM-dd-yyyy', default: '11-01-2026' }, { name: 'P_TO_DATE', label: 'To date', dataType: 'Date', dateFormatString: 'MM-dd-yyyy' },
            { name: 'P_BU', label: 'Business unit', dataType: 'String', values: ['N', 'S'], lovLabels: ['North BU', 'South BU'], multi: true, all: true }, { name: 'P_STATUS', label: 'Status', dataType: 'String' }] },
        run: (fmt, p) => {
          if ((p.P_STATUS || [])[0] === 'BAD') throw new Error('oracle.xdo.XDOException: ORA-01843: not a valid month');
          const from = E.parse(p.P_FROM_DATE[0], 'MM-dd-yyyy'), to = E.parse(p.P_TO_DATE[0], 'MM-dd-yyyy');
          const rows = ROWS(from, to, (p.P_BU || ['*']).join('+'));
          if (fmt === 'csv') return 'ORDER_ID,ORDER_DATE,BU,AMOUNT\r\n' + rows.map((r) => [r.ORDER_ID, r.ORDER_DATE, r.BU, r.AMOUNT].join(',')).join('\r\n') + '\r\n';
          if (fmt === 'xml') return '<?xml version="1.0"?><DATA_DS><P_FROM_DATE>' + p.P_FROM_DATE[0] + '</P_FROM_DATE>' + rows.map((r) => '<G_1><ORDER_ID>' + r.ORDER_ID + '</ORDER_ID><ORDER_DATE>' + r.ORDER_DATE + '</ORDER_DATE><BU>' + r.BU + '</BU><AMOUNT>' + r.AMOUNT + '</AMOUNT></G_1>').join('') + '</DATA_DS>';
          return '%PDF-1.4 orders';
        },
      },
      '/Custom/Sales/Big extract.xdo': {
        def: { reportName: 'Big extract', defaultOutputFormat: 'csv', templates: [{ id: 'CSV', formats: [['CSV', 'csv']] }], params: [] },
        run: () => 'LINE_ID,TEXT\r\n' + Array.from({ length: 25000 }, (_, i) => (i + 1) + ',' + 'line ' + (i + 1) + ' of a long extract with some text in it').join('\r\n') + '\r\n',
      },
      '/Custom/Finance/Invoice print.xdo': {
        def: { reportName: 'Invoice print', defaultOutputFormat: 'pdf', templates: [{ id: 'Invoice', formats: [['PDF', 'pdf'], ['Excel (*.xlsx)', 'xlsx']] }], params: [{ name: 'P_INVOICE', label: 'Invoice', dataType: 'String' }] },
        run: (fmt) => (fmt === 'pdf' ? '%PDF-1.4 invoice' : '<DATA_DS><G_1><INVOICE>INV-1</INVOICE></G_1></DATA_DS>'),
      },
      '/Custom/Finance/Open invoices.xdo': {
        def: { reportName: 'Open invoices', defaultOutputFormat: 'xml', paramsElsewhere: true, params: [{ name: 'P_AS_OF', label: 'As of', dataType: 'Date', dateFormatString: 'yyyy-MM-dd' }] },
        run: () => '<DATA_DS><G_1><INVOICE_NUM>0042</INVOICE_NUM><AMOUNT>15000</AMOUNT></G_1></DATA_DS>',
      },
    },
    dataModels: { '/Custom/Sales/Orders DM.xdm': DM },
  };
  const pod = await Pod.start({ bip });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-bip-'));
  const fq = F.open({ file: path.join(dir, 'fusion-sql.json'), cacheDir: path.join(dir, 'cache'), encrypt: (t) => Buffer.from('sealed:' + Buffer.from(t).toString('base64')),
    decrypt: (b) => Buffer.from(String(b).replace(/^sealed:/, ''), 'base64').toString(), fetch: (u, i) => fetch(u, i), allowHttp: true });
  const p1 = fq.savePod({ name: 'TEST', url: pod.url, login: 'own', username: pod.user, password: pod.password });
  let clock = new Date('2026-11-19T09:00:00Z');
  const S = B.open({ dir: path.join(dir, 'bip'), fq, now: () => clock });
  try {
    T.check('settings: Fusion SQL\'s pods, the defaults', S.settings().pods[0].name === 'TEST' && S.settings().prefs.chunkMb === 8 && S.settings().prefs.indexRoot === '/');

    T.section('the catalog');
    let f = await S.folder(p1.id, '/Custom/Sales');
    T.eq('a folder from Fusion: folders first, then by name; the parent filled in', [f.src, f.items.map((x) => x.displayName), f.items[0].parentAbsolutePath], ['fusion', ['Big extract', 'Orders by day', 'Orders DM'], '/Custom/Sales']);
    const callsBefore = pod.calls.length;
    f = await S.folder(p1.id, '/Custom/Sales');
    T.check('again: from this PC, Fusion not asked', f.src === 'cache' && pod.calls.length === callsBefore);
    f = await S.folder(p1.id, '/Custom/Sales', true);
    T.check('Refresh: from Fusion again', f.src === 'fusion' && pod.calls.length === callsBefore + 1);
    T.check('a folder Fusion does not know: its words', /not found/.test((await S.folder(p1.id, '/Nope')).error));
    T.check('a path must start with /', /starts with/.test((await S.folder(p1.id, 'Custom')).error));
    let s = S.search(p1.id, 'orders');
    T.check('search before an index: the folders read so far', !s.indexed && s.items.length === 2 && s.items[0].type === 'Report');

    T.section('the index');
    const ix = await S.index(p1.id, { root: '/' });
    T.eq('every folder walked once, its items kept', [ix.ok, ix.folders, ix.items, ix.reports, ix.mode], [true, 5, 9, 4, 'full']);
    s = S.search(p1.id, 'invoice');
    T.eq('search the index: every word, reports first', [s.indexed, s.items.map((x) => x.displayName)], [true, ['Invoice print', 'Open invoices']]);
    T.check('…by path too', S.search(p1.id, 'finance open').items.length === 1);
    bip.folders['/Custom/Finance'].push({ absolutePath: '/Custom/Finance/AR aging.xdo', displayName: 'AR aging', type: 'Report' });
    bip.folders['/Custom/Sales'][0].lastModified = '2026-11-18T08:00:00Z';
    bip.folders['/Custom'] = bip.folders['/Custom'].filter((x) => x.absolutePath !== '/Custom/Sales').concat([{ absolutePath: '/Custom/Sales', type: 'Folder' }]);
    bip.folders['/Shared Folders'] = [];
    clock = new Date('2026-11-19T10:00:00Z');
    const up = await S.index(p1.id, { root: '/', update: true });
    T.eq('update: what is new, changed, gone since the last walk', [up.mode, up.added, up.changed, up.removed, up.since], ['update', 1, 1, 0, '2026-11-19T09:00:00.000Z']);
    T.check('a folder Fusion refuses later is answered from the index', (await (async () => { const keep = bip.folders['/Custom/Finance']; delete bip.folders['/Custom/Finance']; const r = await S.folder(p1.id, '/Custom/Finance', true); bip.folders['/Custom/Finance'] = keep; return r.src === 'index' && r.items.length === 3 && /not found/.test(r.warning); })()));

    T.section('a report\'s definition');
    let d = await S.definition(p1.id, '/Custom/Sales/Orders by day.xdo');
    const def = d.def;
    T.eq('its name, default format, data model, templates', [d.src, def.reportName, def.defaultOutputFormat, def.dataModelUrl, def.templates[0].formats.map((x) => x.value)],
      ['fusion', 'Orders by day', 'csv', '/Custom/Sales/Orders DM.xdm', ['csv', 'xml', 'pdf']]);
    T.eq('its parameters, with their kinds', def.parameters.map((p) => p.name + ':' + E.kind(p)), ['P_FROM_DATE:date', 'P_TO_DATE:date', 'P_BU:menu', 'P_STATUS:text']);
    T.eq('a menu: values, labels, several allowed, All', [def.parameters[2].values, def.parameters[2].lovLabels, def.parameters[2].multiValuesAllowed, def.parameters[2].selectAsAll], [['N', 'S'], ['North BU', 'South BU'], true, true]);
    T.eq('the form starts with the defaults (dates as ISO)', E.defaults(def.parameters), { P_FROM_DATE: '2026-11-01', P_TO_DATE: '', P_BU: [], P_STATUS: '' });
    T.eq('formats offered and the one to start on', [E.formats(def).map((x) => x.value), E.defaultFormat(def)], [['csv', 'xml', 'pdf'], 'csv']);
    T.check('again: from this PC', (await S.definition(p1.id, '/Custom/Sales/Orders by day.xdo')).src === 'cache');
    d = await S.definition(p1.id, '/Custom/Finance/Open invoices.xdo');
    T.check('a definition that only names its parameters: asked with getReportParameters', d.def.parameters.length === 1 && d.def.parameters[0].dateFormatString === 'yyyy-MM-dd' && pod.calls.some((c) => c.op === 'getReportParameters'));

    T.section('a run');
    const enc = E.encode(def.parameters, { P_FROM_DATE: '2026-11-01', P_TO_DATE: '2026-11-03', P_BU: ['N', 'S'] });
    let r = await S.run(p1.id, { path: '/Custom/Sales/Orders by day.xdo', name: 'Orders by day', values: { P_FROM_DATE: '2026-11-01' }, params: enc, format: 'csv' });
    const sent = pod.calls.filter((c) => c.op === 'runReport').slice(-1)[0];
    T.eq('parameters sent the way BIP wants them (dates in their format, a list kept)', sent.params, { P_FROM_DATE: ['11-01-2026'], P_TO_DATE: ['11-03-2026'], P_BU: ['N', 'S'] });
    T.eq('rows: the header\'s columns in order, dates as text, amounts as numbers', [r.ok, r.run.status, r.run.rows, r.columns, r.rows[0].ORDER_DATE, r.rows[1].AMOUNT], [true, 'DONE', 3, ['ORDER_ID', 'ORDER_DATE', 'BU', 'AMOUNT'], '2026-11-01', 20]);
    T.check('kept on this PC: the output as it came, its rows, what was asked', fs.existsSync(path.join(dir, 'bip', 'runs', r.run.id, 'output.csv')) && r.run.file === 'output.csv' && r.run.values.P_FROM_DATE === '2026-11-01');
    r = await S.run(p1.id, { path: '/Custom/Sales/Orders by day.xdo', params: enc, format: 'xml' });
    T.eq('XML: the DATA_DS rows (parameter tags left out)', [r.run.rows, r.columns], [3, ['ORDER_ID', 'ORDER_DATE', 'BU', 'AMOUNT']]);
    await S.savePrefs({ chunkMb: 1, timeoutS: 120, indexRoot: '/', maxFolders: 100 });
    r = await S.run(p1.id, { path: '/Custom/Sales/Big extract.xdo', params: {}, format: 'csv' });
    T.eq('a big output: asked in 1 MB chunks, all of it', [r.ok, r.run.rows, r.run.parts[0].chunks > 1, pod.calls.some((c) => c.op === 'downloadReportDataChunk')], [true, 25000, true, true]);
    T.check('…only part of the rows sent to the screen at once? no: 25,000 fit', r.rows.length === 25000 && r.sent === 25000);
    r = await S.run(p1.id, { path: '/Custom/Finance/Invoice print.xdo', params: { P_INVOICE: ['INV-1'] }, format: 'pdf' });
    T.eq('PDF: kept as a file, no rows', [r.ok, r.run.file, r.run.rows, fs.readFileSync(S.runFile(r.run.id).file, 'utf8')], [true, 'output.pdf', null, '%PDF-1.4 invoice']);
    r = await S.run(p1.id, { path: '/Custom/Finance/Open invoices.xdo', params: {}, format: 'xml' });
    T.eq('a code with a leading zero stays text', [r.rows[0].INVOICE_NUM, r.rows[0].AMOUNT], ['0042', 15000]);
    T.check('a format BIP does not know is refused before a call', /Not an output format/.test((await S.run(p1.id, { path: '/Custom/Finance/Invoice print.xdo', format: 'exe' })).error));
    T.check('a path that is not a report', /ends in \.xdo/.test((await S.run(p1.id, { path: '/Custom/Sales' })).error));

    T.section('buckets');
    const plan = E.plan({ params: def.parameters, dateBucket: { fromParam: 'P_FROM_DATE', toParam: 'P_TO_DATE', by: 'month', from: '2026-09-29', to: '2026-11-02' } });
    r = await S.run(p1.id, { path: '/Custom/Sales/Orders by day.xdo', params: enc, plan, format: 'csv' });
    T.eq('one run per bucket, their rows joined, a BUCKET column', [r.run.buckets, r.run.status, r.run.rows, r.columns.slice(-1)[0], r.rows[0].BUCKET, r.rows[r.rows.length - 1].BUCKET],
      [3, 'DONE', 35, 'BUCKET', '2026-09-29 → 2026-09-30', '2026-11-01 → 2026-11-02']);
    T.check('…the joined rows as one CSV', r.run.file === 'output.csv' && /BUCKET/.test(fs.readFileSync(S.runFile(r.run.id).file, 'utf8').split('\n')[0]));
    const bad = E.plan({ params: def.parameters, valueBucket: { param: 'P_STATUS', values: ['OK', 'BAD'] } });
    r = await S.run(p1.id, { path: '/Custom/Sales/Orders by day.xdo', params: enc, plan: bad, format: 'csv' });
    T.eq('a bucket that fails: PARTIAL, the others kept, its error said', [r.ok, r.run.status, r.run.rows, r.run.parts[1].ok, /ORA-01843/.test(r.run.parts[1].error)], [true, 'PARTIAL', 3, false, true]);
    T.check('buckets need data output', /CSV or XML/.test((await S.run(p1.id, { path: '/Custom/Finance/Invoice print.xdo', plan: [{ label: 'a', params: {} }, { label: 'b', params: {} }], format: 'pdf' })).error));
    const pid = 'stop-1';
    const going = S.run(p1.id, { path: '/Custom/Sales/Orders by day.xdo', params: enc, plan, format: 'csv', progressId: pid });
    S.cancel(pid);
    r = await going;
    T.check('Stop: the buckets not started are left, said', r.run.stopped && r.run.parts.some((x) => x.error === 'Stopped.'));
    T.check('progress of a run: its steps', S.progress(pid).steps.length >= 1 && S.progress(pid).done);

    T.section('this PC\'s runs');
    const runs = S.runs().runs;
    T.check('every run, newest first, with what was asked', runs.length === 8 && runs[0].started >= runs[runs.length - 1].started && runs.every((x) => x.pod === 'TEST' && x.path));
    const first = runs.filter((x) => x.format === 'csv' && x.rows === 3 && x.buckets === 1)[0];
    const back = S.runRows(first.id, 1, 1);
    T.eq('its rows read back (a page of them)', [back.total, back.rows.length, back.rows[0].ORDER_DATE], [3, 1, '2026-11-02']);
    T.check('its file', S.runFile(first.id).ok && /Orders by day\.csv$/.test(S.runFile(first.id).name));
    T.eq('removed, with its files', [S.removeRun(first.id).ok, S.runs().runs.length, S.runRows(first.id).error], [true, 7, 'No such run.']);
    T.check('no run id that is a path', S.runFile('../x').error === 'No such run.');

    T.section('favourites and the dashboard');
    T.eq('a favourite added, then taken off', [S.toggleFavorite({ pod: p1.id, path: '/Custom/Sales/Orders by day.xdo', name: 'Orders by day' }).favorite, S.favorites().favorites.length,
      S.toggleFavorite({ pod: p1.id, path: '/Custom/Sales/Orders by day.xdo' }).favorite, S.favorites().favorites.length], [true, 1, false, 0]);
    const card = S.saveCard({ pod: p1.id, path: '/Custom/Sales/Orders by day.xdo', name: 'Orders this week', format: 'csv', params: enc, measure: { mode: 'sum', column: 'AMOUNT' },
      rolling: { from: 'P_FROM_DATE', to: 'P_TO_DATE', days: 6, fmtFrom: 'MM-dd-yyyy', fmtTo: 'MM-dd-yyyy' } }).card;
    clock = new Date(2026, 10, 19, 9, 0, 0);
    const rc = await S.runCard(p1.id, card.id);
    const cardSent = pod.calls.filter((c) => c.op === 'runReport').slice(-1)[0].params;
    T.eq('a card: dates that move with today (the last 6 days to today)', [cardSent.P_FROM_DATE, cardSent.P_TO_DATE], [['11-13-2026'], ['11-19-2026']]);
    T.eq('its number (sum of AMOUNT), rows, a preview, kept', [rc.card.last.ok, rc.card.last.rows, rc.card.last.value, rc.card.last.preview.length, S.cards().cards[0].last.rows], [true, 7, 1120, 7, 7]);
    T.eq('removed', [S.removeCard(card.id).ok, S.cards().cards.length], [true, 0]);

    T.section('the data model');
    let dm = await S.dataModel(p1.id, '/Custom/Sales/Orders DM.xdm');
    T.eq('its data sets (their SQL) and parameters', [dm.ok, dm.dataSource, dm.dataSets.map((x) => x.name), /doo_headers_all/.test(dm.dataSets[0].sql), dm.parameters.map((x) => x.name + ':' + x.label)],
      [true, 'ApplicationDB_FSCM', ['Q_ORDERS'], true, ['P_FROM_DATE:From date', 'P_BU:P_BU']]);
    bip.dataModels['/Custom/Sales/Orders DM.xdm'] = F.zipStore('_datamodel.xdm', DM);
    dm = await S.dataModel(p1.id, '/Custom/Sales/Orders DM.xdm');
    T.check('…from the zip downloadObject returns too', dm.ok && dm.dataSets.length === 1);
    T.check('a data model the user may not read: said', /not found/i.test((await S.dataModel(p1.id, '/Custom/Nope.xdm')).error));

    T.section('nothing secret kept');
    const kept = [];
    (function all(d2) { fs.readdirSync(d2).forEach((n) => { const p2 = path.join(d2, n); if (fs.statSync(p2).isDirectory()) all(p2); else kept.push(fs.readFileSync(p2, 'utf8')); }); }(path.join(dir, 'bip')));
    T.check('no password in any file BIP Reporting keeps', kept.length > 5 && kept.every((t) => t.indexOf(pod.password) === -1));
    T.check('the SOAP calls are logged with the password as *** (Fusion SQL → API Inspector)', fq.calls(false).calls.some((c) => /getFolderContents/.test(c.kind) && /<v2:password>\*\*\*<\/v2:password>/.test(c.request)));
  } finally {
    await pod.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
