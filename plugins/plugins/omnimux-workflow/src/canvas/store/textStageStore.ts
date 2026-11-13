import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { TextVersionSnapshot } from '../../shared/graph/materialNode';

export type TextViewMode = 'split' | 'edit' | 'preview';

export interface TextStats {
  charCount: number;
  wordCount: number;
  lineCount: number;
}

export function calculateTextStats(text: string): TextStats {
  if (!text) {
    return { charCount: 0, wordCount: 0, lineCount: 0 };
  }
  const charCount = text.length;
  const lineCount = text.split(/\r\n|\r|\n/).length;

  // CJK character count + Latin word count
  const cjkChars = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latinText = text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ');
  const latinWords = (latinText.match(/[a-zA-Z0-9_\-]+/g) || []).length;
  const wordCount = cjkChars + latinWords;

  return { charCount, wordCount, lineCount };
}

export type TextCommitHandler = (
  nodeId: string,
  payload: {
    title: string;
    content: string;
    versions: TextVersionSnapshot[];
    wordCount: number;
    charCount: number;
  },
) => void;

export interface DiffModalState {
  isOpen: boolean;
  snapshot: TextVersionSnapshot | null;
}

export interface TextStageState {
  // === Stage 核心状态 ===
  isStageOpen: boolean;
  nodeId: string | null;
  title: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  viewMode: TextViewMode;
  isSearchOpen: boolean;

  // === 历史版本管理 ===
  isDrawerOpen: boolean;
  diffModal: DiffModalState;
  versions: TextVersionSnapshot[];

  // === 独立 Undo / Redo 历史栈 ===
  undoStack: string[];
  redoStack: string[];

  // === 外部同步回调 ===
  commitHandler: TextCommitHandler | null;

  // === 操作 Actions ===
  openStage: (
    nodeId: string,
    initialData: {
      title?: string;
      content?: string;
      versions?: TextVersionSnapshot[];
      mode?: TextViewMode;
    },
  ) => void;
  closeStage: () => void;
  save: () => void;
  saveAndClose: () => void;

  // 内容与标题编辑
  setContent: (content: string) => void;
  setTitle: (title: string) => void;
  setViewMode: (mode: TextViewMode) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;

  // 历史版本抽屉与对比弹窗
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  openDiffModal: (snapshot: TextVersionSnapshot) => void;
  closeDiffModal: () => void;

  // 快照 CRUD
  createSnapshot: (name?: string, source?: TextVersionSnapshot['source']) => TextVersionSnapshot;
  revertToSnapshot: (snapshotId: string) => boolean;
  deleteSnapshot: (snapshotId: string) => void;

  // 独立 Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushUndo: (prevContent: string) => void;

  // 同步器注册
  registerCommitHandler: (handler: TextCommitHandler) => () => void;
}

const MAX_UNDO_DEPTH = 50;
const MAX_VERSIONS = 50;

