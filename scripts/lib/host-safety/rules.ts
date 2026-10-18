// rules.ts — taint and containment rules of the host-safety check (spec 0267 R1-R5).
//
// DECISIONS (closing reviewer finding v1-F1). The PLAN measured a name-based, scope-insensitive
// prototype; this engine resolves bindings by lexical scope and is therefore narrower in some
// places and wider in others. The propagation rules below are the contract, and the suite pins them:
//
//  1. A CALL WITH A TAINTED ARGUMENT TAINTS ITS RESULT, and so does a call whose receiver is
//     tainted (`process.argv.slice(2)`, `parseOptions(process.argv.slice(2))`). Rationale: a path
//     that went through any function on its way from `process.argv` is still operator-controlled,
//     and the incident class (a value read from the environment, reshaped, then deleted) is exactly
//     this. Exceptions, because they cannot yield a path: calls named in NON_PATH_CALLS (`Number`,
//     `parseInt`, `Boolean`, `existsSync`, `includes`, `startsWith`, ... ) and the clean origins
//     `mkdtemp`, `mkdtempSync` and `createRoot`, whose result is clean whatever their argument is
//     (spec R5).
//     PRECISION BOUND: builtin string/path/array transforms (PURE_CALLS: `path.*`, `slice`, `map`,
//     `join`, `realpathSync`, ...) propagate without limit, but a call to any OTHER function
//     (a user-defined helper) propagates taint ONE hop only: the result is marked opaque, and a
//     second opaque hop (`makeCtx(leg, detectInterpreters({env: process.env}))`) is dropped. Measured
//     on this tree, the unbounded rule flagged `fs.rmSync(c.root)` in windows-e2e-harness.test.ts,
//     where `c.root` is an `mkdtemp` made inside `makeCtx`.
//  2. A PROPERTY OR ELEMENT READ ON A TAINTED VALUE IS TAINTED (`options.portFile` where
//     `options` is tainted), except `.length` and `.size`. Destructuring a tainted value taints
//     every name it binds. This is what flags
//     `const options = parseOptions(process.argv.slice(2)); renameSync(staging, options.portFile)`.
//  3. CLEAN MEANS "DERIVES ONLY FROM" A CLEAN ORIGIN (spec R5). A binding is a clean root only when
//     EVERY value-position branch of every initializer and later assignment is clean: the
//     clean-origin call itself, a clean binding, a pure path/string transform or concatenation whose
//     parts are each clean or untainted (at least one clean), or a conditional / `??` / `||` / `&&`
//     whose branches all are. `process.env.X ?? mkdtempSync(...)` and `c ? process.env.X : mkdtempSync(...)`
//     are therefore NOT clean, and taint (rule 5) still reaches them. Untrusted components inside the
//     ARGUMENT of the clean-origin call stay irrelevant (`mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "x-"))`,
//     `realpathSync(mkdtempSync(...))`). Cleanness only feeds the guard-root test below; an untainted
//     binding is never flagged whether or not it is clean.
//  4. Names resolve by LEXICAL SCOPE, never by bare name: `for (const r of roots)` and a sibling
//     `const r = spawnSync(process.execPath, ...)` are two different bindings. A name that resolves to
//     no local binding is not tainted, and `process` is only the global when it is not shadowed.
//  5. A binding is tainted when ANY of its initializer, later assignments (`x = ...`, `x += ...`),
//     loop iterable or callback receiver (`Object.values(process.env).forEach((v) => ...)`) is.
//     Conditionals, `??`, `||` and `&&` take the taint of either branch (never of the condition);
//     comparisons, `typeof` and `!` are clean.
//
// Deliberate limits (false negatives, documented in docs/host-safety-check.md): no cross-function,
// cross-file or through-parameter taint, no aliasing of sinks (`const rm = fs.rmSync`), no `require`,
// no dynamic `import()`, and `writeFileSync`-family writes are not sinks (PLAN open question 3).
//
// Containment (spec R4): an `assertInside(root, X)` / `isInside(root, X)` call EARLIER IN THE SAME
// FUNCTION whose `root` is clean in the sense of rule 3 and whose X is the sink argument, or an
// expression inside it, covers the sink.

