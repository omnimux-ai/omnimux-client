import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DOCUMENT_MIME_BY_EXTENSION,
  inspectDocumentUrl,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from './videoParamAdapter.ts';

describe('videoParamAdapter - document URL inspection', () => {
  it('keeps the official document extension list complete and excludes JSON', () => {
    assert.deepEqual([...SUPPORTED_DOCUMENT_EXTENSIONS], [
      'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'pdf', 'txt', 'key', 'pages', 'numbers', 'md',
    ]);
    assert.equal('json' in DOCUMENT_MIME_BY_EXTENSION, false);
  });

  it('derives the document file name, type and source host from a signed URL', () => {
    assert.deepEqual(inspectDocumentUrl(
      'https://cdn.example.com/campaign/glass-deck.PPTX?signature=fixed',
      Object.values(DOCUMENT_MIME_BY_EXTENSION),
    ), {
      ok: true,
      info: {
        url: 'https://cdn.example.com/campaign/glass-deck.PPTX?signature=fixed',
        fileName: 'glass-deck.PPTX',
        extension: 'pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sourceHost: 'cdn.example.com',
      },
    });
  });

  it('decodes a percent-encoded file name for display', () => {
    const result = inspectDocumentUrl('https://cdn.example.com/%E6%96%87%E6%A1%A3.pdf', ['application/pdf']);
    assert.equal(result.ok, true);
    assert.equal(result.info?.fileName, '文档.pdf');
  });

  it('reports empty and non-http URLs distinctly', () => {
    assert.deepEqual(inspectDocumentUrl('', ['application/pdf']), {
      ok: false,
      error: '请输入文档地址',
    });
    assert.deepEqual(inspectDocumentUrl('ftp://cdn.example.com/deck.pdf', ['application/pdf']), {
      ok: false,
      error: '请输入有效的文档 URL（仅支持 http/https）',
    });
  });

  it('reports an unknown extension with the official format list', () => {
    assert.deepEqual(inspectDocumentUrl('https://cdn.example.com/archive.zip', Object.values(DOCUMENT_MIME_BY_EXTENSION)), {
      ok: false,
      error: '不支持该文档格式：支持 docx、doc、xlsx、xls、pptx、ppt、pdf、txt、key、pages、numbers、md',
    });
  });

  it('reports a known MIME that the selected model does not allow', () => {
    assert.deepEqual(inspectDocumentUrl('https://cdn.example.com/deck.pptx', ['application/pdf']), {
      ok: false,
      info: {
        url: 'https://cdn.example.com/deck.pptx',
        fileName: 'deck.pptx',
        extension: 'pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sourceHost: 'cdn.example.com',
      },
      error: '当前模型不支持该文档格式',
    });
  });
});
