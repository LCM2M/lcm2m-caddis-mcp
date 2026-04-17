import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../client.js';
import type { Config } from '../config.js';
import { registerCompositeTools } from './composite/index.js';
import { ToolHandlerRegistry } from './registry.js';
import { registerAlarmTools } from './wrappers/alarms.js';
import { registerCompanyTools } from './wrappers/company.js';
import { registerDeviceTools } from './wrappers/devices.js';
import { registerEquipmentTools } from './wrappers/equipment.js';
import { registerOrgUnitTools } from './wrappers/orgunits.js';
import { registerRunTools } from './wrappers/runs.js';
import { registerStatusReasonTools } from './wrappers/statusreasons.js';
import { registerTagGroupTools } from './wrappers/taggroups.js';
import { registerTagTools } from './wrappers/tags.js';

export function registerAllTools(server: McpServer, client: CaddisApiClient, config: Config): void {
  const registry = new ToolHandlerRegistry();
  registerCompanyTools(server, client, registry);
  registerDeviceTools(server, client, registry);
  registerEquipmentTools(server, client, registry);
  registerOrgUnitTools(server, client, registry);
  registerAlarmTools(server, client, registry);
  registerTagTools(server, client, registry);
  registerTagGroupTools(server, client, registry);
  registerRunTools(server, client, registry);
  registerStatusReasonTools(server, client, registry);
  registerCompositeTools(server, registry, config);
}