import { NodeFlags, SyntaxKind, as, compactText, lineOf } from "./ast.ts";
import type {
  BinaryExpression,
  BindingElement,
  CallExpression,
  ConditionalExpression,
  ElementAccessExpression,
  ForInStatement,
  ForOfStatement,
  FunctionDeclaration,
  Identifier,
  ImportDeclaration,
  Node,
  PropertyAccessExpression,
  SourceFile,
  StringLiteral,
  VariableDeclaration,
} from "./ast.ts";

export type SourceKind = "env" | "argv" | "homedir" | "path";

export interface Taint {
  kind: SourceKind;
  label: string;
  /** True only on the source expression itself (`process.env`); lets `process.env.X` name X. */
  direct: boolean;
  /** True once the value crossed one non-builtin function call; a second such call drops it. */
  opaque: boolean;
}

export interface Flagged {
  rule: string;
  line: number;
  /** Allowlist key: `<path>::<enclosing-function>::<callee>#<ordinal>`. */
  key: string;
  message: string;
}

export interface FileReport {
  sinks: number;
  tainted: number;
  contained: number;
  flagged: Flagged[];
}

export const RULE_FOR: Record<SourceKind, string> = {
  env: "env-derived-destructive",
  argv: "argv-derived-destructive",
  homedir: "homedir-derived-destructive",
  path: "path-derived-destructive",
};

const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const OS_MODULES = new Set(["os", "node:os"]);
const SINKS = new Set([
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "cp",
  "cpSync",
  "copyFile",
  "copyFileSync",
  "rename",
  "renameSync",
]);
const TWO_PATH_SINKS = new Set([
  "cp",
  "cpSync",
  "copyFile",
  "copyFileSync",
  "rename",
  "renameSync",
]);
const CLEAN_ORIGINS = new Set(["mkdtemp", "mkdtempSync", "createRoot"]);
const PURE_CALLS = new Set([
  "slice",
  "map",
  "filter",
  "flatMap",
  "flat",
  "concat",
  "split",
  "join",
  "trim",
  "replace",
  "replaceAll",
  "toString",
  "toLowerCase",
  "toUpperCase",
  "substring",
  "substr",
  "at",
  "values",
  "entries",
  "keys",
  "assign",
  "from",
  "fromEntries",
  "resolve",
  "normalize",
  "dirname",
  "basename",
  "extname",
  "relative",
  "format",
  "String",
  "realpathSync",
  "fileURLToPath",
  "pathToFileURL",
  "decodeURIComponent",
  "parse",
  "find",
  "pop",
  "shift",
  "reduce",
]);
const GUARDS = new Set(["assertInside", "isInside"]);
const NON_PATH_CALLS = new Set([
  "Number",
  "parseInt",
  "parseFloat",
  "Boolean",
  "isNaN",
  "isArray",
  "existsSync",
  "includes",
  "has",
  "startsWith",
  "endsWith",
  "test",
  "indexOf",
  "isAbsolute",
  "isInside",
  "assertInside",
]);

interface Source {
  expr: Node;
  scope: Scope;
}

interface Binding {
  sources: Source[];
  /** Declared as a plain identifier by a variable declaration: eligible to be a clean root. */
  plain: boolean;
  imp?: { module: string; imported: string };
  memo?: Taint | null;
  busy?: boolean;
  cleanBusy?: boolean;
}

interface Scope {
  parent: Scope | null;
  bindings: Map<string, Binding>;
  isFunction: boolean;
}

interface Guard {
  pos: number;
  root: Node;
  scope: Scope;
  target: string;
}

interface FnCtx {
  name: string;
  guards: Guard[];
}

interface CallRec {
  node: CallExpression;
  scope: Scope;
  fn: FnCtx;
}

function newScope(parent: Scope | null, isFunction: boolean): Scope {
  return { parent, bindings: new Map(), isFunction };
}

