import { parse } from 'acorn'

const scope = 'syntax-only; changed test standards still require independent review'
const blocked = new Set(['skip', 'only', 'todo', 'skipIf', 'runIf'])
const legacySelectors = new Set(['xit', 'xtest', 'xdescribe', 'xcontext', 'xspecify', 'fit', 'ftest', 'fdescribe'])
const execution = new Set(['eval', 'Function', 'constructor', 'defineProperty', 'defineProperties', 'call', 'apply', 'bind', 'getBuiltinModule', 'binding', '_linkedBinding', 'dlopen', 'createRequire'])
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

// Preserve node bodies and literal values, but not comments or source coordinates.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return typeof value === 'bigint' ? String(value) + 'n' : value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc'].includes(key)).map(([key, child]) => [key, canonical(child)]))
}


// Structural fingerprint: same assertion shape and callee, but literal payloads
// (strings/regexes/templates) are collapsed to their node type. This lets an
// attribution migration be reviewed through a file-level declaration while a
// genuinely loosened assertion (`assert.equal` → `assert.ok`) still differs.
function structural(value) {
  if (Array.isArray(value)) return value.map(structural)
  if (!value || typeof value !== 'object') return value
  // 标量（字面量/正则/模板/变量名）统一归一：静态化会把循环变量换成字面量，
  // 这正是归因迁移的典型形态，两者不应因「值 vs 引用」而形状不同。
  if (['Literal', 'RegExpLiteral', 'TemplateLiteral', 'BigIntLiteral', 'Identifier'].includes(value.type)) return { type: 'Scalar' }
  // 成员调用的属性名必须保留：它才是 `assert.equal` 与 `assert.ok` 的区别。
  if (value.type === 'MemberExpression' && !value.computed) {
    return { type: value.type, computed: false, property: value.property.name ?? value.property.value, object: structural(value.object) }
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['start', 'end', 'loc'].includes(key))
    .map(([key, child]) => [key, structural(child)]))
}

