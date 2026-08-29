/**
 * sync-agents.mjs — copy the project's subagent definitions and MCP config
 * one level up.
 *
 * The agents live in this repo so they are version-controlled with the code they
 * describe. But Claude Code discovers agents under the directory it was opened
 * in, and sessions here usually open in the PARENT folder (`liviee`), which
 * holds two other projects besides this one. Without a copy up there the agents
 * exist and are simply never offered — the same shape of failure as a screen
 * that ships and cannot be reached.
 *
 * The same applies to .mcp.json, which registers the WorldMonitor MCP server.
 *
 * Run after editing anything in .claude/agents/ or .mcp.json. Opening Claude Code
 * directly in this repo needs no copy.
 */
import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.claude', 'agents');
const DST = join(ROOT, '..', '.claude', 'agents');

const files = (await readdir(SRC)).filter((f) => f.endsWith('.md'));
await mkdir(DST, { recursive: true });
for (const f of files) {
  await copyFile(join(SRC, f), join(DST, f));
  console.log(`  ${f}`);
}
console.log(`${files.length} agen disalin ke ${DST}`);

// The MCP registration has the same discovery problem as the agents: Claude Code
// reads .mcp.json from the folder the session opened in, not from this repo.
await copyFile(join(ROOT, '.mcp.json'), join(ROOT, '..', '.mcp.json'));
console.log(`  .mcp.json disalin ke ${join(ROOT, '..')}`);
