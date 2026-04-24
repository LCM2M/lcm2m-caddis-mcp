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

export function registerOrgUnitTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_get_org_unit',
    {
      title: 'Get one org unit',
      description:
        'Fetch a single organizational unit with its direct equipment and child org units. ' +
        'For the whole tree, use caddis_get_tree instead.',
      inputSchema: { orgUnitId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ orgUnitId }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/orgunits/${encodePathSegment(orgUnitId)}`);
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_org_unit_schedule',
    {
      title: 'Org unit schedule',
      description:
        'Current schedule for an organizational unit, with inheritance source and resolved timezone.',
      inputSchema: { orgUnitId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ orgUnitId }) =>
      runTool(async () => {
        const { body } = await client.vm2m(`/orgunits/${encodePathSegment(orgUnitId)}/schedule`);
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_org_unit_utilization',
    {
      title: 'Org unit utilization over time',
      description:
        'Utilization metrics aggregated across every piece of equipment under an org unit. ' +
        "Buckets the running/down seconds into intervals (default '1d') over the requested window " +
        "in the given timezone (default 'UTC'). Returns one entry per bucket.",
      inputSchema: {
        orgUnitId: idParam,
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
    async ({ orgUnitId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(
          `/orgunits/${encodePathSegment(orgUnitId)}/utilization`,
          { query },
        );
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_list_org_unit_excessive_downtimes',
    {
      title: 'Excessive downtimes under an org unit',
      description:
        'Excessive downtime (XSF) events across every piece of equipment under an org unit in a ' +
        'closed time window. Both start and end are required.',
      inputSchema: { orgUnitId: idParam, ...timeWindowRequired },
      annotations: readOnlyAnnotations,
    },
    async ({ orgUnitId, ...query }) =>
      runTool(async () => {
        const { body } = await client.vm2m(
          `/orgunits/${encodePathSegment(orgUnitId)}/excessivedowntimes`,
          { query },
        );
        return body;
      }),
  );

  registerTool(
    server,
    registry,
    'caddis_get_tree',
    {
      title: 'Get the org unit / equipment tree',
      description:
        'Nested tree of org units and equipment. Without orgUnitId, returns the full company tree ' +
        'from the root. With orgUnitId, returns the subtree rooted at that org unit.',
      inputSchema: {
        orgUnitId: idParam
          .optional()
          .describe('Root for the subtree; omit for the full company tree'),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ orgUnitId }) =>
      runTool(async () => {
        const path = orgUnitId !== undefined ? `/tree/${encodePathSegment(orgUnitId)}` : '/tree';
        const { body } = await client.vm2m(path);
        return body;
      }),
  );
}
