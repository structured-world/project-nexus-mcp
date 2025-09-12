import { IProviderAdapter, ProviderConfig } from './IProviderAdapter.js';
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
 * Base adapter implementation with common functionality
 * Provides default implementations and utility methods for concrete adapters
 */
export abstract class BaseAdapter implements IProviderAdapter {
  protected config!: ProviderConfig;
  protected initialized = false;

  abstract initialize(config: ProviderConfig): Promise<void>;
  abstract validateConnection(): Promise<boolean>;
  abstract getWorkItem(id: string): Promise<WorkItem>;
  abstract listWorkItems(filter: WorkItemFilter): Promise<WorkItem[]>;
  abstract createWorkItem(data: CreateWorkItemData): Promise<WorkItem>;
  abstract updateWorkItem(id: string, updates: UpdateWorkItemData): Promise<WorkItem>;
  abstract deleteWorkItem(id: string): Promise<void>;
  abstract search(query: string): Promise<WorkItem[]>;
  abstract executeQuery(query: string): Promise<WorkItem[]>;
  abstract getCapabilities(): ProviderCapabilities;

  // Default implementations for optional features

  async linkWorkItems(_parent: string, _child: string, _linkType: LinkType): Promise<void> {
    await Promise.resolve();
    throw new Error(`Link management not supported by ${this.config.id}`);
  }

  async unlinkWorkItems(_parent: string, _child: string): Promise<void> {
    await Promise.resolve();
    throw new Error(`Link management not supported by ${this.config.id}`);
  }

  async bulkCreate(items: CreateWorkItemData[]): Promise<WorkItem[]> {
    // Default implementation: sequential creation
    const results: WorkItem[] = [];
    for (const item of items) {
      try {
        const created = await this.createWorkItem(item);
        results.push(created);
      } catch (error) {
        console.error(`Failed to create work item: ${item.title}`, error);
        throw error;
      }
    }
    return results;
  }

  async bulkUpdate(updates: Map<string, UpdateWorkItemData>): Promise<WorkItem[]> {
    // Default implementation: sequential updates
    const results: WorkItem[] = [];
    for (const [id, updateData] of updates) {
      try {
        const updated = await this.updateWorkItem(id, updateData);
        results.push(updated);
      } catch (error) {
        console.error(`Failed to update work item: ${id}`, error);
        throw error;
      }
    }
    return results;
  }

  async exportWorkItems(ids: string[]): Promise<WorkItemExport[]> {
    const exports: WorkItemExport[] = [];

    for (const id of ids) {
      try {
        const workItem = await this.getWorkItem(id);
        const exported: WorkItemExport = {
          id: workItem.id,
          provider: workItem.provider,
          type: workItem.type,
          title: workItem.title,
          description: workItem.description,
          state: workItem.state,
          assignees: workItem.assignees,
          labels: workItem.labels,
          milestone: workItem.milestone,
          iteration: workItem.iteration,
          priority: workItem.priority,
          createdAt: workItem.createdAt,
          updatedAt: workItem.updatedAt,
          providerFields: workItem.providerFields,
          relationships: {
            parent: workItem.parent?.id,
            children: workItem.children?.map((c) => c.id) ?? [],
            blocks: workItem.blocks?.map((b) => b.id) ?? [],
            blockedBy: workItem.blockedBy?.map((b) => b.id) ?? [],
            relatedTo: workItem.relatedTo?.map((r) => r.id) ?? [],
          },
        };
        exports.push(exported);
      } catch (error) {
        console.error(`Failed to export work item: ${id}`, error);
      }
    }

    return exports;
  }

