import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { registerTool, type ToolHandlerRegistry } from '../registry.js';
import { readOnlyAnnotations, runTool } from '../schemas.js';

export function registerCompanyTools(
  server: McpServer,
  client: CaddisApiClient,
  registry: ToolHandlerRegistry,
): void {
  registerTool(
    server,
    registry,
    'caddis_get_company',
    {
      title: 'Get company details',
      description:
        'Fetch the active company (name, timezone, point-of-contact, and other top-level settings). ' +
        'Useful as a first call to confirm which company the session is scoped to.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () =>
      runTool(async () => {
        const { body } = await client.vm2m('/company');
        return body;
      }),
  );
}
