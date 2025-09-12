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

// Enhanced WorkItem interface as per PROVIDERS.md
export interface WorkItem {
  // Identity
  id: string; // Global unique ID: "provider:owner/project#number"
  provider: 'gitlab' | 'github' | 'azure';

  // Core fields (common across all)
  type: WorkItemType; // Normalized type
  title: string;
  description: string;
  state: 'open' | 'closed'; // Simplified state

  // Relationships
  parent?: WorkItem; // Parent epic/feature
  children?: WorkItem[]; // Child items
  blockedBy?: WorkItem[];
  blocks?: WorkItem[];
  relatedTo?: WorkItem[];

  // People
  author: User;
  assignees: User[]; // May be limited to 1 for Azure
  reviewers?: User[];
  mentions?: User[];

  // Organization
  labels: string[];
  milestone?: Milestone;
  iteration?: Iteration;
  priority?: Priority;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  dueDate?: Date;

  // Provider-specific extensions
  providerFields: ProviderSpecificFields;

  // Migration metadata
  migrationMeta?: {
    sourceProvider: string;
    sourceId: string;
    migratedAt: Date;
    dataMappingNotes: string[];
  };
}

// Legacy WorkItem interface for backward compatibility
export interface LegacyWorkItem {
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

// New type definitions as per PROVIDERS.md
export type WorkItemType = 'epic' | 'feature' | 'story' | 'bug' | 'task' | 'test' | 'issue';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Provider = 'gitlab' | 'github' | 'azure';
export type AzureProcess = 'agile' | 'scrum' | 'basic';
export type LinkType = 'blocks' | 'related' | 'duplicate' | 'parent-child';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  provider: Provider;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  startDate?: Date;
  dueDate?: Date;
  state: 'open' | 'closed';
  provider: 'gitlab' | 'github';
}

export interface Iteration {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  state: 'open' | 'closed' | 'upcoming' | 'current';
  provider: 'gitlab' | 'azure';
  path?: string; // Azure iteration path
}

// Provider-specific field containers
export interface GitLabSpecificFields {
  iid: number;
  projectId: number;
  weight?: number;
  timeEstimate?: number;
  timeSpent?: number;
  confidential?: boolean;
  discussionLocked?: boolean;
  epicId?: number;
  healthStatus?: 'on_track' | 'needs_attention' | 'at_risk';
  issueType?: 'issue' | 'incident' | 'test_case' | 'task';
}

export interface GitHubSpecificFields {
  number: number;
  repository: string;
  stateReason?: 'completed' | 'not_planned' | 'reopened';
  reactions?: Record<string, number>;
  isDraft?: boolean;
  projectItems?: Array<{
    projectId: string;
    itemId: string;
    fieldValues: Record<string, unknown>;
  }>;
}

export interface AzureSpecificFields {
  workItemId: number;
  workItemType: string; // Exact ADO type
  areaPath?: string;
  iterationPath?: string;
  state: string; // Full ADO state
  reason?: string;
  boardColumn?: string;
  boardLane?: string;
  storyPoints?: number;
  effort?: number;
  remainingWork?: number;
  originalEstimate?: number;
  completedWork?: number;
  customFields?: Record<string, unknown>;
}

export type ProviderSpecificFields =
  | GitLabSpecificFields
  | GitHubSpecificFields
  | AzureSpecificFields;

// Work item hierarchy and capabilities
export enum HierarchyLevel {
  Portfolio = 0, // Epic level
  Feature = 1, // Feature/Sub-epic
  Requirement = 2, // User Story/Issue
  Task = 3, // Task/Sub-task
}

export interface ProviderCapabilities {
  supportsEpics: boolean;
  supportsIterations: boolean;
  supportsMilestones: boolean;
  supportsMultipleAssignees: boolean;
  supportsConfidential: boolean;
  supportsWeight: boolean;
  supportsTimeTracking: boolean;
  supportsCustomFields: boolean;
  maxAssignees: number;
  hierarchyLevels: number;
  customWorkItemTypes: string[];
}

// Data structures for CRUD operations
export interface CreateWorkItemData {
  type: WorkItemType;
  title: string;
  description: string;
  assignees?: User[];
  labels?: string[];
  priority?: Priority;
  parent?: WorkItem;
  milestone?: Milestone;
  iteration?: Iteration;
  dueDate?: Date;
  confidential?: boolean;
  customFields?: Record<string, unknown>;
}

export interface UpdateWorkItemData {
  title?: string;
  description?: string;
  state?: 'open' | 'closed';
  assignees?: User[];
  labels?: string[];
  priority?: Priority;
  milestone?: Milestone;
  iteration?: Iteration;
  dueDate?: Date;
}

export interface WorkItemFilter {
  type?: WorkItemType;
  state?: 'open' | 'closed' | 'all';
  assignee?: string;
  labels?: string[];
  milestone?: string;
  iteration?: string;
  priority?: Priority;
  since?: Date;
  until?: Date;
}

// Migration support types
export interface WorkItemExport {
  id: string;
  provider: Provider;
  type: WorkItemType;
  title: string;
  description: string;
  state: 'open' | 'closed';
  assignees: User[];
  labels: string[];
  milestone?: Milestone;
  iteration?: Iteration;
  priority?: Priority;
  createdAt: Date;
  updatedAt: Date;
  providerFields: ProviderSpecificFields;
  relationships: {
    parent?: string;
    children: string[];
    blocks: string[];
    blockedBy: string[];
    relatedTo: string[];
  };
}

export interface WorkItemImport {
  title: string;
  description: string;
  type: WorkItemType;
  state: 'open' | 'closed';
  labels: string[];
  assignees: User[];
  priority?: Priority;
  customFields: Record<string, unknown>;
}

export interface MigrationResult {
  successful: number;
  failed: Array<{
    id: string;
    reason: string;
  }>;
  mapping: Map<string, string>; // old ID -> new ID
}
