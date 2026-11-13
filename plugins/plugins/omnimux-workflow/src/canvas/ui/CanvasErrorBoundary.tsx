/**
 * CanvasErrorBoundary — 画布顶层全局容灾错误边界。
 *
 * 彻底防止画布子组件树在全选/多选/动态渲染时抛出未捕获异常导致 React 根节点卸载全黑屏。
 * 遵循 design.md 设计规范：原生 DSW/WB tokens、8px 圆角、32px 按钮高度、SVG 矢量图标。
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, MousePointerClick } from 'lucide-react';
import { useCanvasStore } from '../store/canvasStore';

export interface CanvasErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  constructor(props: CanvasErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<CanvasErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[OmniMux CanvasErrorBoundary] 捕获到画布未处理渲染异常:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleClearSelectionAndRetry = (): void => {
    try {
      const state = useCanvasStore.getState();
      state.setNodes((nodes) => nodes.map((n) => (n.selected ? { ...n, selected: false } : n)));
      state.setSelectedElement('none', null);
    } catch {
      // 忽略 store 容错
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = (): void => {
    if (this.props.onReset) {
      this.props.onReset();
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || '画布组件渲染发生异常';

      return (
        <div className="wf-canvas-error-boundary nodrag nopan">
          <div className="wf-canvas-error-boundary__card">
            <div className="wf-canvas-error-boundary__icon">
              <AlertTriangle size={24} />
            </div>

            <div className="wf-canvas-error-boundary__copy">
              <div className="wf-canvas-error-boundary__title">
                画布局部渲染遇到问题
              </div>
              <div className="wf-canvas-error-boundary__message">
                {errorMessage}
              </div>
            </div>

            <div className="wf-canvas-error-boundary__actions">
              <button
                type="button"
                className="wf-canvas-error-boundary__btn wf-canvas-error-boundary__btn--ghost"
                onClick={this.handleClearSelectionAndRetry}
              >
                <MousePointerClick size={14} />
                <span>清空选择并重试</span>
              </button>

              <button
                type="button"
                className="wf-canvas-error-boundary__btn wf-canvas-error-boundary__btn--primary"
                onClick={this.handleReload}
              >
                <RotateCcw size={14} />
                <span>重新加载</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
