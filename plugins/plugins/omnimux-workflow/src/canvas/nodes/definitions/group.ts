import type { NodeDefinition } from '../registry';
import { GroupNode } from '../../editor/components/GroupNode/GroupNode';
import { DEFAULT_GROUP_COLOR } from '../../editor/utils/nodeVisualMath';

export const groupNodeDefinition: NodeDefinition = {
  type: 'group',
  component: GroupNode,
  ports: [],
  defaultData: () => ({
    title: '',
    color: DEFAULT_GROUP_COLOR,
    padding: 32,
    minWidth: 300,
    minHeight: 200,
    nodeIds: [],
  }),
};
