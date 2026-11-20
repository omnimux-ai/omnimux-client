export type FilePickerOptions = {
  kind: 'file' | 'directory'
  multiple?: boolean
  extensions?: string[]
  prompt?: string
}

export interface FilePickerHttpResult {
  ok: boolean
  status: number
  body: {
    path: string | null
    paths: string[]
    error?: string
    message?: string
  }
}

interface DesktopPickerCarrier {
  protocolVersion?: number
  filePicker?: {
    version: number
    open(options: FilePickerOptions): Promise<
      | { ok: true; path: string | null; paths: string[] }
      | { ok: false; error: string }
    >
  }
}

export function hasDesktopFilePicker(desktop?: DesktopPickerCarrier): boolean

export function requestFilePicker<T>(
  options: FilePickerOptions,
  webRequest: () => Promise<T>,
  desktop?: DesktopPickerCarrier,
): Promise<T | FilePickerHttpResult>
