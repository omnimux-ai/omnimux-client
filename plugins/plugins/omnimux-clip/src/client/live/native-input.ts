import { ClipDomainError } from '../../errors.js'

export type Fields = Record<string, unknown>

export function invalid(message: string): never {
  throw ClipDomainError.invalidJson(message)
}

export function fields(value: unknown, name: string): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid(`${name} must be a plain object`)
  return value as Fields
}

export function number(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(`${name} must be a number between ${min} and ${max}`)
  }
  return value
}

export function seconds(input: Fields, sec: string, ms: string): number | undefined {
  const current = input[sec] === undefined ? undefined : number(input[sec], sec)
  const legacy = input[ms] === undefined ? undefined : number(input[ms], ms) / 1000
  return current ?? legacy
}

export function boolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') invalid(`${name} must be a boolean`)
  return value
}

export function text(value: unknown, name: string, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) invalid(`${name} must be text up to ${limit} characters`)
  return value
}

export function referenceId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[^\s/\\<>\x00-\x1f\x7f-\x9f]{1,256}$/u.test(value)
    || /^(?:blob|data|file|javascript|https?):/i.test(value)) invalid(`${name} must be an ID`)
  return value
}

export function onlyKeys(input: Fields, allowed: readonly string[], name: string): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) invalid(`${name} contains an unsupported field`)
}

const sourceFields = new Set(['path', 'sourceurl', 'url', 'source', 'sourceref', 'assetid', 'mediaref', 'assetref', 'resolvedmedia', 'file', 'filehandle', 'blob', 'nativesource', 'sourcefile', 'originalurl'])
const motionFields = new Set(['expression', 'expressions', 'code', 'sourcecode', 'script', 'approved', 'trusted', 'shader', 'shaderid', 'motioncompositions', 'motioninstances'])

export function assertSafeFields(operation: Fields): void {
  const mayResolveMedia = operation.type === 'import_media'
    || operation.type === 'relink_media'
    || (operation.type === 'add_clip' && operation.mediaId === undefined && operation.mediaType !== 'text')
  // Even nested input is data. Only the resolver receives an explicit media
  // reference, and none of the supplied objects are merged into a project.
  function visit(value: unknown, depth: number, inReference: boolean): void {
    if (depth > 12) invalid('Edit options are nested too deeply')
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, inReference)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(fields(value, 'edit options'))) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '')
      if (motionFields.has(normalized)) throw new ClipDomainError('motion-expression-denied', 'Motion code and approval fields are unavailable in Clip tools')
      if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid('Unsupported edit option')
      const isReference = inReference || (depth === 0 && mayResolveMedia && sourceFields.has(normalized))
      if (sourceFields.has(normalized) && (!isReference || ['file', 'filehandle', 'blob'].includes(normalized))) {
        throw ClipDomainError.pathDenied('Media must be resolved from a verified Host reference')
      }
      visit(child, depth + 1, isReference)
    }
  }
  visit(operation, 0, false)
}
