/** Prepare the official H3 task's reference fields without interpreting unrelated metadata. */
export async function prepareH3MetadataMedia(metadata, prepare) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata
  const result = { ...metadata }
  for (const [field, source] of Object.entries(metadata)) {
    if (typeof source !== 'string') continue
    if (field === 'first_frame' || field === 'last_frame' || /^ref_image_[0-9]+$/.test(field)) {
      result[field] = await prepare(source, 'image')
    } else if (/^ref_audio_[0-9]+$/.test(field)) {
      result[field] = await prepare(source, 'audio')
    }
  }
  return result
}
