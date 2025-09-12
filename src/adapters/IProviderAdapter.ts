import {
  WorkItem,
  CreateWorkItemData,
  UpdateWorkItemData,
  WorkItemFilter,
  WorkItemExport,
  WorkItemImport,
  MigrationResult,
  ProviderCapabilities,
  LinkType,
} from '../types/index.js';

/**
 * Base provider adapter interface for work item management
 * Provides common operations across GitLab, GitHub, and Azure DevOps
 */
export interface IProviderAdapter {
  // Authentication and setup
  initialize(config: ProviderConfig): Promise<void>;
  validateConnection(): Promise<boolean>;

  // Work Items - Core CRUD operations
  getWorkItem(id: string): Promise<WorkItem>;
  listWorkItems(filter: WorkItemFilter): Promise<WorkItem[]>;
  createWorkItem(data: CreateWorkItemData): Promise<WorkItem>;
  updateWorkItem(id: string, updates: UpdateWorkItemData): Promise<WorkItem>;
  deleteWorkItem(id: string): Promise<void>;

  // Relationships - Link management
  linkWorkItems(parent: string, child: string, linkType: LinkType): Promise<void>;
  unlinkWorkItems(parent: string, child: string): Promise<void>;

  // Bulk Operations - Performance optimization
  bulkCreate(items: CreateWorkItemData[]): Promise<WorkItem[]>;
  bulkUpdate(updates: Map<string, UpdateWorkItemData>): Promise<WorkItem[]>;

  // Search & Query - Advanced filtering
  search(query: string): Promise<WorkItem[]>;
  executeQuery(query: string): Promise<WorkItem[]>; // Platform-specific query language

  // Migration Support - Data transfer
  exportWorkItems(ids: string[]): Promise<WorkItemExport[]>;
  importWorkItems(exports: WorkItemImport[]): Promise<MigrationResult>;

  // Capabilities - Feature detection
  getCapabilities(): ProviderCapabilities;
}

/**
 * Configuration interface for provider adapters
 */
export interface ProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  token: string;
  organization?: string; // For Azure DevOps and GitHub
  project?: string; // Default project for Azure DevOps
  group?: string; // For GitLab
  process?: 'agile' | 'scrum' | 'basic'; // For Azure DevOps
}

/**
 * Transform options for data migration between providers
 */
export interface TransformOptions {
  preserveIds: boolean; // Try to maintain IDs in description
  mapUsers: Map<string, string>; // User mapping table
  mapLabels: Map<string, string>; // Label transformation rules
  defaultAssignee?: string; // For single-assignee targets
  handleMissingFields: 'ignore' | 'metadata' | 'description';
  customFieldMapping: Record<string, string>;
}

/**
 * Result of data transformation operation
 */
export interface TransformResult {
  items: WorkItemImport[];
  warnings: string[];
  errors: string[];
  fieldsMapped: Map<string, string>;
  fieldsLost: string[];
}

/**
 * Migration pipeline interface for ETL operations
 */
export interface MigrationPipeline {
  // Phase 1: Extract
  extract(source: IProviderAdapter, filter: WorkItemFilter): Promise<WorkItemExport[]>;

  // Phase 2: Transform
  transform(
    items: WorkItemExport[],
    targetProvider: string,
    options: TransformOptions,
  ): Promise<TransformResult>;

  // Phase 3: Load
  load(
    target: IProviderAdapter,
    items: WorkItemImport[],
    options: LoadOptions,
  ): Promise<MigrationResult>;

  // Phase 4: Verify
  verify(
    source: WorkItemExport[],
    target: WorkItem[],
    mapping: Map<string, string>,
  ): Promise<VerificationReport>;
}

export interface LoadOptions {
  batchSize: number;
  continueOnError: boolean;
  dryRun: boolean;
}

export interface VerificationReport {
  totalItems: number;
  successful: number;
  failed: number;
  dataIntegrityIssues: Array<{
    originalId: string;
    newId: string;
    issue: string;
  }>;
}
