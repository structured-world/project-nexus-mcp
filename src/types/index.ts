import { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

export interface ProviderConfig {
  id: string;
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  version?: string;
  autoUpdate?: boolean;
}

export interface ProjectMapping {
  [path: string]: string;
}

export interface NexusConfig {
  providers: ProviderConfig[];
  projects: ProjectMapping;
  defaultRepository?: string;
  defaultTask?: string;
}

export interface ProviderInstance {
  id: string;
  config: ProviderConfig;
  client?: Client;
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  prompts: Map<string, Prompt>;
  status: 'starting' | 'connected' | 'disconnected' | 'error' | 'auth_failed';
  error?: string;
  errorType?: 'auth' | 'network' | 'config' | 'unknown';
  shouldReconnect?: boolean;
  reconnectAttempts?: number;
  lastReconnectTime?: Date;
  lastUpdated?: Date;
}

export interface WorkItem {
  id: string;
  provider: string;
  type: 'issue' | 'task' | 'epic' | 'story' | 'bug';
  title: string;
  description?: string;
  status: string;
  assignee?: string;
  labels?: string[];
  milestone?: string;
  priority?: string;
  createdAt?: Date;
  updatedAt?: Date;
  originalData?: unknown;
}

export interface UnifiedToolCall {
  provider: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface MCPResult {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  isError?: boolean;
}

export interface ProviderAPIResponse {
  id?: string | number;
  number?: number;
  iid?: number;
  title?: string;
  name?: string;
  summary?: string;
  description?: string;
  body?: string;
  content?: string;
  state?: string;
  status?: string;
  type?: string;
  issue_type?: string;
  assignee?: string | { username?: string; login?: string; name?: string };
  assignees?: Array<string | { username?: string; login?: string; name?: string }>;
  assigned_to?: string | { name?: string };
  labels?: Array<string | { name?: string; title?: string }>;
  tags?: string[];
  milestone?: string | { title?: string };
  priority?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TypeGuards {
  isMCPResult(value: unknown): value is MCPResult;
  isProviderAPIResponse(value: unknown): value is ProviderAPIResponse;
  isStringOrObject(value: unknown): value is string | Record<string, unknown>;
}
