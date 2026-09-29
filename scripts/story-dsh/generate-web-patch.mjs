import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify } from 'yaml';

class DshJsExpression {
  constructor(value) { this.value = value; }
}

const customTags = [{
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => new DshJsExpression(value),
  identify: (value) => value instanceof DshJsExpression,
  stringify: (item) => JSON.stringify(item.value.value),
}];

function js(value) { return new DshJsExpression(value); }

const output = process.argv[2];
if (!output) throw new Error('Usage: node generate-web-patch.mjs <output-path>');
const templateUrl = import.meta.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml');
const source = await readFile(fileURLToPath(templateUrl), 'utf8');
const document = parseDocument(source, { customTags });
if (document.errors.length) throw new Error(`Could not parse DSH standard preset: ${document.errors.map((e) => e.message).join('; ')}`);
const entries = document.toJS();
const preset = entries.find((entry) => entry?.insert?.some((row) => row?.id === 'preset-standard'))
  ?.insert?.find((row) => row?.id === 'preset-standard');
if (!preset || !Array.isArray(preset.config?.plugins)) throw new Error('The installed DSH web profile no longer exposes its standard plugin list.');

const mcp = {
  id: 'story-mcp',
  name: '@deepseek-ai/dsh-mcp-client',
  config: {
    serverName: 'story',
    transport: 'stdio',
    command: js('process.execPath'),
    args: ['--import', js('process.env.STHSTART_STORY_TSX_IMPORT_PATH'), js('process.env.STHSTART_STORY_MCP_SOURCE_PATH')],
    cwd: js('process.env.STHSTART_STORY_WORKSPACE'),
    env: {
      STHSTART_STORY_BRIDGE_TOKEN: js('process.env.STHSTART_STORY_BRIDGE_TOKEN'),
      STHSTART_STORY_PROJECT_ID: js('process.env.STHSTART_STORY_PROJECT_ID'),
      STHSTART_STORY_PORTAL_URL: js('process.env.STHSTART_STORY_PORTAL_URL'),
    },
    failOnStartupError: true,
  },
};
const previous = preset.config.plugins.findIndex((entry) => entry?.id === mcp.id);
if (previous === -1) preset.config.plugins.push(mcp);
else preset.config.plugins[previous] = mcp;

// DSH Web otherwise creates its first Workspace under the user's shared
// Documents/deepseek-harness directory even when DSH_HOME is project-specific.
entries.push({ id: 'workspace-controller', config: {
  documentsDirectory: js('process.env.STHSTART_STORY_WORKSPACE'),
} });

const resolvedOutput = resolve(output);
await mkdir(dirname(resolvedOutput), { recursive: true });
await writeFile(resolvedOutput, stringify(entries, { customTags, lineWidth: 120 }), 'utf8');
