import * as TreeSitter from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import { createParserHost, fileSha256 } from '@chrisdudek/runes/ast';
import type { ParsedFile } from '@chrisdudek/runes/relations';

// A tree crosses to the rule runner as numbers, NODE_INTS to a node in preorder (parent, type, field, named, start, end, line, column), so neither side recurses on a deep tree; src/runner.ts reads the same layout.
export const NODE_INTS = 8;

export interface FlatTree {
  types: string[];
  fields: string[];
  nodes: Int32Array;
}

type Tree = ParsedFile['tree'];

export function parserHost(grammarDir: string) {
  return createParserHost({
    runtime: TreeSitter,
    runtimeIdentity: () => fileSha256(fileURLToPath(import.meta.resolve('web-tree-sitter/web-tree-sitter.wasm'))),
    grammarDirs: [grammarDir],
  });
}

export function flatten(tree: Tree): FlatTree {
  const types = new Map<string, number>();
  const fields = new Map<string, number>();
  const id = (names: Map<string, number>, name: string) => {
    let at = names.get(name);
    if (at === undefined) names.set(name, (at = names.size));
    return at;
  };
  let nodes = new Int32Array(NODE_INTS * 1024);
  let count = 0;
  const parents: number[] = [];
  const cursor = tree.walk();
  try {
    for (;;) {
      if ((count + 1) * NODE_INTS > nodes.length) {
        const grown = new Int32Array(nodes.length * 2);
        grown.set(nodes);
        nodes = grown;
      }
      const field = cursor.currentFieldName;
      const start = cursor.startPosition;
      nodes.set(
        [parents.at(-1) ?? -1, id(types, cursor.nodeType), field === null ? -1 : id(fields, field), cursor.nodeIsNamed ? 1 : 0, cursor.startIndex, cursor.endIndex, start.row + 1, start.column],
        count * NODE_INTS,
      );
      const self = count++;
      if (cursor.gotoFirstChild()) {
        parents.push(self);
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return { types: [...types.keys()], fields: [...fields.keys()], nodes: nodes.slice(0, count * NODE_INTS) };
        parents.pop();
      }
    }
  } finally {
    cursor.delete();
  }
}
