// ast.ts — the only module that imports the TypeScript 7 programmatic API (spec 0267 R8).
//
// `typescript/unstable/sync` is, by its own name, unstable: confining it here makes an API change
// in a future `typescript` bump a one-file fix. The adapter PARSES ONLY. It opens the repository's
// own `tsconfig.json` (no temporary config is written), asks the native server for the already
// parsed `SourceFile` of each path, and never calls the type checker, the emitter or any
// evaluation: nothing it reads is executed, imported or written.
//
// Type resolution under `moduleResolution: bundler` (the open assumption of the PLAN): irrelevant
// here. The program is only used as a source-file cache; `include: ["**/*.ts"]` selects the files,
// and no module specifier is ever resolved by this check, so the resolution mode cannot change a
// finding. Unresolvable imports in a scanned file are not an error for the parser.

import path from "node:path";
import { API } from "typescript/unstable/sync";
import { NodeFlags, SyntaxKind } from "typescript/unstable/ast";
import type { Node, NodeArray, SourceFile } from "typescript/unstable/ast";

export { NodeFlags, SyntaxKind };
export type { Node, NodeArray, SourceFile };
export type {
  ArrowFunction,
  BinaryExpression,
  BindingElement,
  CallExpression,
  CatchClause,
  ConditionalExpression,
  ElementAccessExpression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  ImportDeclaration,
  MethodDeclaration,
  ObjectLiteralExpression,
  ParameterDeclaration,
  PropertyAccessExpression,
  PropertyAssignment,
  StringLiteral,
  TemplateExpression,
  VariableDeclaration,
  VariableDeclarationList,
} from "typescript/unstable/ast";

export class ParseFault extends Error {}

export interface ParsedProgram {
  /** The parsed file at an absolute path, or `undefined` when the project does not include it. */
  sourceFile(absPath: string): SourceFile | undefined;
  close(): void;
}

/** Open `<repoDir>/tsconfig.json` and expose its parsed source files. */
export function openProgram(repoDir: string): ParsedProgram {
  const tsconfig = path.join(repoDir, "tsconfig.json");
  const api = new API({ cwd: repoDir });
  try {
    const snapshot = api.updateSnapshot({ openProject: tsconfig });
    const project = snapshot.getProject(tsconfig);
    if (project === undefined) throw new ParseFault(`${tsconfig} did not load as a project`);
    const program = project.program;
    return {
      sourceFile: (absPath) => program.getSourceFile(absPath),
      close: () => api.close(),
    };
  } catch (err) {
    api.close();
    throw err instanceof ParseFault
      ? err
      : new ParseFault(`cannot open ${tsconfig}: ${String(err)}`);
  }
}

/** Narrow a node to a concrete interface; callers have already checked `node.kind`. */
export function as<T extends Node>(node: Node): T {
  return node as T;
}

/** 1-based line of the first token of `node`. */
export function lineOf(node: Node, file: SourceFile): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** Source text of `node` with all whitespace removed (stable key for "same expression"). */
export function compactText(node: Node, file: SourceFile): string {
  return node.getText(file).replace(/\s+/g, "");
}
