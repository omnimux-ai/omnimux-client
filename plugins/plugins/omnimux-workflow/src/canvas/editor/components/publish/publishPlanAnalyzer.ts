/**
 * Publish-plan analyzer: derives a group's workflows, input fields and output
 * nodes from the graph. The publisher never selects input/output nodes; the
 * plan is rebuilt from the current group plus the verified execution.
 */

import {
  type FlowEdgeLike,
  type FlowNodeLike,
  computeWorkflowHash,
} from './topologyAnalyzer.ts';
import { resolveNodeOutputType } from '../../../../shared/graph/materialNode.ts';
import { extractSocialVideoUrl } from '../../utils/socialMediaVideoUrl.ts';
import type {
  FormWidgetType,
  PublishInput,
  PublishOutput,
  PublishOutputType,
  PublishPlan,
  PublishWorkflow,
} from './publishTypes.ts';

export type PublishAnalysisErrorCode =
  | 'multiple_workflows'
  | 'no_input'
  | 'no_output'
  | 'no_nodes';

export interface PublishAnalysisError {
  code: PublishAnalysisErrorCode;
  message: string;
  workflowIds?: string[];
}

export interface GroupPublishAnalysis {
  workflows: PublishWorkflow[];
  inputs: PublishInput[];
  outputs: PublishOutput[];
  graphHash: string;
  errors: PublishAnalysisError[];
}

function nodeData(node: FlowNodeLike): Record<string, unknown> {
  return (node.data ?? {}) as Record<string, unknown>;
}

function materialTypeOf(node: FlowNodeLike): string {
  if (node.type === 'table') return 'table';
  return resolveNodeOutputType(nodeData(node));
}

function capabilityIdOf(node: FlowNodeLike): string {
  const data = nodeData(node);
  const explicit = typeof data.outputCapabilityId === 'string' ? data.outputCapabilityId.trim() : '';
  if (explicit) return explicit;
  const selected = typeof data.selectedTool === 'string' ? data.selectedTool.trim() : '';
  if (selected) return selected;
  if (node.type === 'table') return 'table';
  return String(data.materialType ?? 'text');
}

function labelOf(node: FlowNodeLike, fallback: string): string {
  const data = nodeData(node);
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  return label || fallback;
}

function inputLabel(node: FlowNodeLike, widget: FormWidgetType): string {
  if (widget === 'media-extractor') return '视频链接';
  const type = nodeData(node).materialType;
  if (type === 'image') return '图片素材';
  if (type === 'video') return '视频素材';
  if (type === 'audio') return '音频素材';
  return labelOf(node, '文本内容');
}

function inputWidget(node: FlowNodeLike): FormWidgetType {
  const data = nodeData(node);
  if (data.materialType === 'text') {
    const content = typeof data.content === 'string' ? data.content : '';
    return extractSocialVideoUrl(content)?.url ? 'media-extractor' : 'textarea';
  }
  if (data.materialType === 'image' || data.materialType === 'video' || data.materialType === 'audio') {
    return 'media-uploader';
  }
  return 'input-text';
}

/** Build undirected connected components inside the selected group. */
function buildWorkflows(nodes: FlowNodeLike[], edges: FlowEdgeLike[]): PublishWorkflow[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (visited.has(node.id)) continue;
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(id);
      for (const next of adjacency.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component.sort());
  }

  return components
    .map((component, index) => ({
      workflowId: `wf_${index + 1}`,
      nodeIds: component,
      entryNodeIds: component.filter((id) => (inDegree.get(id) ?? 0) === 0),
      outputNodeIds: component.filter((id) => (outDegree.get(id) ?? 0) === 0),
    }))
    .sort((a, b) => (a.nodeIds[0] ?? '').localeCompare(b.nodeIds[0] ?? ''));
}

function collectInputs(
  nodeById: Map<string, FlowNodeLike>,
  workflows: PublishWorkflow[],
): PublishInput[] {
  const inputs: PublishInput[] = [];
  for (const workflow of workflows) {
    for (const nodeId of workflow.entryNodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const data = nodeData(node);
      const widget = inputWidget(node);
      const targetField = data.materialType === 'text' ? 'content' : 'mediaUrl';
      inputs.push({
        key: `${node.id}_${targetField}`,
        workflowId: workflow.workflowId,
        nodeId: node.id,
        capabilityId: capabilityIdOf(node),
        slotId: targetField,
        widget,
        required: true,
        label: inputLabel(node, widget),
        ...(typeof data.content === 'string' && data.content.trim()
          ? { sampleValue: data.content }
          : {}),
      });
    }
  }
  return inputs;
}

function collectOutputs(
  nodeById: Map<string, FlowNodeLike>,
  workflows: PublishWorkflow[],
): PublishOutput[] {
  const outputs: PublishOutput[] = [];
  for (const workflow of workflows) {
    for (const nodeId of workflow.outputNodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const outputType = materialTypeOf(node) as PublishOutputType;
      if (!['text', 'image', 'video', 'audio', 'table'].includes(outputType)) continue;
      outputs.push({
        workflowId: workflow.workflowId,
        nodeId: node.id,
        capabilityId: capabilityIdOf(node),
        outputType,
      });
    }
  }
  return outputs;
}

/**
 * Pure analyzer used by the publish wizard. It deliberately returns errors
 * instead of picking for the user when the group is ambiguous.
 */
export function analyzeGroupPublishPlan(
  nodes: FlowNodeLike[],
  edges: FlowEdgeLike[],
  groupId = '',
): GroupPublishAnalysis {
  if (nodes.length === 0) {
    return {
      workflows: [], inputs: [], outputs: [], graphHash: '',
      errors: [{ code: 'no_nodes', message: '当前分组没有节点' }],
    };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const workflows = buildWorkflows(nodes, edges);
  const inputs = collectInputs(nodeById, workflows);
  const outputs = collectOutputs(nodeById, workflows);
  const errors: PublishAnalysisError[] = [];

  if (workflows.length > 1) {
    errors.push({
      code: 'multiple_workflows',
      message: `当前分组包含多个独立工作流（${workflows.length} 个），请拆分为多个模板组后发布`,
      workflowIds: workflows.map((workflow) => workflow.workflowId),
    });
  }
  if (inputs.length === 0) {
    errors.push({ code: 'no_input', message: '当前分组没有可识别的输入节点' });
  }
  if (outputs.length === 0) {
    errors.push({ code: 'no_output', message: '当前分组没有可识别的输出节点' });
  }

  return {
    workflows,
    inputs,
    outputs,
    graphHash: computeWorkflowHash(nodes, edges),
    errors,
  };
}

/** Build the publish plan stored on the manifest. */
export function buildPublishPlan(
  groupId: string,
  analysis: GroupPublishAnalysis,
): PublishPlan {
  return {
    groupId,
    workflows: analysis.workflows,
    inputs: analysis.inputs,
    outputs: analysis.outputs,
    graphHash: analysis.graphHash,
  };
}