function resolve(scope: Scope, name: string): Binding | undefined {
  for (let s: Scope | null = scope; s !== null; s = s.parent) {
    const b = s.bindings.get(name);
    if (b !== undefined) return b;
  }
  return undefined;
}

function children(node: Node, cb: (child: Node) => void): void {
  node.forEachChild((c) => {
    cb(c);
  });
}

function isFunctionLike(kind: SyntaxKind): boolean {
  return (
    kind === SyntaxKind.FunctionDeclaration ||
    kind === SyntaxKind.FunctionExpression ||
    kind === SyntaxKind.ArrowFunction ||
    kind === SyntaxKind.MethodDeclaration ||
    kind === SyntaxKind.Constructor ||
    kind === SyntaxKind.GetAccessor ||
    kind === SyntaxKind.SetAccessor
  );
}

function isTypeNode(kind: SyntaxKind): boolean {
  return kind >= SyntaxKind.FirstTypeNode && kind <= SyntaxKind.LastTypeNode;
}

function nameText(node: Node | undefined): string {
  if (node === undefined) return "";
  const text = (node as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function calleeName(callee: Node): string {
  if (callee.kind === SyntaxKind.Identifier) return nameText(callee);
  if (callee.kind === SyntaxKind.PropertyAccessExpression)
    return nameText(as<PropertyAccessExpression>(callee).name);
  return "";
}

const ASSIGN_OPS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
]);
const CLEAN_RESULT_OPS = new Set<SyntaxKind>([
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.InstanceOfKeyword,
  SyntaxKind.InKeyword,
]);

