#!/usr/bin/env node
'use strict';
/*
 * The infolet engine (resources/js/infolets.js): turning a SQL result into a small chart model + HTML.
 * Column kinds (measure vs id/label), suggest a chart, compute KPI / bar / column / line / pie / table,
 * aggregation + Top-N "Others", and that cardHtml escapes and draws inline SVG. Run: node tests/infolets.test.js
 */
const H = require('./_harness');
const I = require('../webApps/buildrite/resources/js/infolets');

const T = H.makeAsserter();

const byRegion = {
  columns: [{ name: 'REGION' }, { name: 'ORDERS' }, { name: 'REVENUE' }],
  rows: [['North', '10', '1000'], ['South', '25', '2500'], ['East', '5', '500'], ['West', '40', '4000']],
};
const oneNumber = { columns: [{ name: 'TOTAL' }], rows: [['1234']] };
const byMonth = {
  columns: [{ name: 'ORDER_MONTH' }, { name: 'AMT' }],
  rows: [['2026-01', '10'], ['2026-02', '30'], ['2026-03', '20']],
};

try {
  T.section('column kinds: measures vs ids/labels');
  const k = I.kinds(byRegion.columns, byRegion.rows);
  T.check('ORDERS and REVENUE are measures; REGION is a label', k.measures.join(',') === '1,2' && k.dims.join(',') === '0', JSON.stringify(k));
  const k2 = I.kinds([{ name: 'ORDER_ID' }, { name: 'QTY' }], [['7001', '3']]);
  T.check('an *_ID numeric column is not a measure', k2.measures.join(',') === '1' && k2.dims.join(',') === '0', JSON.stringify(k2));

  T.section('suggest a chart');
  T.check('one row + a measure → KPI', I.suggest(oneNumber.columns, oneNumber.rows).kind === 'kpi');
  T.check('label + measure → bar', (() => { const s = I.suggest(byRegion.columns, byRegion.rows); return s.kind === 'bar' && s.label === 'REGION' && s.value === 'ORDERS'; })());
  T.check('a date-ish label + measure → line', I.suggest(byMonth.columns, byMonth.rows).kind === 'line');

  T.section('compute: KPI');
  const kpiSum = I.compute({ kind: 'kpi', value: 'REVENUE', agg: 'sum' }, byRegion);
  T.check('KPI sums the measure', kpiSum.kpi.raw === 8000 && kpiSum.kpi.formatted === '8,000', JSON.stringify(kpiSum.kpi));
  T.check('big values are abbreviated (K/M/B)', I.fmtNum(1500000) === '1.5M' && I.fmtNum(25000) === '25K' && I.fmtNum(3200000000) === '3.2B', I.fmtNum(1500000) + ' / ' + I.fmtNum(25000) + ' / ' + I.fmtNum(3200000000));
  const kpiOne = I.compute({ kind: 'kpi', value: 'TOTAL', agg: 'none' }, oneNumber);
  T.check('KPI (none) reads the first cell', kpiOne.kpi.raw === 1234 && kpiOne.kpi.formatted === '1,234');
  T.check('KPI count counts rows', I.compute({ kind: 'kpi', agg: 'count' }, byRegion).kpi.raw === 4);

  T.section('compute: bar groups + aggregation');
  const bar = I.compute({ kind: 'bar', label: 'REGION', value: 'ORDERS', agg: 'sum' }, byRegion);
  T.check('one item per label, with value/share/colour', bar.items.length === 4 && bar.items[0].value === 10 && bar.items[3].value === 40 && bar.total === 80 && bar.items[3].pct === 1, JSON.stringify(bar.items));
  const dup = I.compute({ kind: 'bar', label: 'R', value: 'V', agg: 'sum' }, { columns: [{ name: 'R' }, { name: 'V' }], rows: [['A', '1'], ['A', '2'], ['B', '5']] });
  T.check('rows with the same label are aggregated', dup.items.length === 2 && dup.items[0].value === 3 && dup.items[1].value === 5);

  T.section('Top-N with an "Others" bucket');
  const many = { columns: [{ name: 'C' }, { name: 'V' }], rows: Array.from({ length: 6 }, (_, i) => ['c' + i, String((i + 1) * 10)]) };
  const top = I.compute({ kind: 'bar', label: 'C', value: 'V', agg: 'sum', limit: 3 }, many);
  T.check('kept to the limit with the rest in Others', top.items.length === 3 && top.items[top.items.length - 1].label === 'Others' && top.items[top.items.length - 1].other === true, JSON.stringify(top.items.map((x) => x.label + '=' + x.value)));

  T.section('cardHtml: HTML + inline SVG, escaped');
  const barHtml = I.cardHtml(I.compute({ kind: 'bar', label: 'REGION', value: 'ORDERS' }, byRegion));
  T.check('bar card has CSS bars', /nx-if-bars/.test(barHtml) && /width:/.test(barHtml));
  T.check('line card draws an SVG polyline', /<svg/.test(I.cardHtml(I.compute({ kind: 'line', label: 'ORDER_MONTH', value: 'AMT' }, byMonth))) && /<polyline/.test(I.cardHtml(I.compute({ kind: 'line', label: 'ORDER_MONTH', value: 'AMT' }, byMonth))));
  T.check('pie card draws arcs and a legend', (() => { const h = I.cardHtml(I.compute({ kind: 'pie', label: 'REGION', value: 'ORDERS' }, byRegion)); return /<path/.test(h) && /nx-if-legend/.test(h); })());
  T.check('kpi card shows the big number', /nx-if-kpiv/.test(I.cardHtml(kpiSum)));
  const evil = I.cardHtml(I.compute({ kind: 'table' }, { columns: [{ name: 'X' }], rows: [['<script>bad</script>']] }));
  T.check('table escapes cell values', evil.indexOf('<script>bad') === -1 && evil.indexOf('&lt;script&gt;') !== -1);

  T.section('gridHtml: a full result grid (Saved reports)');
  const grid = I.gridHtml(byRegion.columns, byRegion.rows, {});
  T.check('renders every row with a # column and the headers', /nx-rep-grid/.test(grid) && /<th>REGION<\/th>/.test(grid) && (grid.match(/<tr>/g) || []).length === byRegion.rows.length + 1, (grid.match(/<tr>/g) || []).length);
  T.check('numeric columns are right-aligned, and cells are escaped', /nx-rep-num/.test(grid) && I.gridHtml([{ name: 'X' }], [['<b>hi</b>']], {}).indexOf('<b>hi') === -1);
  T.check('caps at the limit with a note', (() => { const h = I.gridHtml([{ name: 'V' }], Array.from({ length: 10 }, (_, i) => [i]), { limit: 4 }); return (h.match(/<tr>/g) || []).length === 5 && /first 4 of 10/.test(h); })());
  T.check('no columns → a message, no throw', /No columns/.test(I.gridHtml([], [], {})));

  T.section('errors never throw');
  T.check('no columns → an error model, no throw', I.compute({ kind: 'bar' }, { columns: [], rows: [] }).error !== '');
  T.check('render() returns a model and html together', (() => { const r = I.render({ kind: 'kpi', value: 'TOTAL', agg: 'none' }, oneNumber); return r.model.kpi.raw === 1234 && /nx-if-kpiv/.test(r.html); })());
} catch (e) {
  T.check('no exception: ' + (e && e.stack), false);
}
T.report();
