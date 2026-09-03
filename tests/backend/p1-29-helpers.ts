/**
 * Helpers the P1-29 real-response proofs share.
 *
 * P1-29 is a Frontend phase whose screens consume operations the Backend
 * already published. What its backend proofs add is the CHAIN a screen
 * introduces: the web mirror an adapter types itself against, held against the
 * row that really came back. `p1-19-*` and the PRE-P1-29 suites prove the
 * operations; these helpers let each P1-29 item prove its mirrors the same way
 * without a second copy of the parser.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * The property names of one interface in a web contract, PARSED.
 *
 * A regular expression would answer for a name inside a comment or a
 * neighbouring interface. This walks the real syntax tree, which is the rule
 * this repository applies to its gate scanners and applies here for the same
 * reason.
 */
export function mirrorFields(file: string, interfaceName: string): readonly string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          found.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found.length === 0) throw new Error(`no interface ${interfaceName} in ${file}`);
  return found;
}