export function analyzeFile(file: SourceFile, rel: string): FileReport {
  const root = newScope(null, true);
  const calls: CallRec[] = [];
  const assignments: Array<{ scope: Scope; name: string; source: Source }> = [];
  const callbackSources = new Map<Node, Source>();
  let anonymous = 0;

  // ---- phase 1: scope tree, bindings, call records (document order) ----

  function declare(scope: Scope, name: string, binding: Binding): void {
    scope.bindings.set(name, binding);
  }

  function declarePattern(
    name: Node | undefined,
    scope: Scope,
    source: Source | undefined,
    plain: boolean,
  ): void {
    if (name === undefined) return;
    if (name.kind === SyntaxKind.Identifier) {
      declare(scope, nameText(name), { sources: source ? [source] : [], plain });
      return;
    }
    if (
      name.kind === SyntaxKind.ObjectBindingPattern ||
      name.kind === SyntaxKind.ArrayBindingPattern
    ) {
      const elements = (name as unknown as { elements: readonly Node[] }).elements;
      for (const el of elements) {
        if (el.kind !== SyntaxKind.BindingElement) continue;
        const be = as<BindingElement>(el);
        const sources = source ? [source] : [];
        if (be.initializer) sources.push({ expr: be.initializer, scope });
        declarePatternWithSources(be.name, scope, sources);
      }
    }
  }

  function declarePatternWithSources(
    name: Node | undefined,
    scope: Scope,
    sources: Source[],
  ): void {
    if (name === undefined) return;
    if (name.kind === SyntaxKind.Identifier) {
      declare(scope, nameText(name), { sources, plain: false });
      return;
    }
    declarePattern(name, scope, sources[0], false);
  }

  function functionScopeOf(scope: Scope): Scope {
    let s = scope;
    while (!s.isFunction && s.parent !== null) s = s.parent;
    return s;
  }

  function fnNameOf(node: Node): string {
    const n = as<FunctionDeclaration>(node);
    const own = nameText(n.name);
    if (node.kind === SyntaxKind.FunctionDeclaration && own !== "") return own;
    if (
      node.kind === SyntaxKind.Constructor ||
      node.kind === SyntaxKind.MethodDeclaration ||
      node.kind === SyntaxKind.GetAccessor ||
      node.kind === SyntaxKind.SetAccessor
    ) {
      const cls = node.parent;
      const clsName = cls !== undefined ? nameText((cls as { name?: Node }).name) : "";
      const member =
        node.kind === SyntaxKind.Constructor
          ? "constructor"
          : nameText((node as { name?: Node }).name) || "<computed>";
      return clsName !== "" ? `${clsName}.${member}` : member;
    }
    if (own !== "") return own;
    const parent = node.parent;
    if (parent !== undefined) {
      if (parent.kind === SyntaxKind.VariableDeclaration) {
        const pn = nameText(as<VariableDeclaration>(parent).name);
        if (pn !== "") return pn;
      }
      if (parent.kind === SyntaxKind.PropertyAssignment) {
        const pn = nameText((parent as { name?: Node }).name);
        if (pn !== "") return pn;
      }
    }
    anonymous += 1;
    return `<anonymous-${anonymous}>`;
  }

  function visit(node: Node, scope: Scope, fn: FnCtx): void {
    const kind = node.kind;
    if (kind === SyntaxKind.ImportDeclaration) {
      registerImport(as<ImportDeclaration>(node));
      return;
    }
    if (isFunctionLike(kind)) {
      if (kind === SyntaxKind.FunctionDeclaration) {
        const nm = nameText(as<FunctionDeclaration>(node).name);
        if (nm !== "") declare(scope, nm, { sources: [], plain: false });
      }
      const fscope = newScope(scope, true);
      const ctx: FnCtx = { name: fnNameOf(node), guards: [] };
      const cbSource = callbackSources.get(node);
      const params = (node as unknown as { parameters?: readonly Node[] }).parameters ?? [];
      for (const p of params) {
        const pd = p as unknown as { name?: Node; initializer?: Node };
        const sources: Source[] = [];
        if (pd.initializer) sources.push({ expr: pd.initializer, scope: fscope });
        if (cbSource) sources.push(cbSource);
        declarePatternWithSources(pd.name, fscope, sources);
        if (pd.initializer) visit(pd.initializer, fscope, ctx);
      }
      const body = (node as unknown as { body?: Node }).body;
      if (body) visit(body, fscope, ctx);
      return;
    }
    switch (kind) {
      case SyntaxKind.Block:
      case SyntaxKind.CaseBlock:
      case SyntaxKind.ModuleBlock: {
        const inner = newScope(scope, false);
        children(node, (c) => visit(c, inner, fn));
        return;
      }
      case SyntaxKind.CatchClause: {
        const inner = newScope(scope, false);
        const decl = (node as unknown as { variableDeclaration?: VariableDeclaration })
          .variableDeclaration;
        if (decl) declarePattern(decl.name, inner, undefined, false);
        const block = (node as unknown as { block: Node }).block;
        visit(block, inner, fn);
        return;
      }
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.ForInStatement: {
        const loop = as<ForOfStatement | ForInStatement>(node);
        const inner = newScope(scope, false);
        const init = loop.initializer;
        if (init.kind === SyntaxKind.VariableDeclarationList) {
          const decls = (init as unknown as { declarations: readonly VariableDeclaration[] })
            .declarations;
          for (const d of decls)
            declarePattern(d.name, inner, { expr: loop.expression, scope }, false);
        }
        visit(loop.expression, scope, fn);
        visit(loop.statement, inner, fn);
        return;
      }
      case SyntaxKind.ForStatement: {
        const inner = newScope(scope, false);
        children(node, (c) => visit(c, inner, fn));
        return;
      }
      case SyntaxKind.VariableDeclaration: {
        const d = as<VariableDeclaration>(node);
        const listFlags = node.parent !== undefined ? node.parent.flags : 0;
        const blockScoped = (listFlags & (NodeFlags.Let | NodeFlags.Const)) !== 0;
        const target = blockScoped ? scope : functionScopeOf(scope);
        const init = d.initializer;
        declarePattern(d.name, target, init ? { expr: init, scope } : undefined, true);
        if (init) visit(init, scope, fn);
        return;
      }
      case SyntaxKind.ClassDeclaration: {
        const nm = nameText((node as { name?: Node }).name);
        if (nm !== "") declare(scope, nm, { sources: [], plain: false });
        children(node, (c) => visit(c, scope, fn));
        return;
      }
      case SyntaxKind.BinaryExpression: {
        const b = as<BinaryExpression>(node);
        if (ASSIGN_OPS.has(b.operatorToken.kind) && b.left.kind === SyntaxKind.Identifier)
          assignments.push({
            scope,
            name: nameText(b.left),
            source: { expr: b.right, scope },
          });
        break;
      }
      case SyntaxKind.CallExpression: {
        const c = as<CallExpression>(node);
        calls.push({ node: c, scope, fn });
        const name = calleeName(c.expression);
        if (GUARDS.has(name) && c.arguments.length >= 2) {
          const [rootArg, target] = c.arguments;
          if (rootArg && target)
            fn.guards.push({
              pos: node.getStart(file),
              root: rootArg,
              scope,
              target: compactText(target, file),
            });
        }
        if (c.expression.kind === SyntaxKind.PropertyAccessExpression) {
          const receiver = as<PropertyAccessExpression>(c.expression).expression;
          for (const a of c.arguments)
            if (isFunctionLike(a.kind)) callbackSources.set(a, { expr: receiver, scope });
        }
        break;
      }
      default:
        break;
    }
    children(node, (c) => visit(c, scope, fn));
  }

  function registerImport(decl: ImportDeclaration): void {
    const module = (decl.moduleSpecifier as StringLiteral).text;
    const clause = decl.importClause;
    if (clause === undefined) return;
    if (clause.name !== undefined)
      declare(root, nameText(clause.name), {
        sources: [],
        plain: false,
        imp: { module, imported: "default" },
      });
    const nb = clause.namedBindings;
    if (nb === undefined) return;
    if (nb.kind === SyntaxKind.NamespaceImport) {
      declare(root, nameText((nb as unknown as { name: Node }).name), {
        sources: [],
        plain: false,
        imp: { module, imported: "*" },
      });
      return;
    }
    const elements = (nb as unknown as { elements: readonly Node[] }).elements;
    for (const el of elements) {
      const spec = el as unknown as { name: Node; propertyName?: Node };
      declare(root, nameText(spec.name), {
        sources: [],
        plain: false,
        imp: { module, imported: nameText(spec.propertyName) || nameText(spec.name) },
      });
    }
  }

  const rootCtx: FnCtx = { name: "<module>", guards: [] };
  for (const st of file.statements) visit(st, root, rootCtx);
  for (const a of assignments) resolve(a.scope, a.name)?.sources.push(a.source);

  // ---- phase 2: taint ----

  function isGlobalProcess(id: Node, scope: Scope): boolean {
    if (nameText(id) !== "process") return false;
    const b = resolve(scope, "process");
    return b === undefined || b.imp !== undefined;
  }

  function importOf(id: Node, scope: Scope): Binding["imp"] | undefined {
    return id.kind === SyntaxKind.Identifier ? resolve(scope, nameText(id))?.imp : undefined;
  }

  function isHomedirCall(c: CallExpression, scope: Scope): boolean {
    const callee = c.expression;
    if (callee.kind === SyntaxKind.Identifier) {
      const imp = importOf(callee, scope);
      return imp !== undefined && OS_MODULES.has(imp.module) && imp.imported === "homedir";
    }
    if (callee.kind === SyntaxKind.PropertyAccessExpression) {
      const pa = as<PropertyAccessExpression>(callee);
      const imp = importOf(pa.expression, scope);
      return (
        nameText(pa.name) === "homedir" &&
        imp !== undefined &&
        OS_MODULES.has(imp.module) &&
        (imp.imported === "*" || imp.imported === "default")
      );
    }
    return false;
  }

  function isPathModuleCall(c: CallExpression, scope: Scope): boolean {
    if (c.expression.kind !== SyntaxKind.PropertyAccessExpression) return false;
    const imp = importOf(as<PropertyAccessExpression>(c.expression).expression, scope);
    return imp !== undefined && (imp.module === "path" || imp.module === "node:path");
  }

  function bindingTaint(b: Binding): Taint | null {
    if (b.memo !== undefined) return b.memo;
    if (b.busy) return null;
    b.busy = true;
    let result: Taint | null = null;
    for (const s of b.sources) {
      const t = taintOf(s.expr, s.scope);
      if (t !== null) {
        result = { ...t, direct: false };
        break;
      }
    }
    b.busy = false;
    b.memo = result;
    return result;
  }

  // A value is CLEAN when every value-position branch of it is: the clean-origin call itself, a
  // binding that is clean, a pure path/string transform or concatenation whose parts are each clean
  // or untainted (at least one clean), or a conditional / `??` / `||` / `&&` whose branches ALL are.
  // Untrusted components inside the ARGUMENT of a clean-origin call never matter (spec R5).
  function bindingClean(b: Binding): boolean {
    if (!b.plain || b.sources.length === 0) return false;
    if (b.cleanBusy) return true; // a cycle (`d = path.join(d, "x")`) adds no new branch
    b.cleanBusy = true;
    const ok = b.sources.every((s) => isCleanValue(s.expr, s.scope));
    b.cleanBusy = false;
    return ok;
  }

  function cleanParts(parts: readonly Node[], scope: Scope): boolean {
    let anyClean = false;
    for (const p of parts) {
      if (isCleanValue(p, scope)) anyClean = true;
      else if (taintOf(p, scope) !== null) return false;
    }
    return anyClean;
  }

  function isCleanValue(node: Node, scope: Scope): boolean {
    switch (node.kind) {
      case SyntaxKind.Identifier: {
        const b = resolve(scope, nameText(node));
        return b !== undefined && bindingClean(b);
      }
      case SyntaxKind.CallExpression: {
        const c = as<CallExpression>(node);
        const name = calleeName(c.expression);
        if (CLEAN_ORIGINS.has(name)) return true;
        if (!(PURE_CALLS.has(name) || isPathModuleCall(c, scope))) return false;
        const parts: Node[] = [...c.arguments];
        if (
          c.expression.kind === SyntaxKind.PropertyAccessExpression &&
          !isPathModuleCall(c, scope)
        )
          parts.push(as<PropertyAccessExpression>(c.expression).expression);
        return cleanParts(parts, scope);
      }
      case SyntaxKind.ConditionalExpression: {
        const ce = as<ConditionalExpression>(node);
        return isCleanValue(ce.whenTrue, scope) && isCleanValue(ce.whenFalse, scope);
      }
      case SyntaxKind.BinaryExpression: {
        const b = as<BinaryExpression>(node);
        const op = b.operatorToken.kind;
        if (
          op === SyntaxKind.QuestionQuestionToken ||
          op === SyntaxKind.BarBarToken ||
          op === SyntaxKind.AmpersandAmpersandToken
        )
          return isCleanValue(b.left, scope) && isCleanValue(b.right, scope);
        if (op === SyntaxKind.PlusToken) return cleanParts([b.left, b.right], scope);
        if (op === SyntaxKind.CommaToken || op === SyntaxKind.EqualsToken)
          return isCleanValue(b.right, scope);
        return false;
      }
      case SyntaxKind.TemplateExpression: {
        const spans = (node as unknown as { templateSpans: readonly { expression: Node }[] })
          .templateSpans;
        return cleanParts(
          spans.map((sp) => sp.expression),
          scope,
        );
      }
      case SyntaxKind.AsExpression:
      case SyntaxKind.SatisfiesExpression:
      case SyntaxKind.TypeAssertionExpression:
      case SyntaxKind.NonNullExpression:
      case SyntaxKind.ParenthesizedExpression:
      case SyntaxKind.AwaitExpression:
        return isCleanValue((node as unknown as { expression: Node }).expression, scope);
      default:
        return false;
    }
  }

  function envKey(node: Node): string | undefined {
    if (node.kind === SyntaxKind.StringLiteral) return nameText(node);
    return undefined;
  }

  function refine(base: Taint | null, key: string | undefined): Taint | null {
    if (base === null) return null;
    if (!base.direct || base.kind !== "env" || key === undefined) return { ...base, direct: false };
    return {
      kind: key.toUpperCase() === "PATH" ? "path" : "env",
      label: `process.env.${key}`,
      direct: false,
      opaque: false,
    };
  }

  function taintOf(node: Node, scope: Scope): Taint | null {
    switch (node.kind) {
      case SyntaxKind.Identifier: {
        const b = resolve(scope, nameText(node));
        return b === undefined ? null : bindingTaint(b);
      }
      case SyntaxKind.PropertyAccessExpression: {
        const pa = as<PropertyAccessExpression>(node);
        const prop = nameText(pa.name);
        if (pa.expression.kind === SyntaxKind.Identifier && isGlobalProcess(pa.expression, scope)) {
          if (prop === "env")
            return { kind: "env", label: "process.env", direct: true, opaque: false };
          if (prop === "argv")
            return { kind: "argv", label: "process.argv", direct: false, opaque: false };
          return null;
        }
        if (prop === "length" || prop === "size") return null;
        return refine(taintOf(pa.expression, scope), prop);
      }
      case SyntaxKind.ElementAccessExpression: {
        const ea = as<ElementAccessExpression>(node);
        return refine(taintOf(ea.expression, scope), envKey(ea.argumentExpression));
      }
      case SyntaxKind.CallExpression: {
        const c = as<CallExpression>(node);
        const name = calleeName(c.expression);
        if (CLEAN_ORIGINS.has(name) || NON_PATH_CALLS.has(name)) return null;
        if (isHomedirCall(c, scope))
          return { kind: "homedir", label: "os.homedir()", direct: false, opaque: false };
        const pure = PURE_CALLS.has(name) || isPathModuleCall(c, scope);
        const through = (t: Taint | null): Taint | null => {
          if (t === null) return null;
          if (pure) return { ...t, direct: false };
          return t.opaque ? null : { ...t, direct: false, opaque: true };
        };
        if (
          c.expression.kind === SyntaxKind.PropertyAccessExpression ||
          c.expression.kind === SyntaxKind.ElementAccessExpression
        ) {
          const recv = through(
            taintOf((c.expression as unknown as { expression: Node }).expression, scope),
          );
          if (recv !== null) return recv;
        }
        for (const a of c.arguments) {
          const t = through(taintOf(a, scope));
          if (t !== null) return t;
        }
        return null;
      }
      case SyntaxKind.ConditionalExpression: {
        const ce = as<ConditionalExpression>(node);
        return taintOf(ce.whenTrue, scope) ?? taintOf(ce.whenFalse, scope);
      }
      case SyntaxKind.BinaryExpression: {
        const b = as<BinaryExpression>(node);
        const op = b.operatorToken.kind;
        if (CLEAN_RESULT_OPS.has(op)) return null;
        if (op === SyntaxKind.CommaToken || op === SyntaxKind.EqualsToken)
          return taintOf(b.right, scope);
        return taintOf(b.left, scope) ?? taintOf(b.right, scope);
      }
      case SyntaxKind.PropertyAssignment:
        return taintOf((node as unknown as { initializer: Node }).initializer, scope);
      case SyntaxKind.ShorthandPropertyAssignment: {
        const b = resolve(scope, nameText((node as unknown as { name: Node }).name));
        return b === undefined ? null : bindingTaint(b);
      }
      case SyntaxKind.AsExpression:
      case SyntaxKind.SatisfiesExpression:
      case SyntaxKind.TypeAssertionExpression:
      case SyntaxKind.NonNullExpression:
      case SyntaxKind.ParenthesizedExpression:
      case SyntaxKind.AwaitExpression:
      case SyntaxKind.SpreadElement:
      case SyntaxKind.SpreadAssignment:
        return taintOf((node as unknown as { expression: Node }).expression, scope);
      case SyntaxKind.TypeOfExpression:
      case SyntaxKind.VoidExpression:
      case SyntaxKind.DeleteExpression:
        return null;
      case SyntaxKind.PrefixUnaryExpression:
        if ((node as unknown as { operator: SyntaxKind }).operator === SyntaxKind.ExclamationToken)
          return null;
        break;
      default:
        break;
    }
    if (
      isFunctionLike(node.kind) ||
      node.kind === SyntaxKind.ClassExpression ||
      isTypeNode(node.kind)
    )
      return null;
    let found: Taint | null = null;
    children(node, (c) => {
      if (found === null) found = taintOf(c, scope);
    });
    return found;
  }

  // ---- phase 3: sinks, containment, findings ----

  function isFsNamespace(obj: Node, scope: Scope): boolean {
    if (obj.kind === SyntaxKind.Identifier) {
      const imp = importOf(obj, scope);
      if (imp === undefined || !FS_MODULES.has(imp.module)) return false;
      return imp.imported === "*" || imp.imported === "default" || imp.imported === "promises";
    }
    if (obj.kind === SyntaxKind.PropertyAccessExpression) {
      const pa = as<PropertyAccessExpression>(obj);
      return nameText(pa.name) === "promises" && isFsNamespace(pa.expression, scope);
    }
    return false;
  }

  function sinkName(c: CallExpression, scope: Scope): string | null {
    const callee = c.expression;
    if (callee.kind === SyntaxKind.Identifier) {
      const imp = importOf(callee, scope);
      if (imp !== undefined && FS_MODULES.has(imp.module) && SINKS.has(imp.imported))
        return imp.imported;
      return null;
    }
    if (callee.kind === SyntaxKind.PropertyAccessExpression) {
      const pa = as<PropertyAccessExpression>(callee);
      const name = nameText(pa.name);
      if (SINKS.has(name) && isFsNamespace(pa.expression, scope)) return name;
    }
    return null;
  }

  function isCleanRoot(rootExpr: Node, scope: Scope): boolean {
    if (isCleanValue(rootExpr, scope)) return true;
    if (rootExpr.kind === SyntaxKind.PropertyAccessExpression)
      return isCleanRoot(as<PropertyAccessExpression>(rootExpr).expression, scope);
    return false;
  }

  function subTexts(node: Node, out: Set<string>): void {
    out.add(compactText(node, file));
    children(node, (c) => subTexts(c, out));
  }

  function isContained(rec: CallRec, arg: Node): boolean {
    const here = rec.node.getStart(file);
    const texts = new Set<string>();
    subTexts(arg, texts);
    return rec.fn.guards.some(
      (g) => g.pos < here && texts.has(g.target) && isCleanRoot(g.root, g.scope),
    );
  }

  const report: FileReport = { sinks: 0, tainted: 0, contained: 0, flagged: [] };
  const ordinals = new Map<string, number>();
  for (const rec of calls) {
    const sink = sinkName(rec.node, rec.scope);
    if (sink === null) continue;
    report.sinks += 1;
    const calleeText = compactText(rec.node.expression, file);
    const ordKey = `${rec.fn.name}\u0000${calleeText}`;
    const ordinal = (ordinals.get(ordKey) ?? 0) + 1;
    ordinals.set(ordKey, ordinal);
    const indices = TWO_PATH_SINKS.has(sink) ? [0, 1] : [0];
    let hit: { taint: Taint; arg: Node } | null = null;
    for (const i of indices) {
      const arg = rec.node.arguments[i];
      if (arg === undefined) continue;
      const taint = taintOf(arg, rec.scope);
      if (taint !== null) {
        hit = { taint, arg };
        break;
      }
    }
    if (hit === null) continue;
    report.tainted += 1;
    if (isContained(rec, hit.arg)) {
      report.contained += 1;
      continue;
    }
    report.flagged.push({
      rule: RULE_FOR[hit.taint.kind],
      line: lineOf(rec.node, file),
      key: `${rel}::${rec.fn.name}::${calleeText}#${ordinal}`,
      message:
        `${calleeText}() target \`${compactText(hit.arg, file)}\` derives from ${hit.taint.label}; ` +
        "guard with `assertInside(root, p)` against an `mkdtemp` root, or build the path under a directory made with `mkdtemp`",
    });
  }
  return report;
}
