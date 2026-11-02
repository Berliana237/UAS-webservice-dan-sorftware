'use strict';
/** Pengaman GraphQL: batas kedalaman dan jumlah field agar satu query tidak bisa membebani server. */
const { GraphQLError, Kind } = require('graphql');

const MAX_DEPTH = 8;
const MAX_FIELDS = 200;

function depthLimitRule(max = MAX_DEPTH) {
  return (context) => {
    const fragments = Object.create(null);
    for (const def of context.getDocument().definitions) if (def.kind === Kind.FRAGMENT_DEFINITION) fragments[def.name.value] = def;
    const walk = (node, depth, seen) => {
      if (!node.selectionSet) return depth;
      let deepest = depth;
      for (const sel of node.selectionSet.selections) {
        if (sel.kind === Kind.FIELD) {
          deepest = Math.max(deepest, walk(sel, depth + 1, seen));
        } else if (sel.kind === Kind.INLINE_FRAGMENT) {
          deepest = Math.max(deepest, walk(sel, depth, seen));
        } else if (sel.kind === Kind.FRAGMENT_SPREAD && !seen.has(sel.name.value) && fragments[sel.name.value]) {
          deepest = Math.max(deepest, walk(fragments[sel.name.value], depth, new Set([...seen, sel.name.value])));
        }
      }
      return deepest;
    };
    return {
      OperationDefinition(node) {
        const d = walk(node, 0, new Set());
        if (d > max) context.reportError(new GraphQLError(`Query terlalu dalam: ${d} (batas ${max}).`, { extensions: { code: 'QUERY_TOO_DEEP' } }));
      },
    };
  };
}

function fieldLimitRule(max = MAX_FIELDS) {
  return (context) => {
    let count = 0;
    return {
      Field() {
        count += 1;
        if (count === max + 1) context.reportError(new GraphQLError(`Query terlalu besar (lebih dari ${max} field).`, { extensions: { code: 'QUERY_TOO_LARGE' } }));
      },
    };
  };
}

module.exports = { depthLimitRule, fieldLimitRule, MAX_DEPTH, MAX_FIELDS };
