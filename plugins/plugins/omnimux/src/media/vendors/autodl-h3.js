export const H3_AUTODL_MODEL = 'minimax-h3-video'

export function isH3AutoDlLipSync(modelId, operationId) {
  return modelId === H3_AUTODL_MODEL && operationId === 'digital_human'
}

// The runtime catalog and the original local contract use different names for
// the same two inputs. Keep compatibility local to this operation.
const lipSyncSlots = Object.freeze({
  image: { names: ['reference_image', 'character'], roles: ['reference', 'first_frame'] },
  audio: { names: ['reference_audio', 'driving_audio'], roles: ['reference', 'audio_track'] },
})

function isLipSyncAsset(asset) {
  const slot = Object.hasOwn(lipSyncSlots, asset.type) ? lipSyncSlots[asset.type] : undefined
  const targetSlot = asset.targetSlot ?? asset.slot
  return Boolean(slot
    && (!targetSlot || slot.names.includes(targetSlot))
    && (!asset.role || slot.roles.includes(asset.role)))
}

export function resolveH3LipSyncSlotAliases(assets, inputs = []) {
  return assets.map((asset) => {
    if (!isLipSyncAsset(asset)) return asset
    const slot = inputs.find((input) => input.type === asset.type && lipSyncSlots[asset.type].names.includes(input.slot))
    return slot ? { ...asset, targetSlot: slot.slot, role: slot.role } : asset
  })
}

/** Build the exact AutoDL shape from the selected image and driving audio. */
export function mapH3LipSyncMedia(assets = [], duration) {
  const image = assets.find((asset) => asset.type === 'image')?.pathOrUrl
  const audio = assets.find((asset) => asset.type === 'audio')?.pathOrUrl
  if (!image || !audio || assets.length !== 2 || !assets.every(isLipSyncAsset)) return undefined
  const metadata = {
    ref_image_0: image,
    ref_audio_0: audio,
    ...(typeof duration === 'number' && duration > 0 ? { audio_duration: duration } : {}),
  }
  // The profile also requires the top-level audio_urls field. AutoDL reads
  // the driving audio from the metadata slot.
  return { operation: 'digital_human', metadata, audio_urls: [audio] }
}
