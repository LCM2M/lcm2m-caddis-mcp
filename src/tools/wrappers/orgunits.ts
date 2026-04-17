import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import {
  encodePathSegment,
  idParam,
  readOnlyAnnotations,
  runTool,
  timeWindowRequired,
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
        const { body } = await client.vmcp(`/orgunits/${encodePathSegment(orgUnitId)}`);
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
        const { body } = await client.vmcp(`/orgunits/${encodePathSegment(orgUnitId)}/schedule`);
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
        const { body } = await client.vmcp(
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
        const { body } = await client.vmcp(path);
        return body;
      }),
  );
}
