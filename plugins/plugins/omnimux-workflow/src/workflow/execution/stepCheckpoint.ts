/**
 * plugins/omnimux-workflow/src/workflow/execution/stepCheckpoint.ts
 * Step-level Execution Checkpointing & Resumption Engine
 */

import { computeNodeFingerprint, globalNodeCache } from './fingerprintCache';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepCheckpointRecord {
  nodeId: string;
  stepIndex: number;
  status: StepStatus;
  fingerprint: string;
  output?: unknown;
  error?: string;
  durationMs?: number;
  completedAt?: number;
}

export interface WorkflowCheckpoint {
  checkpointId: string;
  workflowId: string;
  executionId: string;
  totalSteps: number;
  completedSteps: number;
  steps: Record<string, StepCheckpointRecord>;
  createdAt: number;
  updatedAt: number;
}

export class CheckpointManager {
  private checkpoints = new Map<string, WorkflowCheckpoint>();

  createCheckpoint(workflowId: string, executionId: string, nodeIds: string[]): WorkflowCheckpoint {
    const checkpointId = `ckpt_${executionId}_${Date.now()}`;
    const steps: Record<string, StepCheckpointRecord> = {};
    nodeIds.forEach((nodeId, idx) => {
      steps[nodeId] = {
        nodeId,
        stepIndex: idx,
        status: 'pending',
        fingerprint: '',
      };
    });

    const cp: WorkflowCheckpoint = {
      checkpointId,
      workflowId,
      executionId,
      totalSteps: nodeIds.length,
      completedSteps: 0,
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.checkpoints.set(checkpointId, cp);
    return cp;
  }

  getCheckpoint(checkpointId: string): WorkflowCheckpoint | null {
    return this.checkpoints.get(checkpointId) ?? null
  }

  markStepRunning(checkpointId: string, nodeId: string, fingerprint = ''): void {
    const cp = this.checkpoints.get(checkpointId);
    if (!cp || !cp.steps[nodeId]) return;
    cp.steps[nodeId].status = 'running';
    if (fingerprint) cp.steps[nodeId].fingerprint = fingerprint;
    cp.updatedAt = Date.now();
  }

  markStepCompleted(
    checkpointId: string,
    nodeId: string,
    output: unknown,
    fingerprint: string,
    durationMs = 0,
  ): void {
    const cp = this.checkpoints.get(checkpointId);
    if (!cp || !cp.steps[nodeId]) return;
    const step = cp.steps[nodeId];
    step.status = 'completed';
    step.output = output;
    step.fingerprint = fingerprint;
    step.durationMs = durationMs;
    step.completedAt = Date.now();

    // Also write to global fingerprint cache
    if (fingerprint) {
      globalNodeCache.set(fingerprint, output);
    }

    cp.completedSteps = Object.values(cp.steps).filter((s) => s.status === 'completed').length;
    cp.updatedAt = Date.now();
  }

  markStepFailed(checkpointId: string, nodeId: string, error: string, fingerprint = ''): void {
    const cp = this.checkpoints.get(checkpointId);
    if (!cp || !cp.steps[nodeId]) return;
    const step = cp.steps[nodeId];
    step.status = 'failed';
    step.error = error;
    if (fingerprint) step.fingerprint = fingerprint;
    cp.updatedAt = Date.now();
  }

  isStepCompleted(checkpointId: string, nodeId: string): boolean {
    const cp = this.checkpoints.get(checkpointId);
    return cp?.steps[nodeId]?.status === 'completed';
  }

  getStepOutput(checkpointId: string, nodeId: string): unknown | undefined {
    const cp = this.checkpoints.get(checkpointId);
    return cp?.steps[nodeId]?.output;
  }

  clear(): void {
    this.checkpoints.clear();
  }
}

export const globalCheckpointManager = new CheckpointManager();
