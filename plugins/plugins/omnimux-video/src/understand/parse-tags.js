/**
 * Parse I2V reverse-prompt tagged sections.
 * Missing tags → whole body as prompt, parsed:false (PRD fail-soft).
 * @param {unknown} rawText
 * @returns {{ prompt: string, appendix: string, rawText: string, parsed: boolean }}
 */
export function parseTaggedSections(rawText) {
  const text = String(rawText ?? '').trim()
  if (!text) {
    return { prompt: '', appendix: '', rawText: '', parsed: false }
  }

  const promptMatch = text.match(/<<<PROMPT>>>\s*([\s\S]*?)\s*<<<END_PROMPT>>>/i)
  const appendixMatch = text.match(/<<<APPENDIX>>>\s*([\s\S]*?)\s*<<<END_APPENDIX>>>/i)

  if (promptMatch) {
    const prompt = promptMatch[1].trim()
    if (!prompt) {
      return {
        prompt: text,
        appendix: appendixMatch ? appendixMatch[1].trim() : '',
        rawText: text,
        parsed: false,
      }
    }
    return {
      prompt,
      appendix: appendixMatch ? appendixMatch[1].trim() : '',
      rawText: text,
      parsed: true,
    }
  }

  return {
    prompt: text,
    appendix: '',
    rawText: text,
    parsed: false,
  }
}
