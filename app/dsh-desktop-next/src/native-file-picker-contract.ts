/** Versioned file and folder selection on the OmniMux application's own window. */
export const DESKTOP_FILE_PICKER_CHANNEL = 'dsh-desktop:native-file-picker'

export interface NativeFilePickerRequest {
  kind: 'file' | 'directory'
  multiple?: boolean
  extensions?: string[]
  prompt?: string
}

export type NativeFilePickerResult =
  | { ok: true; path: string | null; paths: string[] }
  | { ok: false; error: 'picker-gesture-required' | 'picker-invalid-request' | 'picker-busy' | 'picker-unavailable' | 'picker-failed' }

export interface NativeFilePickerBridge {
  version: 1
  open(request: NativeFilePickerRequest): Promise<NativeFilePickerResult>
}

/** Keep the user-activation check in the context-isolated preload world. */
export function createNativeFilePickerBridge(
  invoke: (channel: string, request: NativeFilePickerRequest) => Promise<NativeFilePickerResult>,
): NativeFilePickerBridge {
  return {
    version: 1,
    open(request) {
      if (!navigator.userActivation?.isActive) {
        return Promise.resolve({ ok: false, error: 'picker-gesture-required' })
      }
      return invoke(DESKTOP_FILE_PICKER_CHANNEL, request)
        .catch(() => ({ ok: false, error: 'picker-unavailable' }))
    },
  }
}
