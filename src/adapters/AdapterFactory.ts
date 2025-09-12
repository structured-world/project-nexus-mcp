import { IProviderAdapter, ProviderConfig } from './IProviderAdapter.js';
import { GitLabAdapter } from './GitLabAdapter.js';
import { GitHubAdapter } from './GitHubAdapter.js';
import { AzureAdapter } from './AzureAdapter.js';
import { Provider } from '../types/index.js';

/**
 * Factory for creating provider adapters
 */
export class AdapterFactory {
  private constructor() {
    // Utility class - prevent instantiation
  }

  private static readonly adapterClasses = new Map<Provider, new () => IProviderAdapter>([
    ['gitlab', GitLabAdapter],
    ['github', GitHubAdapter],
    ['azure', AzureAdapter],
  ]);

  /**
   * Create a new adapter instance for the specified provider
   */
  static create(provider: Provider): IProviderAdapter {
    const AdapterClass = this.adapterClasses.get(provider);

    if (!AdapterClass) {
      throw new Error(`No adapter found for provider: ${provider}`);
    }

    return new AdapterClass();
  }

  /**
   * Create and initialize an adapter
   */
  static async createAndInitialize(
    provider: Provider,
    config: ProviderConfig,
  ): Promise<IProviderAdapter> {
    const adapter = this.create(provider);
    await adapter.initialize(config);
    return adapter;
  }

  /**
   * Get list of supported providers
   */
  static getSupportedProviders(): Provider[] {
    return Array.from(this.adapterClasses.keys());
  }

  /**
   * Check if a provider is supported
   */
  static isSupported(provider: string): provider is Provider {
    return this.adapterClasses.has(provider as Provider);
  }

  /**
   * Register a custom adapter class
   */
  static registerAdapter(provider: Provider, adapterClass: new () => IProviderAdapter): void {
    this.adapterClasses.set(provider, adapterClass);
  }
}

/**
 * Registry for managing active adapter instances
 */
export class AdapterRegistry {
  private adapters = new Map<string, IProviderAdapter>();
  private configs = new Map<string, ProviderConfig>();

  /**
   * Register an adapter instance with a unique key
   */
  async register(
    key: string,
    provider: Provider,
    config: ProviderConfig,
  ): Promise<IProviderAdapter> {
    // Validate configuration
    this.validateConfig(provider, config);

    // Create and initialize adapter
    const adapter = await AdapterFactory.createAndInitialize(provider, config);

    // Store in registry
    this.adapters.set(key, adapter);
    this.configs.set(key, { ...config }); // Store copy

    console.log(`[AdapterRegistry] Registered ${provider} adapter with key: ${key}`);
    return adapter;
  }

  /**
   * Get adapter by key
   */
  get(key: string): IProviderAdapter | undefined {
    return this.adapters.get(key);
  }

  /**
   * Get adapter by key, throw if not found
   */
  getRequired(key: string): IProviderAdapter {
    const adapter = this.get(key);
    if (!adapter) {
      throw new Error(`Adapter not found: ${key}`);
    }
    return adapter;
  }

