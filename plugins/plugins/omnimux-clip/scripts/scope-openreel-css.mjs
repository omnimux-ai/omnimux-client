import selectorParser from 'postcss-selector-parser'

const rootClass = 'openreel-studio-root'
const scope = selectorParser().astSync(`:where(.${rootClass})`).first.first
const isDocument = node => (node.type === 'tag' && /^(html|body)$/i.test(node.value)) || (node.type === 'pseudo' && node.value === ':root')
const isTheme = node => (node.type === 'class' && node.value === 'dark') || (node.type === 'attribute' && node.attribute === 'data-theme')

function scopeSelector(selector) {
  const anchor = scope.clone()
  // Replace leading document wrappers with the editor root, retaining
  // qualifiers like body:has(.editor-shell) and html[data-theme] > body.
  let hasRoot = false
  for (;;) {
    const combinator = selector.nodes.findIndex(node => node.type === 'combinator')
    const compound = selector.nodes.slice(0, combinator < 0 ? undefined : combinator)
    if (!compound.some(isDocument) && !compound.some(isTheme)) break
    hasRoot = true
    for (const node of compound) {
      if (!isDocument(node)) anchor.first.append(node.clone())
      node.remove()
    }
    const separator = selector.first
    if (separator?.type !== 'combinator' || !['', '>'].includes(separator.value.trim())) break
    // Only fold the separator when another document wrapper follows it.
    const next = selector.nodes.slice(1).find(node => node.type !== 'comment')
    if (!next || !isDocument(next)) break
    separator.remove()
  }
  const alreadyScoped = selector.first?.type === 'class' && selector.first.value === rootClass
  if (hasRoot || alreadyScoped) {
    const firstCombinator = selector.nodes.find(node => node.type === 'combinator')
    if (firstCombinator && !['', '>'].includes(firstCombinator.value.trim())) {
      throw new Error(`Clip stylesheet selector escapes the studio root: ${selector}`)
    }
    if (hasRoot) selector.prepend(anchor)
    return
  }

  // Some sheets, including Tailwind preflight, use the universal selector to
  // initialize every element. Include the studio root in that reset.
  if (selector.nodes.length === 1 && selector.first.type === 'universal') {
    selector.parent.insertBefore(selector, selectorParser().astSync(`:where(.${rootClass})`).first)
  }
  selector.prepend(selectorParser.combinator({ value: ' ' }))
  selector.prepend(anchor)
}

export function scopeOpenReelCss() {
  return {
    postcssPlugin: 'omnimux-clip-scope-openreel',
    OnceExit(root) {
      const animations = new Map()
      root.walkAtRules(/keyframes$/i, rule => {
        const name = `omnimux-clip-${rule.params}`
        animations.set(rule.params, name)
        rule.params = name
      })
      root.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/, declaration => {
        declaration.value = declaration.value.replace(/[\w-]+/g, word => animations.get(word) ?? word)
      })
      root.walkRules(rule => {
        for (let parent = rule.parent; parent; parent = parent.parent) {
          if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return
        }
        rule.selector = selectorParser(selectors => {
          selectors.each(scopeSelector)
        }).processSync(rule.selector)
      })
    },
  }
}
