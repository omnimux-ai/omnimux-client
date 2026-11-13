import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import {
  IconFolderOutline16,
  IconGridOutline16,
  IconListOutline16,
  IconCalendarOutline16,
} from './icons/stage.js'

describe('Stage Icons (Track D Hotfix: missing primitives补齐)', () => {
  it('IconFolderOutline16 renders valid svg element with default 16px size', () => {
    const el = React.createElement(IconFolderOutline16)
    assert.equal(typeof el.type, 'function')
    const rendered = el.type({})
    assert.equal(rendered.type, 'svg')
    assert.equal(rendered.props.width, 16)
    assert.equal(rendered.props.height, 16)
    assert.equal(rendered.props.viewBox, '0 0 16 16')
    assert.equal(rendered.props.stroke, 'currentColor')
    assert.equal(rendered.props['aria-hidden'], 'true')
  })

  it('IconGridOutline16 renders valid svg element with 4 grid rects', () => {
    const el = React.createElement(IconGridOutline16)
    assert.equal(typeof el.type, 'function')
    const rendered = el.type({})
    assert.equal(rendered.type, 'svg')
    assert.equal(rendered.props.width, 16)
    assert.equal(rendered.props.height, 16)
    assert.equal(rendered.props.viewBox, '0 0 16 16')
    assert.equal(rendered.props.stroke, 'currentColor')
    assert.equal(React.Children.count(rendered.props.children), 4)
  })

  it('IconListOutline16 renders valid svg element with lines', () => {
    const el = React.createElement(IconListOutline16)
    assert.equal(typeof el.type, 'function')
    const rendered = el.type({})
    assert.equal(rendered.type, 'svg')
    assert.equal(rendered.props.width, 16)
    assert.equal(rendered.props.height, 16)
    assert.equal(rendered.props.viewBox, '0 0 16 16')
    assert.equal(rendered.props.stroke, 'currentColor')
    assert.equal(React.Children.count(rendered.props.children), 6)
  })

  it('IconCalendarOutline16 renders valid svg element with calendar frame', () => {
    const el = React.createElement(IconCalendarOutline16)
    assert.equal(typeof el.type, 'function')
    const rendered = el.type({})
    assert.equal(rendered.type, 'svg')
    assert.equal(rendered.props.width, 16)
    assert.equal(rendered.props.height, 16)
    assert.equal(rendered.props.viewBox, '0 0 16 16')
    assert.equal(rendered.props.stroke, 'currentColor')
  })

  it('custom size and className pass through correctly', () => {
    const el = React.createElement(IconFolderOutline16, { size: 20, className: 'custom-icon' })
    const rendered = el.type(el.props)
    assert.equal(rendered.props.width, 20)
    assert.equal(rendered.props.height, 20)
    assert.equal(rendered.props.className, 'custom-icon')
  })
})