  /**
   * Get all registered adapter keys
   */
  getKeys(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all adapters
   */
  getAll(): Map<string, IProviderAdapter> {
    return new Map(this.adapters);
  }

  /**
   * Get adapters by provider type
   */
  getByProvider(provider: Provider): Map<string, IProviderAdapter> {
    const result = new Map<string, IProviderAdapter>();

    for (const [key, config] of this.configs.entries()) {
      if (this.detectProvider(config) === provider) {
        const adapter = this.adapters.get(key);
        if (adapter) {
          result.set(key, adapter);
        }
      }
    }

    return result;
  }

  /**
   * Check if adapter exists
   */
  has(key: string): boolean {
    return this.adapters.has(key);
  }

  /**
   * Remove adapter from registry
   */
  unregister(key: string): boolean {
    const removed = this.adapters.delete(key);
    this.configs.delete(key);

    if (removed) {
      console.log(`[AdapterRegistry] Unregistered adapter: ${key}`);
    }

    return removed;
  }

  /**
   * Clear all adapters
   */
  clear(): void {
    this.adapters.clear();
    this.configs.clear();
    console.log(`[AdapterRegistry] Cleared all adapters`);
  }

  /**
   * Get adapter configuration
   */
  getConfig(key: string): ProviderConfig | undefined {
    return this.configs.get(key);
  }

  /**
   * Update adapter configuration and reinitialize
   */
  async updateConfig(key: string, newConfig: ProviderConfig): Promise<IProviderAdapter> {
    if (!this.has(key)) {
      throw new Error(`Adapter not found: ${key}`);
    }

    const provider = this.detectProvider(newConfig);
    this.validateConfig(provider, newConfig);

    // Create new adapter with updated config
    const adapter = await AdapterFactory.createAndInitialize(provider, newConfig);

    // Replace in registry
    this.adapters.set(key, adapter);
    this.configs.set(key, { ...newConfig });

    console.log(`[AdapterRegistry] Updated configuration for: ${key}`);
    return adapter;
  }

  /**
   * Test connection for all registered adapters
   */
  async testConnections(): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();

    for (const [key, adapter] of this.adapters.entries()) {
      try {
        const success = await adapter.validateConnection();
        results.set(key, { success });
      } catch (error) {
        results.set(key, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalAdapters: number;
    byProvider: Record<string, number>;
    activeConnections: number;
  } {
    const byProvider: Record<string, number> = {};
    let activeConnections = 0;

    for (const config of this.configs.values()) {
      const provider = this.detectProvider(config);
      byProvider[provider] = (byProvider[provider] || 0) + 1;
    }

    // This is a simplification - in practice you'd want to actually test connections
    activeConnections = this.adapters.size;

    return {
      totalAdapters: this.adapters.size,
      byProvider,
      activeConnections,
    };
  }

  /**
   * Create adapter key from config
   */
  static createKey(provider: Provider, config: ProviderConfig): string {
    const parts: string[] = [provider];

    if (config.organization) {
      parts.push(config.organization);
    }

    if (config.project) {
      parts.push(config.project);
    } else if (config.group) {
      parts.push(config.group);
    }

    return parts.join(':');
  }

  /**
   * Parse adapter key back to components
   */
  static parseKey(key: string): { provider: Provider; organization?: string; project?: string } {
    const parts = key.split(':');
    const provider = parts[0] as Provider;

    if (!AdapterFactory.isSupported(provider)) {
      throw new Error(`Invalid provider in key: ${String(provider)}`);
    }

    return {
      provider,
      organization: parts[1],
      project: parts[2],
    };
  }

  // Private helper methods

  private detectProvider(config: ProviderConfig): Provider {
    // Try to detect provider from config properties
    if (config.apiUrl) {
      if (config.apiUrl.includes('gitlab')) return 'gitlab';
      if (config.apiUrl.includes('github')) return 'github';
      if (config.apiUrl.includes('azure') || config.apiUrl.includes('dev.azure.com'))
        return 'azure';
    }

    // Try to detect from config structure
    if (config.group) return 'gitlab' as Provider; // GitLab uses groups
    if (config.organization && config.apiUrl.includes('dev.azure.com')) return 'azure' as Provider;
    if (config.organization && !config.group) return 'github' as Provider; // GitHub uses orgs without groups

    throw new Error('Cannot detect provider type from configuration');
  }

  private validateConfig(provider: Provider, config: ProviderConfig): void {
    // Common validations
    if (!config.id) {
      throw new Error('Configuration must have an id');
    }

    if (!config.name) {
      throw new Error('Configuration must have a name');
    }

    if (!config.token) {
      throw new Error('Configuration must have a token');
    }

    // Provider-specific validations
    switch (provider) {
      case 'gitlab':
        if (!config.apiUrl) {
          throw new Error('GitLab configuration must have apiUrl');
        }
        break;

      case 'github':
        if (!config.organization && !config.project?.includes('/')) {
          throw new Error(
            'GitHub configuration must have organization or owner/repo format project',
          );
        }
        break;

      case 'azure':
        if (!config.organization) {
          throw new Error('Azure DevOps configuration must have organization');
        }
        if (!config.project) {
          throw new Error('Azure DevOps configuration must have project');
        }
        break;
    }
  }
}

/**
 * Global adapter registry instance
 */
export const globalAdapterRegistry = new AdapterRegistry();
