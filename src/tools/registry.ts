import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type ZodRawShape, z } from 'zod';

export type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

interface ToolEntry {
  inputSchema: z.ZodObject<ZodRawShape>;
  handler: ToolHandler;
}

export class ToolHandlerRegistry {
  private map = new Map<string, ToolEntry>();

  register(name: string, shape: ZodRawShape, handler: ToolHandler): void {
    if (this.map.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    this.map.set(name, { inputSchema: z.object(shape), handler });
  }

  get(name: string): ToolEntry | undefined {
    return this.map.get(name);
  }

  names(): string[] {
    return [...this.map.keys()];
  }
}

interface ToolConfig<S extends ZodRawShape> {
  title: string;
  description: string;
  inputSchema?: S;
  annotations?: Record<string, unknown>;
}

export function registerTool<S extends ZodRawShape>(
  server: McpServer,
  registry: ToolHandlerRegistry,
  name: string,
  config: ToolConfig<S>,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>,
): void {
  server.registerTool(name, config as never, handler as never);
  registry.register(name, config.inputSchema ?? ({} as S), handler as ToolHandler);
}

export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (max < 1) throw new Error(`createLimiter: max must be >= 1, got ${max}`);
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