function contextOf(node) {
  if (functions.has(node.type)) return { type: node.type, id: node.id, params: node.params, async: node.async, generator: node.generator }
  if (node.type === 'VariableDeclarator') return { type: node.type, id: node.id }
  if (node.type === 'VariableDeclaration') return { type: node.type, kind: node.kind }
  if (['ReturnStatement', 'ThrowStatement', 'AwaitExpression', 'YieldExpression'].includes(node.type)) return { type: node.type, delegate: node.delegate }
  if (node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') return { type: node.type, key: node.key, computed: node.computed, kind: node.kind, static: node.static }
  if (node.type === 'CallExpression' || node.type === 'NewExpression') return { type: node.type, optional: node.optional, callee: node.callee, arguments: node.arguments.map(arg => functions.has(arg.type) ? contextOf(arg) : arg) }
  if (node.type === 'TaggedTemplateExpression') return { type: node.type, quasi: node.quasi }
  if (node.type === 'MemberExpression') return { type: node.type, property: node.property, computed: node.computed, optional: node.optional }
  if (['ArrayExpression', 'ArrayPattern', 'TryStatement', 'ChainExpression', 'SequenceExpression', 'ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(node.type)) return { type: node.type }
  if (node.type === 'ImportDeclaration') return node
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression') return { type: node.type, operator: node.operator, left: node.left }
  if (node.type === 'UnaryExpression' || node.type === 'UpdateExpression') return { type: node.type, operator: node.operator, prefix: node.prefix }
  if (node.type === 'AssignmentExpression') return { type: node.type, operator: node.operator, left: node.left }
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return { type: node.type, id: node.id, superClass: node.superClass }
  if (node.type === 'BlockStatement' || node.type === 'StaticBlock') return { type: node.type }
  if (['IfStatement', 'ConditionalExpression', 'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'SwitchCase', 'CatchClause'].includes(node.type)) return { type: node.type, await: node.await, test: node.test, init: node.init, update: node.update, left: node.left, right: node.right, discriminant: node.discriminant, param: node.param }
  return null
}

// Roles only: genuine references with local shadowing still conservatively match by name.
function referenceIdentifiers(value, references = new WeakSet(), declaration = false) {
  if (Array.isArray(value)) { value.forEach(child => referenceIdentifiers(child, references, declaration)); return references }
  if (!value || typeof value !== 'object') return references
  if (value.type === 'Identifier') { if (!declaration) references.add(value); return references }
  if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'ImportAttribute', 'MetaProperty'].includes(value.type)) return references
  for (const [key, child] of Object.entries(value)) {
    if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(value.type) && key === 'key') {
      if (value.computed) referenceIdentifiers(child, references)
      continue
    }
    if (value.type === 'MemberExpression' && key === 'property' && !value.computed) continue
    if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(value.type) && key === 'label') continue
    if (value.type === 'ExportSpecifier' && key === 'exported') continue
    const binding = value.type === 'VariableDeclarator' && key === 'id'
      || functions.has(value.type) && (key === 'id' || key === 'params')
      || ['ClassDeclaration', 'ClassExpression'].includes(value.type) && key === 'id'
      || value.type === 'CatchClause' && key === 'param'
      || declaration && (value.type === 'ObjectPattern' && key === 'properties'
        || value.type === 'ArrayPattern' && key === 'elements'
        || value.type === 'Property' && key === 'value'
        || value.type === 'RestElement' && key === 'argument'
        || value.type === 'AssignmentPattern' && key === 'left')
    referenceIdentifiers(child, references, binding)
  }
  return references
}

/** Collect the existing bounded risk rules, not a general JavaScript dataflow model. */
function collectRisks(code, { resolveImport } = {}) {
  let ast
  try { ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) }
  catch { return { reason: 'unsupported-or-incomplete-test-syntax' } }
  const references = referenceIdentifiers(ast)
  const risks = []
  const runners = new Set(['test', 'it', 'describe'])
  const imports = new Map()
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration') continue
    for (const specifier of statement.specifiers) {
      imports.set(specifier.local.name, Object.assign({}, statement, { specifiers: [specifier] }))
      if (['node:test', 'vitest', '@jest/globals'].includes(statement.source.value)) runners.add(specifier.local.name)
    }
  }
  const publicImports = new Set()
  const publicBindings = new Set()
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration') continue
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.imported.name !== 'apply' || specifier.local.name !== 'apply') continue
      let fact
      try { fact = resolveImport?.(statement.source.value) } catch { /* Unverified imports remain denied. */ }
      if (fact?.sourceRealPath && fact.strictSourceFunction === 'apply') {
        publicImports.add(specifier)
        publicBindings.add(specifier.local.name)
      }
    }
  }
  function inspect(node, parent = null, contexts = [], reach = 'module') {
    if (!node || typeof node !== 'object' || !node.type) return
    const context = contextOf(node)
    const nextContexts = context ? [...contexts, { node: context }] : contexts
    // 可达性：风险所在的构造到底跑不跑。只分三档，粗到不会因维护动作漂移，
    // 又足以拦住「把死代码 / 跳过用例里的执行塞进活用例」这种真升级。
    //   module        —— 用例之外（含普通函数里，那仍属于未证明被执行的代码）
    //   skipped-case  —— 跳过/聚焦用例的回调里（test.skip / test.only / xit / {skip:true} …）
    //   live-case     —— 正常用例的回调里
    // 不进身份的仍然是：参数序号、包裹层数、回调/分支槽位、文本、数据与同形兄弟序号。
    let callbackReach = null
    function risk(reason) {
      // 锚点上提到外层调用只在「该节点就是被调用者」时成立（`f(...)` 里的 `f`、`new C(...)` 里的 `C`）。
      // 但**选择器类风险**（`test.skip` / `xit` / `{only:true}`）锚定的是选择器本身，不该把整个用例
      // 回调正文吃进指纹——否则用例正文一动就被判成「新增风险」，而选择器语义根本没变。
      const selectorRisk = reason === 'test-execution-selector-needs-review' || reason === 'test-execution-option-needs-review'
      const anchor = !selectorRisk && (parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && parent.callee === node ? parent : node
      const names = new Set()
      function identifiers(value) {
        if (!value || typeof value !== 'object') return
        if (value.type === 'Identifier' && references.has(value)) names.add(value.name)
        for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(identifiers); else identifiers(child)
      }
      identifiers({ node: anchor, contexts: nextContexts })
      // 构造身份 = 自身规范化节点 + 引用的 import 绑定 + 可达性档位，**不含位置上下文**：
      // 把同一处既有构造在文件里挪个位置（大改写的常见情况）不该让它看起来像「新增风险」——
      // 多重集计数仍能拦住真正的净新增（数量超出的同形构造），可达性档位仍能拦住
      // 「死代码/跳过用例里的执行被搬进活用例」。绑定扫描仍用未投影的上下文，避免
      // `catch ({ local = safeApi })` 这类控制流头部的引用漏掉。
      const detail = canonical(anchor)
      const bindings = [...names].filter(name => imports.has(name)).sort().map(name => imports.get(name))
      risks.push({ reason, fingerprint: JSON.stringify(canonical({ reason, detail, bindings, reach })) })
    }
    if (node.type === 'MemberExpression') {
      const property = node.computed ? node.property.type === 'Literal' ? node.property.value : null : node.property.name
      if (property === null) risk('dynamic-test-member-needs-review')
      else if (blocked.has(property) || execution.has(property) || node.object.type === 'Identifier' && node.object.name === 'Reflect') risk('test-execution-selector-needs-review')
      // 旧式别名的成员形态，例如 `xit.each(...)` / `fdescribe.each(...)`。
      else if (node.object.type === 'Identifier' && legacySelectors.has(node.object.name)) risk('test-execution-selector-needs-review')
    }
    if (node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') {
      const key = node.computed ? node.key.type === 'Literal' ? node.key.value : null : node.key.name ?? node.key.value
      if (key === null) risk('dynamic-test-property-needs-review')
      if (parent?.type === 'ObjectPattern' && execution.has(key)) risk('runtime-code-execution-binding-needs-review')
      if (key === 'only' || blocked.has(key) && !(node.value?.type === 'Literal' && node.value.value === false)) risk('test-execution-option-needs-review')
    }
    if (node.type === 'CallExpression') {
      if (node.callee.type === 'Identifier' && publicBindings.has(node.callee.name) && (parent?.type === 'CallExpression' && parent.callee === node || parent?.type === 'NewExpression' && parent.callee === node)) risk('public-plugin-result-execution-needs-review')
      // `xit(...)` / `fit(...)` 这类旧式别名调用本身就是跳过/聚焦选择。
      if (node.callee.type === 'Identifier' && legacySelectors.has(node.callee.name)) risk('test-execution-selector-needs-review')
      const directRunner = node.callee.type === 'Identifier' && runners.has(node.callee.name)
      const namespaceRunner = node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && runners.has(node.callee.object.name)
      // 运行器调用链的可达性：`test(...)` 是活用例，`test.skip(...)` / `xit(...)` / `{skip:true}` 是跳过用例。
      // 运行器/选择器识别扫**整条非计算成员链的根标识符**，覆盖 `test.describe.skip(...)` /
      // `test.describe(...)` 这类链式写法：只看根是谁，中间节点与末节点一并判 skip/only。
      const chain = []
      for (let current = node.callee; current && current.type === 'MemberExpression' && !current.computed; current = current.object) chain.push(current.property.name)
      const chainRoot = node.callee.type === 'Identifier' ? node.callee.name
        : node.callee.type === 'MemberExpression' ? (() => { let c = node.callee; while (c.type === 'MemberExpression' && !c.computed) c = c.object; return c.type === 'Identifier' ? c.name : null })()
        : null
      const chainIsRunner = chainRoot !== null && runners.has(chainRoot)
      const chainIsSkip = chain.some(name => blocked.has(name) && name !== 'only')
      const chainIsOnly = chain.includes('only') || chainRoot !== null && /^f/.test(chainRoot) && legacySelectors.has(chainRoot)
      const selectorName = node.callee.type === 'MemberExpression' && !node.callee.computed ? node.callee.property.name : null
      const legacySelector = node.callee.type === 'Identifier' && legacySelectors.has(node.callee.name)
      const selectorIsSkip = legacySelector || chainIsSkip || selectorName !== null && blocked.has(selectorName) && selectorName !== 'only'
      const selectorIsOnly = chainIsOnly || selectorName === 'only' || node.callee.type === 'Identifier' && /^f/.test(node.callee.name) && legacySelectors.has(node.callee.name)
      if (directRunner || namespaceRunner || legacySelector || chainIsRunner) {
        const first = node.arguments[0]
        const named = first?.type === 'Literal' && typeof first.value === 'string'
        const options = named ? node.arguments[1] : first
        const callback = options && functions.has(options.type)
        if (options && !callback && (options.type !== 'ObjectExpression' || options.properties.some(property => property.type !== 'Property'))) risk('dynamic-test-options-needs-review')
        // 用例级 skip/only 选项对象（`test('x', { skip: true }, fn)`）。
        const optionSkip = options?.type === 'ObjectExpression' && options.properties.some(property => {
          if (property.type !== 'Property' || property.computed) return false
          const key = property.key.name ?? property.key.value
          return blocked.has(key) && key !== 'only' && !(property.value?.type === 'Literal' && property.value.value === false)
        })
        const optionOnly = options?.type === 'ObjectExpression' && options.properties.some(property => property.type === 'Property' && !property.computed && (property.key.name ?? property.key.value) === 'only')
        // 外层已经是 skipped-case 时，内层运行器**不得**把档位升回 live-case：
        // `test.skip('g', () => { test('a', () => { eval(code) }) })` 里那个 eval 永远不跑。
        const inheritedSkip = reach === 'skipped-case'
        if (selectorIsSkip || selectorIsOnly || optionSkip || optionOnly || inheritedSkip) callbackReach = 'skipped-case'
        else if (callback || named) callbackReach = 'live-case'
      }
    }
    if (node.type === 'ImportDeclaration' && /^(?:node:)?(?:vm|child_process|worker_threads|module)$/.test(node.source.value)) risk('runtime-code-execution-import-needs-review')
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') risk('dynamic-test-execution-needs-review')
    // 数组/对象字面量里的展开是**数据拷贝**（`[...arr]`、`{ ...obj }`），不是执行；
    // 只有**调用位**展开（`f(...args)`、`new C(...args)`）能把任意实参交给任意被调用者，才算执行风险。
    // 判定只看 AST 父节点：`SpreadElement` 只可能出现在 ArrayExpression.elements /
    // ObjectExpression.properties / CallExpression.arguments / NewExpression.arguments，因此
    // 「父节点是调用且自己位于其 arguments」即调用位，不做文本匹配，嵌套位置由父节点自然区分
    // （`f([...a])` 里的 `[...a]` 父节点是 ArrayExpression → 放行；`f(...a)` 父节点是 CallExpression → 拦）。
    const callPositionSpread = node.type === 'SpreadElement'
      && (parent?.type === 'CallExpression' || parent?.type === 'NewExpression')
      && parent.arguments.includes(node)
    if (callPositionSpread || node.type === 'ImportExpression' || node.type === 'WithStatement') risk('dynamic-test-execution-needs-review')
    if (node.type === 'Identifier' && ['eval', 'Function'].includes(node.name)) risk('dynamic-test-execution-needs-review')
    if (node.type === 'ImportSpecifier' && (blocked.has(node.imported.name ?? node.imported.value) || execution.has(node.imported.name ?? node.imported.value)) && !publicImports.has(node)) risk('test-execution-import-needs-review')
    if (node.type === 'Identifier' && publicBindings.has(node.name) && !publicImports.has(parent) && !(parent?.type === 'CallExpression' && parent.callee === node && !parent.optional)) risk('public-plugin-binding-escape-needs-review')
    for (const [key, value] of Object.entries(node)) {
      const branch = ['IfStatement', 'ConditionalExpression', 'LogicalExpression', 'TryStatement', 'TaggedTemplateExpression', 'MemberExpression', 'ChainExpression', 'SequenceExpression', 'ArrayExpression', 'ArrayPattern', 'ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(node.type) ? [...nextContexts, { edge: key }] : nextContexts
      // 可达性**继承**当前档位；只有运行器回调（`test(...)` 的函数实参）才改写成该用例的档位。
      // 这样用例体内的构造保留 `live-case`，用例外的普通函数保持 `module`，嵌套函数不重置。
      if (Array.isArray(value)) for (const [index, child] of value.entries()) {
        const argumentsContext = ['arguments', 'elements', 'expressions', 'cases'].includes(key) ? [...branch, { slot: key, index }] : branch
        const childIsCallback = callbackReach && key === 'arguments' && functions.has(child?.type)
        inspect(child, node, argumentsContext, childIsCallback ? callbackReach : reach)
      }
      else if (value && typeof value === 'object') inspect(value, node, branch, reach)
    }
  }
  inspect(ast)
  return { risks }
}

/** Narrow complete-candidate inspection; neither semantic equivalence nor independent review. */
export function inspectTestAuthoring(code, trustedFacts = {}) {
  const result = collectRisks(code, trustedFacts)
  const reason = result.reason || result.risks[0]?.reason || null
  return { allowed: !reason, reason, scope }
}

/**
 * Extract the evaluation contract at syntax level: assertion fingerprints and
 * named runner cases. Used to reject weakening (removed/rewritten assertions
 * or cases) while letting additive coverage through.
 *
 * `caseAssertions` attributes each assertion to its nearest named `test`/`it`;
 * `describe` groups but never names a case. `unattributedAssertions` holds
 * assertions that no named case owns — those stay outside the declaration
 * channel because there is no stable name to point at.
 */
export function collectAssertionFacts(code) {
  let ast
  try { ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) }
  catch { return null }
  const assertions = new Map()
  const cases = new Set()
  const caseAssertions = new Map()
  const unattributedAssertions = new Map()
  const structuralAssertions = new Map()
  const caseStructural = new Map()
  const unattributedStructural = new Map()
  const unattributedTemplates = new Map()
  const nonHelperUnattributedAssertions = new Map()
  const nonHelperUnattributedStructural = new Map()
  const nonHelperUnattributedTemplates = new Map()
  const topLevelHelperNodes = new Map()
  const topLevelHelperBodies = new Map()
  const helperCallsTotal = new Map()
  const helperCallsInCases = new Map()
  const helperCallsInNonHelperUnattributed = new Map()
  const helperCallEdges = new Map()
  const shadowedHelpers = new Set()
  const runners = new Set(['test', 'it', 'describe'])
  const caseRunners = new Set(['test', 'it'])
  for (const statement of ast.body) {
    if (statement?.type !== 'ImportDeclaration') continue
    if (!['node:test', 'vitest', '@jest/globals'].includes(statement.source.value)) continue
    for (const specifier of statement.specifiers) {
      runners.add(specifier.local.name)
    }
  }
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1)
  function calleeRoot(node) {
    let current = node
    while (current && current.type === 'MemberExpression' && !current.computed) current = current.object
    if (current?.type === 'CallExpression') return calleeRoot(current.callee)
    return current?.type === 'Identifier' ? current.name : null
  }
  function runnerCallInfo(node) {
    const directRunner = node.callee.type === 'Identifier' && runners.has(node.callee.name)
    const chain = []
    let current = node.callee
    while (current) {
      if (current.type === 'ChainExpression') {
        current = current.expression
      } else if (current.type === 'CallExpression') {
        current = current.callee
      } else if (current.type === 'MemberExpression') {
        const prop = current.computed
          ? (current.property.type === 'Literal' ? current.property.value : null)
          : current.property.name
        if (typeof prop === 'string') chain.push(prop)
        current = current.object
      } else {
        break
      }
    }
    const chainRoot = current?.type === 'Identifier' ? current.name : null
    const chainIsRunner = chainRoot !== null && runners.has(chainRoot)
    const legacySelector = chainRoot !== null && legacySelectors.has(chainRoot)
    const isRunner = directRunner || legacySelector || chainIsRunner
    if (!isRunner) return { isRunner: false, directRunner: false, skipped: false }
    const chainIsSkip = chain.some(name => blocked.has(name) && name !== 'only')
    const chainIsOnly = chain.includes('only') || (chainRoot !== null && /^f/.test(chainRoot) && legacySelectors.has(chainRoot))
    const selectorIsSkip = legacySelector || chainIsSkip
    const selectorIsOnly = chainIsOnly
    const first = node.arguments[0]
    const named = first?.type === 'Literal' && typeof first.value === 'string'
    const options = named ? node.arguments[1] : first
    const propertyKey = property => {
      if (property.type !== 'Property') return null
      if (property.computed) return property.key.type === 'Literal' ? property.key.value : null
      return property.key.name ?? property.key.value
    }
    const optionSkip = options?.type === 'ObjectExpression' && options.properties.some(property => {
      const key = propertyKey(property)
      return typeof key === 'string' && blocked.has(key) && key !== 'only' && !(property.value?.type === 'Literal' && property.value.value === false)
    })
    const optionOnly = options?.type === 'ObjectExpression' && options.properties.some(property => propertyKey(property) === 'only')
    return {
      isRunner: true,
      directRunner,
      skipped: Boolean(selectorIsSkip || selectorIsOnly || optionSkip || optionOnly),
    }
  }
  function isPureAssertionHelper(fnNode) {
    let hasRunner = false
    let hasAssertion = false
    function scan(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(scan); return }
      if (!node.type) return
      if (node.type === 'CallExpression') {
        const root = calleeRoot(node.callee)
        if (root === 'assert' || root === 'expect') hasAssertion = true
        if (root !== null && (runners.has(root) || legacySelectors.has(root))) hasRunner = true
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(scan)
        else if (value && typeof value === 'object') scan(value)
      }
    }
    scan(fnNode.params)
    scan(fnNode.body)
    return !hasRunner && hasAssertion
  }
  const topLevelFnByName = new Map()
  for (const stmt of ast.body) {
    if (stmt?.type === 'FunctionDeclaration' && stmt.id?.name) {
      const name = stmt.id.name
      if (topLevelFnByName.has(name)) {
        const prev = topLevelFnByName.get(name)
        if (prev) topLevelHelperNodes.delete(prev)
        topLevelHelperBodies.delete(name)
        topLevelFnByName.set(name, null)
      } else {
        topLevelFnByName.set(name, stmt)
        if (isPureAssertionHelper(stmt)) {
          topLevelHelperNodes.set(stmt, name)
          topLevelHelperBodies.set(name, JSON.stringify(canonical(stmt)))
        }
      }
    }
  }
  function checkShadowPattern(pattern) {
    if (!pattern || typeof pattern !== 'object') return
    if (pattern.type === 'Identifier' && topLevelHelperBodies.has(pattern.name)) shadowedHelpers.add(pattern.name)
    else if (pattern.type === 'AssignmentPattern') checkShadowPattern(pattern.left)
    else if (pattern.type === 'RestElement') checkShadowPattern(pattern.argument)
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(checkShadowPattern)
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(p => checkShadowPattern(p.type === 'RestElement' ? p.argument : p.value))
  }
  function recordFact(fingerprint, structuralFingerprint, caseName, template, activeHelper, inSkipped) {
    // Skipped/focused test bodies never execute as live coverage and must not
    // credit live assertions or compensate for removed/migrated live assertions.
    if (inSkipped) return
    bump(assertions, fingerprint)
    bump(structuralAssertions, structuralFingerprint)
    if (caseName === null) {
      bump(unattributedAssertions, fingerprint)
      bump(unattributedStructural, structuralFingerprint)
      let ownTemplate = unattributedTemplates.get(template ?? 'top')
      if (!ownTemplate) unattributedTemplates.set(template ?? 'top', ownTemplate = new Map())
      bump(ownTemplate, structuralFingerprint)
      if (activeHelper === null) {
        bump(nonHelperUnattributedAssertions, fingerprint)
        bump(nonHelperUnattributedStructural, structuralFingerprint)
        let ownNonHelperTemplate = nonHelperUnattributedTemplates.get(template ?? 'top')
        if (!ownNonHelperTemplate) nonHelperUnattributedTemplates.set(template ?? 'top', ownNonHelperTemplate = new Map())
        bump(ownNonHelperTemplate, structuralFingerprint)
      }
    } else {
      let own = caseAssertions.get(caseName)
      if (!own) caseAssertions.set(caseName, own = new Map())
      bump(own, fingerprint)
      let ownStructural = caseStructural.get(caseName)
      if (!ownStructural) caseStructural.set(caseName, ownStructural = new Map())
      bump(ownStructural, structuralFingerprint)
    }
  }
  function visit(node, caseName, template, activeHelper, inSkipped) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(child => visit(child, caseName, template, activeHelper, inSkipped)); return }
    if (!node.type) return
    const nextHelper = topLevelHelperNodes.has(node) ? topLevelHelperNodes.get(node) : activeHelper
    if (!topLevelHelperNodes.has(node)) {
      if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.id?.name && topLevelHelperBodies.has(node.id.name)) {
        shadowedHelpers.add(node.id.name)
      }
      if (functions.has(node.type) && Array.isArray(node.params)) node.params.forEach(checkShadowPattern)
      if (node.type === 'VariableDeclarator') checkShadowPattern(node.id)
      if (node.type === 'CatchClause' && node.param) checkShadowPattern(node.param)
      if (node.type === 'AssignmentExpression') checkShadowPattern(node.left)
      if ((node.type === 'ForOfStatement' || node.type === 'ForInStatement') && node.left?.type !== 'VariableDeclaration') checkShadowPattern(node.left)
      if (node.type === 'UpdateExpression') checkShadowPattern(node.argument)
    }
    let childCase = caseName
    let childInSkipped = inSkipped
    // 无主断言的「模板分组」：顶层 for 循环内的断言各成一组。多种模板循环共存时，
    // 静态化后每个新用例的形状集合应等于其中某个模板的完整形状集合（issue #4099）。
    let childTemplate = template
    if (caseName === null && nextHelper === null && ['ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) childTemplate = node.start
    if (node.type === 'CallExpression') {
      if (!inSkipped && node.callee.type === 'Identifier' && topLevelHelperBodies.has(node.callee.name)) {
        const calleeName = node.callee.name
        bump(helperCallsTotal, calleeName)
        if (caseName !== null) bump(helperCallsInCases, calleeName)
        else if (nextHelper !== null) {
          let edges = helperCallEdges.get(nextHelper)
          if (!edges) helperCallEdges.set(nextHelper, edges = new Set())
          edges.add(calleeName)
        } else {
          bump(helperCallsInNonHelperUnattributed, calleeName)
        }
        // Treat invocations of top-level assertion helpers outside other helpers
        // as first-class assertion call sites (preserving helper name + args in
        // canonical fingerprints and helper name + arg shapes in structural
        // fingerprints), so helper calls cannot be silently dropped, faked, or
        // moved across cases during migration.
        if (nextHelper === null) {
          const callFingerprint = JSON.stringify(canonical({ type: 'HelperCall', name: calleeName, arguments: node.arguments }))
          const callStructuralFingerprint = JSON.stringify({ type: 'HelperCall', name: calleeName, arguments: structural(node.arguments) })
          recordFact(callFingerprint, callStructuralFingerprint, caseName, childTemplate, null, inSkipped)
        }
      }
      const root = calleeRoot(node.callee)
      if (root === 'assert' || root === 'expect') {
        const fingerprint = JSON.stringify(canonical({ callee: node.callee, arguments: node.arguments }))
        const structuralFingerprint = JSON.stringify(structural({ callee: node.callee, arguments: node.arguments }))
        recordFact(fingerprint, structuralFingerprint, caseName, childTemplate, nextHelper, inSkipped)
      }
      const runnerInfo = runnerCallInfo(node)
      if (runnerInfo.isRunner) {
        if (runnerInfo.skipped) childInSkipped = true
        const first = node.arguments[0]
        if (!childInSkipped && runnerInfo.directRunner && first?.type === 'Literal' && typeof first.value === 'string') {
          cases.add(first.value)
          if (caseRunners.has(node.callee.name)) childCase = first.value
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, childCase, childTemplate, nextHelper, childInSkipped))
      else if (value && typeof value === 'object') visit(value, childCase, childTemplate, nextHelper, childInSkipped)
    }
  }
  visit(ast, null, null, null, false)
  return {
    assertions, cases, caseAssertions, unattributedAssertions, structuralAssertions, caseStructural,
    unattributedStructural, unattributedTemplates, topLevelHelperBodies, helperCallsTotal,
    helperCallsInCases, helperCallsInNonHelperUnattributed, helperCallEdges, shadowedHelpers,
    nonHelperUnattributedAssertions, nonHelperUnattributedStructural, nonHelperUnattributedTemplates,
  }
}

