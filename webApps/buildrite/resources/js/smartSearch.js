define([], function () {
  'use strict';

  // Oracle's Smart Search (the Redwood look's filter bar, your menu → Look): what its criterion holds. Pure.

  /**
   * What Smart Search's criterion holds: { text, fields: { field: value } }. The criterion is a tree: a text node, and
   * $eq nodes for a filter's field, the value either on the node ({ attribute, value }) or inside an object
   * ({ value: { field: v } }); both are read.
   */
  function readCriterion(c) {
    var text = '';
    var fields = {};
    var pick = function (field, val) { fields[field] = val === undefined || val === null ? '' : String(val); };
    var read = function (node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.criteria)) node.criteria.forEach(read);
      if (node.text !== undefined && node.text !== null) text = String(node.text);
      if (node.op === '$eq') {
        if (node.attribute) pick(node.attribute, node.value);
        else if (node.value && typeof node.value === 'object') Object.keys(node.value).forEach(function (k) { pick(k, node.value[k]); });
      }
    };
    read(c);
    return { text: text.trim(), fields: fields };
  }

  return { readCriterion: readCriterion };
});
