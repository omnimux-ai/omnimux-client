/**
 * Native Dark-Glass Toast Notification System.
 * Replaces antd `message` with a lightweight, zero-dependency, dark-glass floating toast.
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  content: string;
  durationMs: number;
}

let addToastFn: ((toast: ToastItem) => void) | null = null;

const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    addToastFn = (toast: ToastItem) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, toast.durationMs);
    };
    return () => {
      addToastFn = null;
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="wf-toast-container">
      {toasts.map((toast) => {
        let IconComponent = Info;
        let iconColor = '#60a5fa';
        if (toast.type === 'success') {
          IconComponent = CheckCircle2;
          iconColor = '#34d399';
        } else if (toast.type === 'warning') {
          IconComponent = AlertTriangle;
          iconColor = '#fb923c';
        } else if (toast.type === 'error') {
          IconComponent = AlertCircle;
          iconColor = '#f87171';
        }

        return (
          <div key={toast.id} className={`wf-toast wf-toast--${toast.type}`}>
            <IconComponent size={16} color={iconColor} className="wf-toast__icon" />
            <span className="wf-toast__text">{toast.content}</span>
          </div>
        );
      })}
    </div>
  );
};

function ensureToastRoot(): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('wf-toast-root');
  if (existing) return;

  const container = document.createElement('div');
  container.id = 'wf-toast-root';
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<ToastContainer />);
}

function show(type: ToastType, content: string, durationMs = 2500): void {
  ensureToastRoot();
  const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (addToastFn) {
    addToastFn({ id, type, content, durationMs });
  } else {
    // Fallback if root is still mounting
    setTimeout(() => {
      addToastFn?.({ id, type, content, durationMs });
    }, 50);
  }
}

export const toast = {
  success: (content: string, durationMs?: number) => show('success', content, durationMs),
  warning: (content: string, durationMs?: number) => show('warning', content, durationMs),
  error: (content: string, durationMs?: number) => show('error', content, durationMs),
  info: (content: string, durationMs?: number) => show('info', content, durationMs),
};