const sumCounts = map => { let total = 0; for (const count of map.values()) total += count; return total }
const mergeCounts = maps => {
  const out = new Map()
  for (const map of maps) for (const [key, count] of map) out.set(key, (out.get(key) || 0) + count)
  return out
}

function reachableHelpersFromCases(facts) {
  const reachable = new Set()
  const queue = []
  for (const [name, count] of facts.helperCallsInCases) {
    if (count > 0 && facts.topLevelHelperBodies.has(name)) {
      reachable.add(name)
      queue.push(name)
    }
  }
  while (queue.length) {
    const current = queue.shift()
    for (const next of facts.helperCallEdges.get(current) || []) {
      if (!reachable.has(next) && facts.topLevelHelperBodies.has(next)) {
        reachable.add(next)
        queue.push(next)
      }
    }
  }
  return reachable
}

/**
 * True only when every top-level assertion helper in `before` and `after` is
 * identical (exact canonical AST), unshadowed, still called at least as many
 * times as before, no longer called from loose/dynamic unattributed code, and
 * reachable from live named test cases. Prevents mutating, adding, or dead-coding
 * helpers during attribution migration.
 */
function preservedTopLevelHelpers(beforeFacts, afterFacts) {
  if (!beforeFacts.topLevelHelperBodies.size || beforeFacts.topLevelHelperBodies.size !== afterFacts.topLevelHelperBodies.size) {
    return false
  }
  const reachable = reachableHelpersFromCases(afterFacts)
  for (const [name, afterBody] of afterFacts.topLevelHelperBodies) {
    if (beforeFacts.topLevelHelperBodies.get(name) !== afterBody) return false
    if (afterFacts.shadowedHelpers.has(name)) return false
    const beforeCalls = beforeFacts.helperCallsTotal.get(name) || 0
    const afterCalls = afterFacts.helperCallsTotal.get(name) || 0
    if (beforeCalls < 1 || afterCalls < beforeCalls) return false
    if ((afterFacts.helperCallsInNonHelperUnattributed.get(name) || 0) > 0) return false
    if (!reachable.has(name)) return false
  }
  return true
}

