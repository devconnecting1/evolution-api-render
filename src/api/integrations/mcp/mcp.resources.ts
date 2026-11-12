import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs';
import path from 'path';

import { McpContext } from './mcp.types';

const DOC_NAME = /^[\w.-]+\.md$/;
const MAX_DOC_BYTES = 512 * 1024;

export type DocFile = { name: string; file: string };

/**
 * The Markdown manuals: README-WHATSAI.md at the root plus readmes/*.md, or the copies synced into
 * manager/dist/readmes (the only ones present in the Docker image if the root files are missing). The first folder
 * that has a file wins. Only directory listings: nothing is read until a client asks for a document.
 */
export function listDocs(docsDirs: string[]): DocFile[] {
  const docs = new Map<string, DocFile>();

  for (const dir of docsDirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries.sort()) {
      if (!DOC_NAME.test(entry)) continue;
      // Only the manuals at the root: README-WHATSAI.md (other root READMEs are the upstream ones)
      if (path.resolve(dir) === path.resolve(process.cwd()) && entry !== 'README-WHATSAI.md') continue;

      const name = entry.replace(/\.md$/, '');
      if (!docs.has(name)) docs.set(name, { name, file: path.join(dir, entry) });
    }
  }

  return [...docs.values()];
}

const titleOf = (text: string, fallback: string) => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || fallback;

export function registerDocResources(server: McpServer, ctx: McpContext): void {
  for (const doc of listDocs(ctx.deps.config.docsDirs)) {
    const uri = `whatsai://docs/${doc.name}`;

    server.registerResource(
      doc.name,
      uri,
      {
        title: doc.name,
        description: `Manual do WhatsAI (${doc.name}.md), somente leitura.`,
        mimeType: 'text/markdown',
      },
      async () => {
        const stat = fs.statSync(doc.file);
        if (stat.size > MAX_DOC_BYTES) {
          return { contents: [{ uri, mimeType: 'text/plain', text: 'Documento grande demais para o MCP.' }] };
        }

        const text = fs.readFileSync(doc.file, 'utf8');
        return { contents: [{ uri, mimeType: 'text/markdown', text, _meta: { title: titleOf(text, doc.name) } }] };
      },
    );
  }
}
