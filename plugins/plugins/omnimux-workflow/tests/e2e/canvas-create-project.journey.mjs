import assert from 'node:assert/strict'
import { join } from 'node:path'

const INPUT = '#omnimux-new-local-project-name'
const DIALOG = '[role="dialog"].omnimux-project-create'
const STATUS = '[data-omnimux-new-project-preflight]'

export default async function canvasCreateProjectJourney({ send, sleep, evidenceDir, io }) {
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true })
    assert.ok(!response.exceptionDetails, response.exceptionDetails?.text)
    return response.result?.value
  }
  const waitFor = async (expression, message) => {
    const deadline = Date.now() + 10_000
    do {
      const result = await evaluate(expression)
      if (result) return result
      await sleep(150)
    } while (Date.now() < deadline)
    assert.fail(message)
  }
  const click = async (selector, labels = []) => {
    const point = await waitFor(`(() => {
      for (const target of document.querySelectorAll(${JSON.stringify(selector)})) {
        const labels = ${JSON.stringify(labels)};
        if (target.disabled || (labels.length && !labels.includes(target.textContent.trim()))) continue;
        const { left, top, width, height } = target.getBoundingClientRect();
        const x = left + width / 2, y = top + height / 2;
        if (width && height && target.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    })()`, `No visible target for ${selector}`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
    }
  }
  const capture = async (name) => {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    assert.ok(screenshot.data)
    io.writeFileSync(join(evidenceDir, name + '.png'), Buffer.from(screenshot.data, 'base64'))
  }
  const theme = (value) => send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }],
  })
  const status = `document.querySelector(${JSON.stringify(STATUS)})`
  const dialog = `document.querySelector(${JSON.stringify(DIALOG)})`
  const paint = `getComputedStyle(${dialog}).backgroundColor`

  await theme('light')
  await click('[data-dsh-omnimux-workflow-entry], .omnimux-workflow-entry')
  await click('button[aria-label="新标签页"], button[aria-label="New tab"]')
  await click('[role="menuitem"], [role="option"], button', ['创作画布', 'Creative Canvas'])
  await waitFor(`${status}?.dataset.preflightAction === 'initialize'`, 'The seeded canvas opens a checked create dialog')
  const selected = await evaluate(`(() => {
    const card = ${dialog};
    const group = card?.querySelector('.omnimux-project-create-fields');
    const path = group?.querySelector('.omnimux-project-create-path');
    return {
      grouped: group?.contains(document.querySelector(${JSON.stringify(INPUT)})),
      headerIcon: Boolean(card?.querySelector('h2 svg')),
      focused: document.activeElement?.id === 'omnimux-new-local-project-name',
      completePath: Boolean(path?.title) && path.title === path.textContent.trim(),
    };
  })()`)
  assert.deepEqual(selected, { grouped: true, headerIcon: true, focused: true, completePath: true })
  await capture('create-project-light')
  const light = await evaluate(paint)
  await theme('dark')
  await waitFor(`${paint} !== ${JSON.stringify(light)}`, 'Dark theme updates the modal paint')

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 780, deviceScaleFactor: 1, mobile: false,
  })
  try {
    await waitFor('innerWidth === 390', 'Narrow viewport is active')
    const fits = await evaluate(`(() => {
      const card = ${dialog};
      const box = card.getBoundingClientRect();
      const change = card.querySelector('[data-omnimux-new-project-change]').getBoundingClientRect();
      const destination = card.querySelector('.omnimux-project-create-destination');
      return box.left >= 0 && box.right <= innerWidth && change.right < box.right
        && getComputedStyle(destination).display === 'block';
    })()`)
    assert.equal(fits, true)
    await capture('create-project-narrow-dark')

    await click('[data-omnimux-new-project-remove]')
    const destination = await evaluate(`(() => {
      const card = ${dialog};
      return {
        independent: ${status}?.dataset.preflightState === 'independent',
        chooserFocused: document.activeElement?.hasAttribute('data-omnimux-new-project-drop'),
        namePreserved: Boolean(document.querySelector(${JSON.stringify(INPUT)}).value),
        hasDefaultLibrary: ['默认项目库', 'Default project library']
          .includes(card.querySelector('.omnimux-project-create-path').textContent.trim()),
      };
    })()`)
    assert.deepEqual(destination, { independent: true, chooserFocused: true, namePreserved: true, hasDefaultLibrary: true })
    await capture('create-project-default-library')
  } finally {
    await send('Emulation.clearDeviceMetricsOverride')
  }

  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  await waitFor(`!${dialog}`, 'Escape dismisses the dialog')
  return { assertions: [
    { name: 'canvas-entry-grouped-project-fields', pass: true },
    { name: 'narrow-theme-location-actions', pass: true },
    { name: 'default-library-keyboard-flow', pass: true },
  ] }
}