/**
 * Bounded channel B: `before` assertions that no named case owned moved into
 * named cases. Allowed to reach the declaration channel only when nothing was
 * lost or loosened — total assertion count must not drop, every pre-existing
 * unattributed assertion *shape* must still exist afterwards, and those shapes
 * must now be owned by named cases (unchanged, live-called top-level assertion
 * helpers may remain at top level while every non-helper unattributed assertion
 * migrates completely).
 */
function isAttributionMigration(beforeFacts, afterFacts) {
  if (!beforeFacts.unattributedStructural.size) return false
  if (sumCounts(afterFacts.structuralAssertions) < sumCounts(beforeFacts.structuralAssertions)) return false
  const afterRemainingUnattributed = sumCounts(afterFacts.unattributedAssertions)
  const keptHelpersOnly = afterRemainingUnattributed > 0
    && sumCounts(afterFacts.nonHelperUnattributedAssertions) === 0
    && beforeFacts.nonHelperUnattributedStructural.size > 0
    && preservedTopLevelHelpers(beforeFacts, afterFacts)
  // 迁移必须把非辅助函数的无主断言**全部**交出去：after 残留任何非原样保留 helper
  // 的无主断言都不算完成（review F3）。
  if (afterRemainingUnattributed > 0 && !keptHelpersOnly) return false
  const migratedStructural = keptHelpersOnly ? beforeFacts.nonHelperUnattributedStructural : beforeFacts.unattributedStructural
  const migratedTemplates = keptHelpersOnly ? beforeFacts.nonHelperUnattributedTemplates : beforeFacts.unattributedTemplates
  const beforeUnattributed = sumCounts(migratedStructural)
  const afterAttributed = mergeCounts([...afterFacts.caseStructural.values()])
  if (sumCounts(afterAttributed) < beforeUnattributed) return false
  for (const [fingerprint, count] of beforeFacts.unattributedStructural) {
    const hit = afterFacts.structuralAssertions.get(fingerprint) || 0
    if (hit < count) return false
  }
  // 迁移必须是「整组复制」：每个新出现的具名用例，其断言形状集合必须等于 before
  // 某个无主「模板」的完整形状集合。单模板时等价于原判定；同一文件里本来就有多个
  // 模板循环时（issue #4099：UI 与非 UI 两套用例），各模板可以各自完整迁移。
  // 「a 用例放宽一条、b 用例补上一条」会让 a 的形状集合对不上任何模板 → 仍被拒。
  // Pre-existing named cases must stay intact during an attribution migration:
  // weakening or deleting an existing named case cannot hide behind `:: *`.
  for (const name of beforeFacts.cases) {
    if (!afterFacts.cases.has(name)) return false
  }
  for (const [name, beforeOwn] of beforeFacts.caseAssertions) {
    const afterOwn = afterFacts.caseAssertions.get(name)
    if (!afterOwn) return false
    for (const [fingerprint, count] of beforeOwn) {
      if ((afterOwn.get(fingerprint) || 0) < count) return false
    }
  }
  const templateShapeSets = [...migratedTemplates.values()]
    .map(map => [...map.keys()].sort().join('\u0000'))
  const newCaseNames = [...afterFacts.caseStructural.keys()].filter(name => !beforeFacts.cases.has(name))
  if (!newCaseNames.length) return false
  if (keptHelpersOnly) {
    const newAttributed = mergeCounts(newCaseNames.map(name => afterFacts.caseStructural.get(name)))
    for (const [fingerprint, count] of migratedStructural) {
      if ((newAttributed.get(fingerprint) || 0) < count) return false
    }
  }
  for (const name of newCaseNames) {
    const own = afterFacts.caseStructural.get(name)
    if (!templateShapeSets.includes([...own.keys()].sort().join('\u0000'))) return false
  }
  return true
}

