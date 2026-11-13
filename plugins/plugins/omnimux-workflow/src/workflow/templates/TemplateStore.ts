import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolveWorkflowPaths } from '../paths.ts';
import {
  workflowTemplateSchema,
  createTemplatePayloadSchema,
  TEMPLATE_SCHEMA_VERSION,
  type WorkflowTemplate,
  type CreateTemplatePayload,
} from './templateSchema.ts';

export class TemplateStore {
  readonly templatesDir: string;

  constructor(opts: { homeDir?: string; env?: NodeJS.ProcessEnv; templatesDir?: string } = {}) {
    if (opts.templatesDir) {
      this.templatesDir = opts.templatesDir;
    } else {
      const paths = resolveWorkflowPaths(opts);
      this.templatesDir = paths.templatesDir;
    }
    mkdirSync(this.templatesDir, { recursive: true });
  }

  list(): WorkflowTemplate[] {
    if (!existsSync(this.templatesDir)) return [];
    const files = readdirSync(this.templatesDir).filter((f) => f.endsWith('.json'));
    const templates: WorkflowTemplate[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.templatesDir, file), 'utf8');
        const parsed = JSON.parse(raw);
        const validated = workflowTemplateSchema.safeParse(parsed);
        if (validated.success) {
          templates.push(validated.data);
        }
      } catch {
        // Ignore unreadable or corrupted files
      }
    }

    return templates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): WorkflowTemplate | null {
    const file = join(this.templatesDir, `${id}.json`);
    if (!existsSync(file)) return null;
    try {
      const raw = readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      const validated = workflowTemplateSchema.safeParse(parsed);
      return validated.success ? validated.data : null;
    } catch {
      return null;
    }
  }

  save(payload: CreateTemplatePayload & { id?: string }): WorkflowTemplate {
    const validated = createTemplatePayloadSchema.parse(payload);
    const id = payload.id || `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const template: WorkflowTemplate = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      id,
      name: validated.name,
      description: validated.description || '',
      tags: validated.tags || [],
      coverUrl: validated.coverUrl,
      createdAt: now,
      updatedAt: now,
      nodeCount: validated.nodes.length,
      nodes: validated.nodes,
      edges: validated.edges,
    };

    const targetFile = join(this.templatesDir, `${id}.json`);
    const tmpFile = `${targetFile}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpFile, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
    renameSync(tmpFile, targetFile);

    return template;
  }

  delete(id: string): boolean {
    const targetFile = join(this.templatesDir, `${id}.json`);
    if (existsSync(targetFile)) {
      rmSync(targetFile, { force: true });
      return true;
    }
    return false;
  }
}
