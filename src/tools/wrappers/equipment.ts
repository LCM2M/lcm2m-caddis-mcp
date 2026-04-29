import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import {
  encodePathSegment,
  idParam,
  readOnlyAnnotations,
  runTool,
  timeWindowRequired,
  timeWindowRequiredStart,
} from '../schemas.js';

export function registerEquipmentTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_list_equipment',
    {
      title: 'List equipment',
      description:
        'List all equipment visible to the authenticated user in the active company. ' +
        'Each row includes the equipment\'s current status (running/down). ' +
        'Returns CSV when rows have uniform shape, otherwise YAML.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vm2m('/equipment');
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment',
    {
      title: 'Get one piece of equipment',
      description:
        'Fetch a single equipment record by its ID. ' +
        'Includes the equipment\'s current status (running/down).',
      inputSchema: { equipId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/equipment/${encodePathSegment(equipId)}`);
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment_utilization',
    {
      title: 'Equipment utilization over time',
      description:
        'Grouped utilization metrics for a piece of equipment. Buckets the running/down seconds ' +
        "into intervals (default '1d') over the requested window in the given timezone (default 'UTC').",
      inputSchema: {
        equipId: idParam,
        start: timeWindowRequiredStart.start,
        end: timeWindowRequiredStart.end,
        interval: z
          .string()
          .optional()
          .describe("Bucket interval, e.g. '1h', '1d', '1w' (default '1d')"),
        tz: z.string().optional().describe("IANA timezone, e.g. 'America/Denver' (default 'UTC')"),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/equipment/${encodePathSegment(equipId)}/utilization`, {
          query,
        });
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment_schedule',
    {
      title: 'Equipment schedule',
      description:
        'Current schedule for a piece of equipment, including where the schedule was inherited from ' +
        '(equipment vs org unit vs company) and the resolved timezone.',
      inputSchema: { equipId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/equipment/${encodePathSegment(equipId)}/schedule`);
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment_cycles',
    {
      title: 'Equipment production cycles',
      description:
        'Production cycles (individual part/unit runs) for a piece of equipment within a time window. ' +
        'Keep windows and limits modest — cycle counts can be very high.',
      inputSchema: { equipId: idParam, ...timeWindowRequiredStart },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/equipment/${encodePathSegment(equipId)}/cycles`, {
          query,
        });
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment_statuslogs',
    {
      title: 'Equipment status logs',
      description:
        'Running/down status log transitions for a piece of equipment within a time window. ' +
        'Each row is a status change; pair with statusreasons to decode reason IDs.',
      inputSchema: { equipId: idParam, ...timeWindowRequiredStart },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/equipment/${encodePathSegment(equipId)}/statuslogs`, {
          query,
        });
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment_telemetry',
    {
      title: 'Equipment telemetry data points',
      description:
        'Raw telemetry data points for a piece of equipment within a time window. ' +
        'Very chatty — always scope with a tight window and limit.',
      inputSchema: { equipId: idParam, ...timeWindowRequiredStart },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/equipment/${encodePathSegment(equipId)}/telemetry`, {
          query,
        });
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment_shift_history',
    {
      title: 'Equipment shift history',
      description:
        'Historical shift boundaries (start/end, scheduled/worked) for a piece of equipment. ' +
        'Both start and end are required — this is a closed-window query.',
      inputSchema: { equipId: idParam, ...timeWindowRequired },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(
          `/equipment/${encodePathSegment(equipId)}/shifthistory`,
          { query },
        );
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_list_equipment_excessive_downtimes',
    {
      title: 'Excessive downtime events for equipment',
      description:
        'List shifts where a piece of equipment had excessive downtime (XSF) events. ' +
        'Both start and end are required.',
      inputSchema: { equipId: idParam, ...timeWindowRequired },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(
          `/equipment/${encodePathSegment(equipId)}/excessivedowntimes`,
          { query },
        );
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_equipment_excessive_downtime',
    {
      title: 'One excessive downtime event',
      description:
        'Fetch a single excessive downtime record (with operator-assigned reason, if any) ' +
        'identified by the shift history + status log pair for a piece of equipment.',
      inputSchema: {
        equipId: idParam,
        shiftHistoryId: idParam.describe('Shift history ID for the event'),
        statusLogId: idParam.describe('Status log ID for the event'),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ equipId, shiftHistoryId, statusLogId }) =>
      runTool(async () => {
        const { body } = await client.vm2m(
          `/equipment/${encodePathSegment(equipId)}/excessivedowntime`,
          { query: { shiftHistoryId, statusLogId } },
        );
        return body;
      }),
  );
}