/**
 * Evaluation-contract comparison that also names the cases it would reject.
 *
 * Same decision as `inspectTestAuthoringDelta`, plus `changedCases`: the named
 * cases whose assertions were weakened or that were removed outright. The
 * declaration channel can only open for named cases — an unnamed assertion
 * weakening stays a hard rejection.
 */
export function inspectTestStandardChange(before, after, trustedFacts = {}) {
  const old = collectRisks(before, trustedFacts)
  const candidate = collectRisks(after, trustedFacts)
  if (old.reason || candidate.reason) return { allowed: false, reason: old.reason || candidate.reason, scope, changedCases: [] }
  const remaining = new Map()
  for (const risk of old.risks) remaining.set(risk.fingerprint, (remaining.get(risk.fingerprint) || 0) + 1)
  for (const risk of candidate.risks) {
    const count = remaining.get(risk.fingerprint) || 0
    if (!count) return { allowed: false, reason: risk.reason, scope, changedCases: [] }
    remaining.set(risk.fingerprint, count - 1)
  }
  const beforeFacts = collectAssertionFacts(before)
  const afterFacts = collectAssertionFacts(after)
  if (!beforeFacts || !afterFacts) return { allowed: false, reason: 'unsupported-or-incomplete-test-syntax', scope, changedCases: [] }
  // Reassigning or locally shadowing any pre-existing top-level assertion
  // helper silently neuters all of its call sites — deny unconditionally on
  // both migration and non-migration edits.
  for (const name of beforeFacts.topLevelHelperBodies.keys()) {
    if (afterFacts.shadowedHelpers.has(name) && !beforeFacts.shadowedHelpers.has(name)) {
      return {
        allowed: false,
        reason: 'test-assertion-removed-or-rewritten',
        scope,
        changedCases: [],
        attributionMigration: false,
      }
    }
  }
  // A: per-fingerprint compensation — an assertion may move from the
  // unattributed bucket into a named case, but only if the named side really
  // gained the same fingerprint. Comparing totals (or only the before
  // unattributed side) would let a real removal slip through whenever the same
  // fingerprint still exists inside some named case (review F1).
  const beforeNamed = mergeCounts([...beforeFacts.caseAssertions.values()])
  const afterNamed = mergeCounts([...afterFacts.caseAssertions.values()])
  // 归因迁移必须一次交清：一旦检测到无主断言真的减少（迁移发生），after 不得
  // 残留任何非「原样保留且仍被具名用例调用的顶层断言 helper」的无主断言
  // （否则「迁一半、留一半」会绕过完整迁移审查，review F3）。
  // 只有「减少后仍有非保留 helper 的残留」才是削弱信号；无主断言原样不动（例如追加用例）不算。
  const afterUnattributedTotal = sumCounts(afterFacts.unattributedAssertions)
  let anyUnattributedDropped = false
  for (const [fingerprint, count] of beforeFacts.unattributedAssertions) {
    if ((afterFacts.unattributedAssertions.get(fingerprint) || 0) < count) {
      anyUnattributedDropped = true
      break
    }
  }
  const onlyPreservedHelpersRemain = afterUnattributedTotal > 0
    && sumCounts(afterFacts.nonHelperUnattributedAssertions) === 0
    && preservedTopLevelHelpers(beforeFacts, afterFacts)
  let assertionDeficit = anyUnattributedDropped && afterUnattributedTotal > 0 && !onlyPreservedHelpersRemain
  // When migrating dynamic loops in a file with preserved helpers (Path A),
  // verify that migrated helper calls and assertions landed inside new named
  // cases matching pre-existing template shapes (preventing dropping helper
  // calls from one migrated loop while padding another or an existing test).
  if (!assertionDeficit && anyUnattributedDropped && onlyPreservedHelpersRemain) {
    const templateShapeSets = [...beforeFacts.nonHelperUnattributedTemplates.values()]
      .map(map => [...map.keys()].sort().join('\u0000'))
    const newCaseNames = [...afterFacts.caseStructural.keys()].filter(name => !beforeFacts.cases.has(name))
    if (!newCaseNames.length) {
      assertionDeficit = true
    } else {
      const newAttributed = mergeCounts(newCaseNames.map(name => afterFacts.caseStructural.get(name)))
      for (const [fingerprint, count] of beforeFacts.nonHelperUnattributedStructural) {
        if ((newAttributed.get(fingerprint) || 0) < count) { assertionDeficit = true; break }
      }
      if (!assertionDeficit) {
        for (const name of newCaseNames) {
          const own = afterFacts.caseStructural.get(name)
          if (!templateShapeSets.includes([...own.keys()].sort().join('\u0000'))) {
            assertionDeficit = true
            break
          }
        }
      }
    }
  }
  const fingerprints = new Set([...beforeFacts.unattributedAssertions.keys(), ...beforeNamed.keys()])
  if (!assertionDeficit) {
    for (const fingerprint of fingerprints) {
      const drop = (beforeFacts.unattributedAssertions.get(fingerprint) || 0) - (afterFacts.unattributedAssertions.get(fingerprint) || 0)
      if (drop <= 0) continue
      // 负增量按 0 处理：具名侧本来就有同指纹断言不等于本次新增。
      const increase = Math.max(0, (afterNamed.get(fingerprint) || 0) - (beforeNamed.get(fingerprint) || 0))
      if (drop > increase) { assertionDeficit = true; break }
    }
  }
  if (assertionDeficit) {
    // B: the remaining way to a named-case contract is a reviewed attribution
    // migration. It must never mask a real removal or a loosened assertion.
    return {
      allowed: false,
      reason: 'test-assertion-removed-or-rewritten',
      scope,
      changedCases: [],
      attributionMigration: isAttributionMigration(beforeFacts, afterFacts),
    }
  }
  const removedCases = []
  const weakenedCases = []
  for (const [name, beforeAssertions] of beforeFacts.caseAssertions) {
    const afterAssertions = afterFacts.caseAssertions.get(name)
    if (!afterAssertions) { removedCases.push(name); continue }
    for (const [fingerprint, count] of beforeAssertions) {
      if ((afterAssertions.get(fingerprint) || 0) < count) { weakenedCases.push(name); break }
    }
  }
  for (const name of beforeFacts.cases) {
    if (!afterFacts.cases.has(name) && !removedCases.includes(name)) removedCases.push(name)
  }
  if (removedCases.length || weakenedCases.length) {
    return {
      allowed: false,
      reason: removedCases.length ? 'test-case-removed-or-renamed' : 'test-assertion-removed-or-rewritten',
      scope,
      changedCases: [...removedCases, ...weakenedCases].sort(),
      attributionMigration: false,
    }
  }
  return { allowed: true, reason: null, scope, changedCases: [], attributionMigration: false }
}

