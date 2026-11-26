import type { StageStore } from './stage/createStageStore.ts'

export interface WorkbenchStageStoreOptions {
  tabId: string
  title: string | (() => string)
  path?: string
}

export declare function createWorkbenchStageStore(options: WorkbenchStageStoreOptions): StageStore
