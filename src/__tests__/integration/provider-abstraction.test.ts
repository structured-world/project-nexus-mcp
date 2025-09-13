import { ProviderManager } from '../../providers/ProviderManager.js';
import { EnhancedWorkItemsManager } from '../../abstraction/EnhancedWorkItemsManager.js';
import { NexusConfig } from '../../types/index.js';

describe('Provider Abstraction Layer Integration', () => {
  let providerManager: ProviderManager;
  let workItemsManager: EnhancedWorkItemsManager;

  const mockConfig: NexusConfig = {
    providers: [
      {
        id: 'github',
        name: 'GitHub',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'test_token' },
        enabled: true,
      },
      {
        id: 'gitlab',
        name: 'GitLab',
        type: 'stdio',
        command: 'echo',
        args: ['GitLab MCP server would be here'],
        env: { GITLAB_TOKEN: 'test_token' },
        enabled: true,
      },
      {
        id: 'azure',
        name: 'Azure DevOps',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@azure-devops/mcp', 'test_organization'],
        env: { AZURE_TOKEN: 'test_token' },
        enabled: true,
      },
    ],
    projects: {},
  };

  beforeEach(() => {
    // Initialize provider manager
    providerManager = new ProviderManager();

    // Add mock providers
    const mockProviders = [
      {
        id: 'github',
        config: mockConfig.providers[0],
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        status: 'connected' as const,
      },
      {
        id: 'gitlab',
        config: mockConfig.providers[1],
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        status: 'connected' as const,
      },
      {
        id: 'azure',
        config: mockConfig.providers[2],
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        status: 'connected' as const,
      },
    ];

    // Mock the providers map
    mockProviders.forEach((provider) => {
      (providerManager as any).providers.set(provider.id, provider);
    });

    workItemsManager = new EnhancedWorkItemsManager(providerManager);
  });

  describe('Graceful Provider Initialization', () => {
    it('should create EnhancedWorkItemsManager without errors', () => {
      expect(workItemsManager).toBeDefined();
      expect(workItemsManager).toBeInstanceOf(EnhancedWorkItemsManager);
    });

    it('should initialize adapters gracefully and skip unconfigured providers', async () => {
      const result = await workItemsManager.initializeAdapters({ silent: true });

      expect(result).toEqual({
        initialized: 0,
        skipped: 3, // All 3 providers should be skipped due to missing real config
        failed: 0,
        results: expect.arrayContaining([
          expect.objectContaining({
            provider: 'github',
            status: 'missing-token',
            isValid: false,
          }),
          expect.objectContaining({
            provider: 'gitlab',
            status: 'missing-token',
            isValid: false,
          }),
          expect.objectContaining({
            provider: 'azure',
            status: 'missing-token',
            isValid: false,
          }),
        ]),
      });
    });

    it('should provide helpful configuration status', () => {
      const status = workItemsManager.getConfigurationStatus();

      expect(status.configured).toEqual([]);
      expect(status.missing).toHaveLength(3);
      expect(status.total).toBe(3);
      expect(status.missing).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'github',
            reason: expect.stringContaining('GITHUB_TOKEN'),
          }),
          expect.objectContaining({
            provider: 'gitlab',
            reason: expect.stringContaining('GITLAB_TOKEN'),
          }),
          expect.objectContaining({
            provider: 'azure',
            reason: expect.stringContaining('AZURE_TOKEN'),
          }),
        ]),
      );
    });
  });

  describe('Provider Capabilities', () => {
    it('should detect capabilities for connected providers', async () => {
      const capabilities = await workItemsManager.getProviderCapabilities();

      // Should be empty map since no providers are configured
      expect(capabilities).toBeInstanceOf(Map);
      expect(capabilities.size).toBe(0);
    });
  });

  describe('Work Item Operations with Fallback', () => {
    it('should attempt work item creation with fallback to legacy system', async () => {
      await expect(
        workItemsManager.createWorkItemEnhanced('github:test/repo', {
          type: 'story',
          title: 'Test Integration Story',
          description: 'This is a test of the integrated system',
          labels: ['test', 'integration'],
          priority: 'medium',
        }),
      ).rejects.toThrow('No create tool found for provider github');
    });

    it('should handle cross-provider search gracefully', async () => {
      const results = await workItemsManager.searchWorkItems('integration test');

      expect(results).toEqual([]);
    });
  });

  describe('Migration System', () => {
    it('should reject migration when adapters are not available', async () => {
      await expect(
        workItemsManager.migrateWorkItems(
          'gitlab:mygroup/project',
          'github:myorg/repo',
          ['gitlab:123'],
          { dryRun: true },
        ),
      ).rejects.toThrow('Migration requires both source (gitlab) and target (github) adapters');
    });
  });

  describe('System Resilience', () => {
    it('should continue working despite no configured providers', () => {
      expect(() => {
        new EnhancedWorkItemsManager(providerManager);
      }).not.toThrow();
    });

    it('should handle provider manager with no providers', () => {
      const emptyProviderManager = new ProviderManager();
      const emptyWorkItemsManager = new EnhancedWorkItemsManager(emptyProviderManager);

      expect(emptyWorkItemsManager).toBeDefined();
    });
  });
});

describe('Non-Fatal Provider Tests', () => {
  it('should demonstrate non-fatal behavior in development mode', async () => {
    const providerManager = new ProviderManager();
    const workItemsManager = new EnhancedWorkItemsManager(providerManager);

    // This should not throw, even with no providers
    const result = await workItemsManager.initializeAdapters({ silent: true });

    expect(result.initialized).toBe(0);
    expect(result.skipped).toBe(0); // No providers to skip
    expect(result.failed).toBe(0);

    // System should still be usable for other operations
    const capabilities = await workItemsManager.getProviderCapabilities();
    expect(capabilities.size).toBe(0);
  });
});
