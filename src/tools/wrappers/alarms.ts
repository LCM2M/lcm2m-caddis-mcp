import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import { idParam, readOnlyAnnotations, runTool, toonDesc } from '../schemas.js';

export function registerAlarmTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_list_alarms',
    {
      title: 'List alarms',
      description: toonDesc(
        'List enabled alarms for the company along with their type definitions, latest history ' +
          'entry, and subscribers (users and rosters). Optionally filter by equipment IDs or by ' +
          'whether the alarm type is preventative maintenance (pm). ' +
          'The body is a TOON document with five named tabular sections — `alarms[...]{...}:`, ' +
          '`alarm_types[...]{...}:`, `alarm_history[...]{...}:`, `user_alarms[...]{...}:`, and ' +
          '`roster_alarms[...]{...}:` — each followed by its indented rows. ' +
          'Join keys: each alarms row carries alarm_type_id ↔ alarm_types.id; alarm_history, ' +
          'user_alarms, and roster_alarms rows each carry alarm_id back to alarms.id. ' +
          'alarm_history is capped at the single most recent entry per alarm. ' +
          'Several columns are JSON-stringified blobs — `args`, `args_latest`, ' +
          '`device_output_config`, and `config` on alarms; `args_template` on alarm_types; and ' +
          '`args` + `device_output_config` on alarm_history — `JSON.parse()` them to recover ' +
          'their structured values.',
      ),
      inputSchema: {
        equipIds: z
          .array(idParam)
          .optional()
          .describe('Filter to alarms for the given equipment IDs'),
        pm: z
          .boolean()
          .optional()
          .describe('If true, only return preventative-maintenance alarms; if false, only non-PM'),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ equipIds, pm }) =>
      runTool(async () => {
        const { body } = await client.vm2m('/alarms', { query: { equipIds, pm } });
        return body;
      }),
  );
}
