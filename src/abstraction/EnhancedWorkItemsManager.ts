import { WorkItemsManager } from './WorkItemsManager.js';
import { AdapterFactory } from '../adapters/AdapterFactory.js';
import { DefaultMigrationPipeline } from '../adapters/MigrationPipeline.js';
import {
  validateProviderConfig,
  logConfigurationStatus,
  ConfigValidationResult,
} from '../utils/configValidator.js';
import {
  WorkItem,
  CreateWorkItemData,
  UpdateWorkItemData,
  WorkItemFilter,
  WorkItemExport,
  MigrationResult,
  Provider,
  ProviderCapabilities,
} from '../types/index.js';
import { IProviderAdapter, ProviderConfig } from '../adapters/IProviderAdapter.js';

/**
 * Enhanced WorkItemsManager that integrates both the legacy MCP approach
 * and the new adapter system for maximum compatibility and functionality
 */
export class EnhancedWorkItemsManager extends WorkItemsManager {
  private adapters = new Map<string, IProviderAdapter>();
  private migrationPipeline = new DefaultMigrationPipeline();
  private configValidationResults: ConfigValidationResult[] = [];

  /**
   * Initialize adapters for providers that support the new adapter system
   * Gracefully skips providers with missing configuration
   */
  async initializeAdapters(options: { silent?: boolean } = {}): Promise<{
    initialized: number;
    skipped: number;
    failed: number;
    results: ConfigValidationResult[];
  }> {
    let initialized = 0;
    let skipped = 0;
    let failed = 0;
    this.configValidationResults = [];

    if (!options.silent) {
      console.log('\n🔧 Initializing Provider Adapters...');
    }

    for (const providerInstance of this.providerManager.getAllProviders()) {
      if (providerInstance.status !== 'connected') continue;

      const providerId = providerInstance.id as Provider;

      // Validate configuration first
      const configResult = validateProviderConfig(providerId);
      this.configValidationResults.push(configResult);

      if (!configResult.isValid) {
        skipped++;
        if (!options.silent) {
          console.log(`⚠️  Skipped ${providerId}: ${configResult.reason}`);
        }
        continue;
      }

      try {
        // Create adapter configuration from provider instance
        const adapterConfig = this.createAdapterConfig(providerInstance);

        // Create and initialize adapter
        const adapter = await AdapterFactory.createAndInitialize(providerId, adapterConfig);

        // Store adapter with key
        const key = providerId;
        this.adapters.set(key, adapter);
        initialized++;

        if (!options.silent) {
          console.log(`✅ Initialized ${providerId} adapter`);
        }
      } catch (error) {
        failed++;
        if (!options.silent) {
          console.log(
            `❌ Failed to initialize ${providerId} adapter: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    if (!options.silent) {
      console.log(`\n📊 Adapter Initialization Summary:`);
      console.log(`   ✅ Initialized: ${initialized}`);
      console.log(`   ⚠️  Skipped: ${skipped}`);
      console.log(`   ❌ Failed: ${failed}`);

      if (skipped > 0) {
        logConfigurationStatus(this.configValidationResults);
      }
    }

    return { initialized, skipped, failed, results: this.configValidationResults };
  }

  /**
   * Check configuration status for all providers
   */
  getConfigurationStatus(): {
    configured: string[];
    missing: Array<{ provider: string; reason: string }>;
    total: number;
  } {
    const configured: string[] = [];
    const missing: Array<{ provider: string; reason: string }> = [];

    // If we have cached results, use them
    if (this.configValidationResults.length > 0) {
      this.configValidationResults.forEach((result) => {
        if (result.isValid) {
          configured.push(result.provider);
        } else {
          missing.push({
            provider: result.provider,
            reason: result.reason ?? 'Unknown configuration issue',
          });
        }
      });
    } else {
      // Otherwise, validate all known providers on-demand
      const providers: Provider[] = ['github', 'gitlab', 'azure'];
      providers.forEach((provider) => {
        const result = validateProviderConfig(provider);
        if (result.isValid) {
          configured.push(result.provider);
        } else {
          missing.push({
            provider: result.provider,
            reason: result.reason ?? 'Unknown configuration issue',
          });
        }
      });
    }

    return {
      configured,
      missing,
      total: configured.length + missing.length,
    };
  }

  /**
   * Get capabilities for all connected providers
   */
  getProviderCapabilities(): Map<string, ProviderCapabilities> {
    const capabilities = new Map<string, ProviderCapabilities>();

    for (const [key, adapter] of this.adapters) {
      try {
        capabilities.set(key, adapter.getCapabilities());
      } catch (error) {
        console.error(`Failed to get capabilities for ${key}:`, error);
      }
    }

    return capabilities;
  }

  /**
   * Create work item using adapter system (preferred) or fallback to legacy
   */
  async createWorkItemEnhanced(project: string, data: CreateWorkItemData): Promise<WorkItem> {
    const provider = this.detectProviderFromProject(project);
    const adapter = this.getAdapterForProvider(provider);

    if (adapter) {
      // Use new adapter system
      try {
        return await adapter.createWorkItem(data);
      } catch (error) {
        console.error(
          `Adapter creation failed, falling back to legacy: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Fallback to legacy system
    return await this.createWorkItem(project, {
      title: data.title,
      description: data.description,
      type: data.type,
      labels: data.labels,
      priority: data.priority,
    });
  }

  /**
   * Update work item using adapter system (preferred) or fallback to legacy
   */
  async updateWorkItemEnhanced(id: string, updates: UpdateWorkItemData): Promise<WorkItem> {
    const [provider] = id.split(':');
    const adapter = this.getAdapterForProvider(provider);

    if (adapter) {
      // Use new adapter system
      try {
        return await adapter.updateWorkItem(id, updates);
      } catch (error) {
        console.error(
          `Adapter update failed, falling back to legacy: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Fallback to legacy system
    return await this.updateWorkItem(id, {
      title: updates.title,
      description: updates.description,
      state: updates.state,
      labels: updates.labels,
      priority: updates.priority,
    });
  }

  /**
   * List work items using adapter system (preferred) or fallback to legacy
   */
  async listWorkItemsEnhanced(project?: string, filter?: WorkItemFilter): Promise<WorkItem[]> {
    if (project) {
      const provider = this.detectProviderFromProject(project);
      const adapter = this.getAdapterForProvider(provider);

      if (adapter && filter) {
        // Use new adapter system
        try {
          return await adapter.listWorkItems(filter);
        } catch (error) {
          console.error(
            `Adapter listing failed, falling back to legacy: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    // Fallback to legacy system
    const legacyFilters: Record<string, unknown> = {};
    if (filter) {
      if (filter.state && filter.state !== 'all') legacyFilters.status = filter.state;
      if (filter.assignee) legacyFilters.assignee = filter.assignee;
      if (filter.labels) legacyFilters.labels = filter.labels;
    }

    return await this.listWorkItems(project, legacyFilters);
  }

  /**
   * Search across all providers using adapter system
   */
  async searchWorkItems(query: string): Promise<WorkItem[]> {
    const results: WorkItem[] = [];

    for (const [key, adapter] of this.adapters) {
      try {
        const providerResults = await adapter.search(query);
        results.push(...providerResults);
      } catch (error) {
        console.error(
          `Search failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return results;
  }

  /**
   * Migrate work items between providers using the new migration pipeline
   */
  async migrateWorkItems(
    sourceProject: string,
    targetProject: string,
    _workItemIds: string[],
    options: {
      preserveIds?: boolean;
      mapUsers?: Map<string, string>;
      dryRun?: boolean;
    } = {},
  ): Promise<MigrationResult> {
    const sourceProvider = this.detectProviderFromProject(sourceProject);
    const targetProvider = this.detectProviderFromProject(targetProject);

    const sourceAdapter = this.getAdapterForProvider(sourceProvider);
    const targetAdapter = this.getAdapterForProvider(targetProvider);

    if (!sourceAdapter || !targetAdapter) {
      throw new Error(
        `Migration requires both source (${sourceProvider}) and target (${targetProvider}) adapters`,
      );
    }

    // Phase 1: Extract
    const filter: WorkItemFilter = {}; // Would be configured based on workItemIds
    const exported = await this.migrationPipeline.extract(sourceAdapter, filter);

    // Phase 2: Transform
    const transformResult = await this.migrationPipeline.transform(
      exported,
      targetProvider as Provider,
      {
        preserveIds: options.preserveIds ?? true,
        mapUsers: options.mapUsers ?? new Map<string, string>(),
        mapLabels: new Map(),
        handleMissingFields: 'metadata',
        customFieldMapping: {},
      },
    );

    if (options.dryRun) {
      return {
        successful: transformResult.items.length,
        failed: transformResult.errors.map((error) => ({ id: 'dry-run', reason: error })),
        mapping: new Map(),
      };
    }

    // Phase 3: Load
    const migrationResult = await this.migrationPipeline.load(
      targetAdapter,
      transformResult.items,
      {
        batchSize: 10,
        continueOnError: true,
        dryRun: false,
      },
    );

    return migrationResult;
  }

  /**
   * Export work items for backup or analysis
   */
  async exportWorkItems(project: string, filter?: WorkItemFilter): Promise<WorkItemExport[]> {
    const provider = this.detectProviderFromProject(project);
    const adapter = this.getAdapterForProvider(provider);

    if (!adapter) {
      throw new Error(`Export requires adapter for provider: ${provider}`);
    }

    return await this.migrationPipeline.extract(adapter, filter ?? {});
  }

  private createAdapterConfig(providerInstance: {
    id: string;
    config: { name?: string };
  }): ProviderConfig {
    // Extract configuration from environment or provider config
    const baseUrl = this.getProviderBaseUrl(providerInstance.id);
    const token = this.getProviderToken(providerInstance.id);

    return {
      id: providerInstance.id,
      name: providerInstance.config.name ?? providerInstance.id,
      apiUrl: baseUrl,
      token: token,
      organization: this.getProviderOrganization(providerInstance.id),
      project: this.getProviderProject(providerInstance.id),
      group: this.getProviderGroup(providerInstance.id),
    };
  }

  private getProviderBaseUrl(providerId: string): string {
    switch (providerId) {
      case 'github':
        return 'https://api.github.com';
      case 'gitlab':
        return process.env.GITLAB_URL ?? 'https://gitlab.com/api/v4';
      case 'azure':
        return 'https://dev.azure.com';
      default:
        return '';
    }
  }

  private getProviderToken(providerId: string): string {
    switch (providerId) {
      case 'github':
        return process.env.GITHUB_TOKEN ?? 'test_token';
      case 'gitlab':
        return process.env.GITLAB_TOKEN ?? 'test_token';
      case 'azure':
        return process.env.AZURE_TOKEN ?? 'test_token';
      default:
        return 'test_token';
    }
  }

  private getProviderOrganization(providerId: string): string | undefined {
    switch (providerId) {
      case 'github':
        return process.env.GITHUB_ORG;
      case 'azure':
        return process.env.AZURE_ORG;
      default:
        return undefined;
    }
  }

  private getProviderProject(providerId: string): string | undefined {
    switch (providerId) {
      case 'azure':
        return process.env.AZURE_PROJECT;
      default:
        return undefined;
    }
  }

  private getProviderGroup(providerId: string): string | undefined {
    switch (providerId) {
      case 'gitlab':
        return process.env.GITLAB_GROUP;
      default:
        return undefined;
    }
  }

  private getAdapterForProvider(provider: string): IProviderAdapter | null {
    // Try exact match first
    if (this.adapters.has(provider)) {
      const adapter = this.adapters.get(provider);
      if (adapter) return adapter;
    }

    // Try to find adapter by provider type
    for (const [key, adapter] of this.adapters) {
      if (key.startsWith(provider + ':') || key === provider) {
        return adapter;
      }
    }

    return null;
  }
}
