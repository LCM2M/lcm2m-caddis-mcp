import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../client.js';
import { registerCompositeTools } from './composite/index.js';
import { registerAlarmTools } from './wrappers/alarms.js';
import { registerCompanyTools } from './wrappers/company.js';
import { registerDeviceTools } from './wrappers/devices.js';
import { registerEquipmentTools } from './wrappers/equipment.js';
import { registerOrgUnitTools } from './wrappers/orgunits.js';
import { registerRunTools } from './wrappers/runs.js';
import { registerStatusReasonTools } from './wrappers/statusreasons.js';
import { registerTagGroupTools } from './wrappers/taggroups.js';
import { registerTagTools } from './wrappers/tags.js';

export function registerAllTools(server: McpServer, client: CaddisApiClient): void {
  registerCompanyTools(server, client);
  registerDeviceTools(server, client);
  registerEquipmentTools(server, client);
  registerOrgUnitTools(server, client);
  registerAlarmTools(server, client);
  registerTagTools(server, client);
  registerTagGroupTools(server, client);
  registerRunTools(server, client);
  registerStatusReasonTools(server, client);
  registerCompositeTools(server, client);
}