export const useTextStageStore = create<TextStageState>((set, get) => ({
  isStageOpen: false,
  nodeId: null,
  title: '',
  content: '',
  originalContent: '',
  isDirty: false,
  viewMode: 'edit',
  isSearchOpen: false,

  isDrawerOpen: false,
  diffModal: { isOpen: false, snapshot: null },
  versions: [],

  undoStack: [],
  redoStack: [],
  commitHandler: null,

  openStage: (nodeId, initialData) => {
    const rawContent = initialData.content ?? '';
    const rawTitle = initialData.title ?? '';
    const rawVersions = initialData.versions ?? [];

    set({
      isStageOpen: true,
      nodeId,
      title: rawTitle,
      content: rawContent,
      originalContent: rawContent,
      isDirty: false,
      viewMode: initialData.mode ?? 'edit',
      isSearchOpen: false,
      isDrawerOpen: false,
      diffModal: { isOpen: false, snapshot: null },
      versions: [...rawVersions],
      undoStack: [],
      redoStack: [],
    });
  },

  closeStage: () => {
    const { isDirty, save } = get();
    if (isDirty) {
      save();
    }
    set({
      isStageOpen: false,
      nodeId: null,
      isSearchOpen: false,
      isDrawerOpen: false,
      diffModal: { isOpen: false, snapshot: null },
      isDirty: false,
    });
  },

  toggleSearch: () => {
    set((s) => ({ isSearchOpen: !s.isSearchOpen }));
  },

  setSearchOpen: (open: boolean) => {
    set({ isSearchOpen: open });
  },

  save: () => {
    const { nodeId, title, content, versions, commitHandler } = get();
    if (!nodeId) return;

    const stats = calculateTextStats(content);

    if (commitHandler) {
      commitHandler(nodeId, {
        title,
        content,
        versions,
        wordCount: stats.wordCount,
        charCount: stats.charCount,
      });
    }

    set({
      originalContent: content,
      isDirty: false,
    });
  },

  saveAndClose: () => {
    get().save();
    set({
      isStageOpen: false,
      nodeId: null,
      isDrawerOpen: false,
      diffModal: { isOpen: false, snapshot: null },
    });
  },

  setContent: (newContent: string) => {
    const { content, undoStack } = get();
    if (newContent === content) return;

    // 记录撤销栈
    const nextUndo = [...undoStack, content].slice(-MAX_UNDO_DEPTH);

    set({
      content: newContent,
      isDirty: true,
      undoStack: nextUndo,
      redoStack: [], // 产生新输入时清空 redo
    });
  },

  setTitle: (newTitle: string) => {
    set({
      title: newTitle,
      isDirty: true,
    });
  },

  setViewMode: (mode: TextViewMode) => {
    set({ viewMode: mode });
  },

  setDrawerOpen: (open: boolean) => {
    set({ isDrawerOpen: open });
  },

  toggleDrawer: () => {
    set((state) => ({ isDrawerOpen: !state.isDrawerOpen }));
  },

  openDiffModal: (snapshot: TextVersionSnapshot) => {
    set({ diffModal: { isOpen: true, snapshot } });
  },

  closeDiffModal: () => {
    set({ diffModal: { isOpen: false, snapshot: null } });
  },

  createSnapshot: (name?: string, source: TextVersionSnapshot['source'] = 'manual') => {
    const { content, versions, commitHandler, nodeId, title } = get();
    const stats = calculateTextStats(content);
    const now = Date.now();

    const dateStr = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const snapshotName = name && name.trim() ? name.trim() : `版本快照 ${dateStr}`;

    const newSnapshot: TextVersionSnapshot = {
      id: uuidv4(),
      timestamp: now,
      name: snapshotName,
      content,
      source,
      wordCount: stats.wordCount,
      charCount: stats.charCount,
    };

    const nextVersions = [newSnapshot, ...versions].slice(0, MAX_VERSIONS);

    set({
      versions: nextVersions,
      isDirty: true,
    });

    if (nodeId && commitHandler) {
      commitHandler(nodeId, {
        title,
        content,
        versions: nextVersions,
        wordCount: stats.wordCount,
        charCount: stats.charCount,
      });
    }

    return newSnapshot;
  },

  revertToSnapshot: (snapshotId: string) => {
    const { versions, content, undoStack, commitHandler, nodeId, title } = get();
    const target = versions.find((v) => v.id === snapshotId);
    if (!target) return false;

    const nextUndo = [...undoStack, content].slice(-MAX_UNDO_DEPTH);
    const stats = calculateTextStats(target.content);

    // 自动打一个 revert 记录
    const revertSnapshot: TextVersionSnapshot = {
      id: uuidv4(),
      timestamp: Date.now(),
      name: `回滚自「${target.name}」`,
      content: target.content,
      source: 'revert',
      wordCount: stats.wordCount,
      charCount: stats.charCount,
    };

    const nextVersions = [revertSnapshot, ...versions].slice(0, MAX_VERSIONS);

    set({
      content: target.content,
      undoStack: nextUndo,
      redoStack: [],
      versions: nextVersions,
      isDirty: true,
      diffModal: { isOpen: false, snapshot: null },
    });

    if (nodeId && commitHandler) {
      commitHandler(nodeId, {
        title,
        content: target.content,
        versions: nextVersions,
        wordCount: stats.wordCount,
        charCount: stats.charCount,
      });
    }

    return true;
  },

  deleteSnapshot: (snapshotId: string) => {
    const { versions, commitHandler, nodeId, title, content } = get();
    const nextVersions = versions.filter((v) => v.id !== snapshotId);
    const stats = calculateTextStats(content);

    set({
      versions: nextVersions,
      isDirty: true,
    });

    if (nodeId && commitHandler) {
      commitHandler(nodeId, {
        title,
        content,
        versions: nextVersions,
        wordCount: stats.wordCount,
        charCount: stats.charCount,
      });
    }
  },

  undo: () => {
    const { undoStack, redoStack, content } = get();
    if (undoStack.length === 0) return;

    const prev = undoStack[undoStack.length - 1]!;
    const nextUndo = undoStack.slice(0, -1);
    const nextRedo = [...redoStack, content].slice(-MAX_UNDO_DEPTH);

    set({
      content: prev,
      undoStack: nextUndo,
      redoStack: nextRedo,
      isDirty: true,
    });
  },

  redo: () => {
    const { undoStack, redoStack, content } = get();
    if (redoStack.length === 0) return;

    const next = redoStack[redoStack.length - 1]!;
    const nextRedo = redoStack.slice(0, -1);
    const nextUndo = [...undoStack, content].slice(-MAX_UNDO_DEPTH);

    set({
      content: next,
      undoStack: nextUndo,
      redoStack: nextRedo,
      isDirty: true,
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  pushUndo: (prevContent: string) => {
    const { undoStack } = get();
    set({
      undoStack: [...undoStack, prevContent].slice(-MAX_UNDO_DEPTH),
      redoStack: [],
    });
  },

  registerCommitHandler: (handler: TextCommitHandler) => {
    set({ commitHandler: handler });
    return () => {
      if (get().commitHandler === handler) {
        set({ commitHandler: null });
      }
    };
  },
}));

if (typeof window !== 'undefined') {
  (window as any).__textStageStore = useTextStageStore;
}

