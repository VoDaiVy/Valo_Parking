/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import vietnamese from '../vi.json';

test('translated application text is not left as raw JSX copy', () => {
  const untranslated: string[] = [];
  const inspect = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== '__tests__') inspect(file);
      if (!entry.isFile() || !file.endsWith('.tsx')) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) {
          const text = node.text.trim().replace(/\s+/g, ' ');
          if (Object.prototype.hasOwnProperty.call(vietnamese, text)) untranslated.push(`${file}: ${text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  inspect(path.resolve(__dirname, '../../screens'));
  inspect(path.resolve(__dirname, '../../components'));
  expect(untranslated).toEqual([]);
});