  async importWorkItems(imports: WorkItemImport[]): Promise<MigrationResult> {
    const result: MigrationResult = {
      successful: 0,
      failed: [],
      mapping: new Map(),
    };

    for (const importItem of imports) {
      try {
        const created = await this.createWorkItem({
          type: importItem.type,
          title: importItem.title,
          description: importItem.description,
          assignees: importItem.assignees,
          labels: importItem.labels,
          priority: importItem.priority,
          customFields: importItem.customFields,
        });

        result.successful++;
        result.mapping.set(importItem.title, created.id); // Use title as temporary key
      } catch (error) {
        result.failed.push({
          id: importItem.title,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  // Utility methods for concrete adapters

  /**
   * Check if adapter has been initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Adapter ${this.config.id || 'unknown'} not initialized`);
    }
  }

  /**
   * Create HTTP headers with authentication
   */
  protected createAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Project-Nexus-MCP/1.0',
    };
  }

  /**
   * Handle common HTTP errors
   */
  protected handleHttpError(response: Response, context: string): never {
    if (response.status === 401) {
      throw new Error(`Authentication failed for ${this.config.id}: Invalid token`);
    } else if (response.status === 403) {
      throw new Error(`Access denied for ${this.config.id}: Insufficient permissions`);
    } else if (response.status === 404) {
      throw new Error(`Resource not found in ${context}`);
    } else if (response.status >= 500) {
      throw new Error(`Server error (${response.status}) in ${context}`);
    } else {
      throw new Error(`HTTP ${response.status} error in ${context}: ${response.statusText}`);
    }
  }

  /**
   * Retry logic with exponential backoff
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxAttempts) {
          break;
        }

        // Don't retry auth errors
        if (
          lastError.message.includes('Authentication failed') ||
          lastError.message.includes('Access denied')
        ) {
          break;
        }

        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error('Operation failed after retries');
  }

  /**
   * Validate required fields for work item creation
   */
  protected validateCreateData(data: CreateWorkItemData): void {
    if (!data.title.trim()) {
      throw new Error('Title is required');
    }
  }

  /**
   * Sanitize and validate work item data
   */
  protected sanitizeWorkItem(item: Partial<WorkItem>): Partial<WorkItem> {
    return {
      ...item,
      title: item.title?.trim(),
      description: item.description?.trim() ?? '',
      labels: Array.isArray(item.labels) ? [...new Set(item.labels)] : [],
    };
  }
}

/**
 * Provider capabilities detection utility
 */
export class CapabilityDetector {
  private constructor() {
    // Utility class - prevent instantiation
  }

  /**
   * Detect GitLab capabilities based on license/version
   */
  static detectGitLabCapabilities(_version?: string, license?: string): ProviderCapabilities {
    const isPremium = license?.includes('Premium') ?? license?.includes('Ultimate') ?? false;

    return {
      supportsEpics: isPremium,
      supportsIterations: isPremium,
      supportsMilestones: true,
      supportsMultipleAssignees: isPremium,
      supportsConfidential: true,
      supportsWeight: true,
      supportsTimeTracking: true,
      supportsCustomFields: false,
      maxAssignees: isPremium ? 100 : 1,
      hierarchyLevels: isPremium ? 3 : 2,
      customWorkItemTypes: ['issue', 'task', 'incident', 'test_case'],
    };
  }

  /**
   * Detect GitHub capabilities
   */
  static detectGitHubCapabilities(): ProviderCapabilities {
    return {
      supportsEpics: false, // Can simulate with parent issues
      supportsIterations: false, // Can use milestones
      supportsMilestones: true,
      supportsMultipleAssignees: true,
      supportsConfidential: false,
      supportsWeight: false,
      supportsTimeTracking: false,
      supportsCustomFields: true, // Through Projects Beta
      maxAssignees: 10,
      hierarchyLevels: 2,
      customWorkItemTypes: ['issue'],
    };
  }

  /**
   * Detect Azure DevOps capabilities based on process template
   */
  static detectAzureCapabilities(
    process: 'agile' | 'scrum' | 'basic' = 'agile',
  ): ProviderCapabilities {
    const workItemTypes = {
      agile: ['Epic', 'Feature', 'User Story', 'Task', 'Bug', 'Test Case'],
      scrum: ['Epic', 'Feature', 'Product Backlog Item', 'Task', 'Bug', 'Test Case'],
      basic: ['Epic', 'Issue', 'Task'],
    };

    return {
      supportsEpics: true,
      supportsIterations: true,
      supportsMilestones: false, // Use iterations instead
      supportsMultipleAssignees: false,
      supportsConfidential: false, // Use Area Path security
      supportsWeight: false,
      supportsTimeTracking: true,
      supportsCustomFields: true,
      maxAssignees: 1,
      hierarchyLevels: process === 'basic' ? 3 : 4,
      customWorkItemTypes: workItemTypes[process],
    };
  }
}
