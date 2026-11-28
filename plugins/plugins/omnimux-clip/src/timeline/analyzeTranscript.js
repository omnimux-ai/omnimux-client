import {
  DEFAULT_FILLER_PHRASES,
  buildTranscript,
  findFillerWords,
  findPauses,
  listSpeakers,
  searchTranscript,
} from '../../lib/openreel-templates.js'
import { analyzeTranscriptWith } from './analyzeTranscriptCore.js'

const transcriptCore = {
  DEFAULT_FILLER_PHRASES,
  buildTranscript,
  findFillerWords,
  findPauses,
  listSpeakers,
  searchTranscript,
}

/**
 * Pure Host transcript analysis using OpenReel's pre-bundled core transcript helpers.
 */
export function analyzeProjectTranscript(project, options = {}) {
  return analyzeTranscriptWith(transcriptCore, project, options)
}