/** Pure comparison; the guard, never tool-supplied metadata, owns the actual before source. */
export function inspectTestAuthoringDelta(before, after, trustedFacts = {}) {
  const { allowed, reason } = inspectTestStandardChange(before, after, trustedFacts)
  return { allowed, reason, scope }
}

/**
 * `## 旧标准变更` declaration lines: `- `<repo-relative path>` :: `<case name>``.
 * Use a double-backtick case fence when the case name contains literal single backticks.
 * A strict single-line shape keeps matching unambiguous.
 */
const OLD_STANDARD_DECLARATION = /^\s*[-*]\s+`([^`]+)`\s*::\s*(?:`([^`]+)`|``([^`]+(?:`[^`]+)+)``)\s*$/

/** Parse the `## 旧标准变更` section body into declarations. Pure; no filesystem access. */
export function parseOldStandardDeclarations(sectionText) {
  const out = []
  for (const line of String(sectionText ?? '').split(/\r?\n/)) {
    const match = OLD_STANDARD_DECLARATION.exec(line)
    if (match) {
      const [, path, singleFenced, doubleFenced] = match
      out.push({ path: path.trim(), caseName: (singleFenced ?? doubleFenced).trim() })
    }
  }
  return out
}

/**
 * Every changed case of this file must be declared, path and name both exact.
 * Returns the names still missing so a rejection can name what to declare.
 */
export function matchOldStandardDeclarations({ declarations, filePath, changedCases } = {}) {
  const declared = new Set(
    (Array.isArray(declarations) ? declarations : [])
      .filter(entry => entry && entry.path === filePath)
      .map(entry => entry.caseName),
  )
  const missing = (Array.isArray(changedCases) ? changedCases : []).filter(name => !declared.has(name))
  return { ok: missing.length === 0, missing }
}

export function __collectRisks(code) { return collectRisks(code, {}) }
