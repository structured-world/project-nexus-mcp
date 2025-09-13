import { jest } from '@jest/globals';
import {
  AdapterFactory,
  AdapterRegistry,
  globalAdapterRegistry,
} from '../../adapters/AdapterFactory.js';
import { IProviderAdapter, ProviderConfig } from '../../adapters/IProviderAdapter.js';
import { GitLabAdapter } from '../../adapters/GitLabAdapter.js';
import { GitHubAdapter } from '../../adapters/GitHubAdapter.js';
import { AzureAdapter } from '../../adapters/AzureAdapter.js';
import { Provider } from '../../types/index.js';

// Mock adapter classes
jest.mock('../../adapters/GitLabAdapter.js');
jest.mock('../../adapters/GitHubAdapter.js');
jest.mock('../../adapters/AzureAdapter.js');

const MockedGitLabAdapter = GitLabAdapter as jest.MockedClass<typeof GitLabAdapter>;
const MockedGitHubAdapter = GitHubAdapter as jest.MockedClass<typeof GitHubAdapter>;
const MockedAzureAdapter = AzureAdapter as jest.MockedClass<typeof AzureAdapter>;

describe('AdapterFactory', () => {
  let mockGitLabAdapter: jest.Mocked<IProviderAdapter>;
  let mockGitHubAdapter: jest.Mocked<IProviderAdapter>;
  let mockAzureAdapter: jest.Mocked<IProviderAdapter>;
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console.log to suppress output during tests
    originalConsoleLog = console.log;
    console.log = jest.fn();

    // Create mock adapter instances
    mockGitLabAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getProjects: jest.fn(),
      getWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      searchWorkItems: jest.fn(),
      getWorkItemComments: jest.fn(),
      addWorkItemComment: jest.fn(),
      getWorkItemAttachments: jest.fn(),
      addWorkItemAttachment: jest.fn(),
    } as any;

    mockGitHubAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getProjects: jest.fn(),
      getWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      searchWorkItems: jest.fn(),
      getWorkItemComments: jest.fn(),
      addWorkItemComment: jest.fn(),
      getWorkItemAttachments: jest.fn(),
      addWorkItemAttachment: jest.fn(),
    } as any;

    mockAzureAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getProjects: jest.fn(),
      getWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      searchWorkItems: jest.fn(),
      getWorkItemComments: jest.fn(),
      addWorkItemComment: jest.fn(),
      getWorkItemAttachments: jest.fn(),
      addWorkItemAttachment: jest.fn(),
    } as any;

    // Mock constructors
    MockedGitLabAdapter.mockImplementation(() => mockGitLabAdapter as any);
    MockedGitHubAdapter.mockImplementation(() => mockGitHubAdapter as any);
    MockedAzureAdapter.mockImplementation(() => mockAzureAdapter as any);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('create', () => {
    it('should create GitLab adapter', () => {
      const adapter = AdapterFactory.create('gitlab');
      expect(MockedGitLabAdapter).toHaveBeenCalled();
      expect(adapter).toBe(mockGitLabAdapter);
    });

    it('should create GitHub adapter', () => {
      const adapter = AdapterFactory.create('github');
      expect(MockedGitHubAdapter).toHaveBeenCalled();
      expect(adapter).toBe(mockGitHubAdapter);
    });

    it('should create Azure adapter', () => {
      const adapter = AdapterFactory.create('azure');
      expect(MockedAzureAdapter).toHaveBeenCalled();
      expect(adapter).toBe(mockAzureAdapter);
    });

    it('should throw error for unsupported provider', () => {
      expect(() => AdapterFactory.create('unsupported' as Provider)).toThrow(
        'No adapter found for provider: unsupported',
      );
    });
  });

  describe('createAndInitialize', () => {
    const config: ProviderConfig = {
      id: 'test-config',
      name: 'Test Config',
      token: 'test-token',
      apiUrl: 'https://api.test.com',
    };

    it('should create and initialize adapter', async () => {
      mockGitLabAdapter.initialize.mockResolvedValue(undefined);

      const adapter = await AdapterFactory.createAndInitialize('gitlab', config);

      expect(MockedGitLabAdapter).toHaveBeenCalled();
      expect(mockGitLabAdapter.initialize).toHaveBeenCalledWith(config);
      expect(adapter).toBe(mockGitLabAdapter);
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Initialization failed');
      mockGitLabAdapter.initialize.mockRejectedValue(error);

      await expect(AdapterFactory.createAndInitialize('gitlab', config)).rejects.toThrow(
        'Initialization failed',
      );
    });
  });

  describe('getSupportedProviders', () => {
    it('should return list of supported providers', () => {
      const providers = AdapterFactory.getSupportedProviders();
      expect(providers).toEqual(['gitlab', 'github', 'azure']);
    });
  });

  describe('isSupported', () => {
    it('should return true for supported providers', () => {
      expect(AdapterFactory.isSupported('gitlab')).toBe(true);
      expect(AdapterFactory.isSupported('github')).toBe(true);
      expect(AdapterFactory.isSupported('azure')).toBe(true);
    });

    it('should return false for unsupported providers', () => {
      expect(AdapterFactory.isSupported('unsupported')).toBe(false);
      expect(AdapterFactory.isSupported('')).toBe(false);
    });
  });

  describe('registerAdapter', () => {
    class CustomAdapter implements IProviderAdapter {
      async initialize(): Promise<void> {}
      async validateConnection(): Promise<boolean> {
        return true;
      }
      async getWorkItem(): Promise<any> {
        return {};
      }
      async listWorkItems(): Promise<any[]> {
        return [];
      }
      async createWorkItem(): Promise<any> {
        return {};
      }
      async updateWorkItem(): Promise<any> {
        return {};
      }
      async deleteWorkItem(): Promise<void> {}
      async linkWorkItems(): Promise<void> {}
      async unlinkWorkItems(): Promise<void> {}
      async bulkCreate(): Promise<any[]> {
        return [];
      }
      async bulkUpdate(): Promise<any[]> {
        return [];
      }
      async search(): Promise<any[]> {
        return [];
      }
      async executeQuery(): Promise<any[]> {
        return [];
      }
      async exportWorkItems(): Promise<any[]> {
        return [];
      }
      async importWorkItems(): Promise<any> {
        return { successful: 0, failed: [], mapping: new Map() };
      }
      getCapabilities(): any {
        return {};
      }
    }

    it('should register custom adapter', () => {
      AdapterFactory.registerAdapter('gitlab', CustomAdapter);

      const adapter = AdapterFactory.create('gitlab');
      expect(adapter).toBeInstanceOf(CustomAdapter);
    });
  });
});

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;
  let originalConsoleLog: typeof console.log;
  let mockGitLabAdapter: any;
  let mockGitHubAdapter: any;
  let mockAzureAdapter: any;

  const gitlabConfig: ProviderConfig = {
    id: 'gitlab-test',
    name: 'GitLab Test',
    token: 'gitlab-token',
    apiUrl: 'https://gitlab.com/api/v4',
    group: 'test-group',
  };

  const githubConfig: ProviderConfig = {
    id: 'github-test',
    name: 'GitHub Test',
    token: 'github-token',
    apiUrl: 'https://api.github.com',
    organization: 'test-org',
  };

  const azureConfig: ProviderConfig = {
    id: 'azure-test',
    name: 'Azure Test',
    token: 'azure-token',
    apiUrl: 'https://dev.azure.com/test-org',
    organization: 'test-org',
    project: 'test-project',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    originalConsoleLog = console.log;
    console.log = jest.fn();

    registry = new AdapterRegistry();

    // Reset mock implementations
    mockGitLabAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getProjects: jest.fn(),
      getWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      searchWorkItems: jest.fn(),
      getWorkItemComments: jest.fn(),
      addWorkItemComment: jest.fn(),
      getWorkItemAttachments: jest.fn(),
      addWorkItemAttachment: jest.fn(),
    };
    mockGitLabAdapter.initialize.mockResolvedValue(undefined);
    mockGitLabAdapter.validateConnection.mockResolvedValue(true);

    mockGitHubAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getProjects: jest.fn(),
      getWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      searchWorkItems: jest.fn(),
      getWorkItemComments: jest.fn(),
      addWorkItemComment: jest.fn(),
      getWorkItemAttachments: jest.fn(),
      addWorkItemAttachment: jest.fn(),
    };
    mockGitHubAdapter.initialize.mockResolvedValue(undefined);
    mockGitHubAdapter.validateConnection.mockResolvedValue(true);

    mockAzureAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getProjects: jest.fn(),
      getWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      searchWorkItems: jest.fn(),
      getWorkItemComments: jest.fn(),
      addWorkItemComment: jest.fn(),
      getWorkItemAttachments: jest.fn(),
      addWorkItemAttachment: jest.fn(),
    };
    mockAzureAdapter.initialize.mockResolvedValue(undefined);
    mockAzureAdapter.validateConnection.mockResolvedValue(true);

    MockedGitLabAdapter.mockImplementation(() => mockGitLabAdapter as any);
    MockedGitHubAdapter.mockImplementation(() => mockGitHubAdapter as any);
    MockedAzureAdapter.mockImplementation(() => mockAzureAdapter as any);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('register', () => {
    it('should register GitLab adapter', async () => {
      const adapter = await registry.register('gitlab-key', 'gitlab', gitlabConfig);

      expect(adapter).toBeDefined();
      expect(registry.has('gitlab-key')).toBe(true);
      expect(console.log).toHaveBeenCalledWith(
        '[AdapterRegistry] Registered gitlab adapter with key: gitlab-key',
      );
    });

    it('should register GitHub adapter', async () => {
      const adapter = await registry.register('github-key', 'github', githubConfig);

      expect(adapter).toBeDefined();
      expect(registry.has('github-key')).toBe(true);
    });

    it('should register Azure adapter', async () => {
      const adapter = await registry.register('azure-key', 'azure', azureConfig);

      expect(adapter).toBeDefined();
      expect(registry.has('azure-key')).toBe(true);
    });

    it('should validate configuration before registering', async () => {
      const invalidConfig = { ...gitlabConfig, id: '' };

      await expect(registry.register('invalid-key', 'gitlab', invalidConfig)).rejects.toThrow(
        'Configuration must have an id',
      );
    });

    it('should store configuration copy', async () => {
      const config = { ...gitlabConfig };
      await registry.register('test-key', 'gitlab', config);

      const storedConfig = registry.getConfig('test-key');
      expect(storedConfig).toEqual(config);
      expect(storedConfig).not.toBe(config); // Should be a copy
    });
  });

  describe('get and getRequired', () => {
    beforeEach(async () => {
      await registry.register('test-key', 'gitlab', gitlabConfig);
    });

    it('should get adapter by key', () => {
      const adapter = registry.get('test-key');
      expect(adapter).toBeDefined();
    });

    it('should return undefined for non-existent key', () => {
      const adapter = registry.get('non-existent');
      expect(adapter).toBeUndefined();
    });

    it('should get required adapter', () => {
      const adapter = registry.getRequired('test-key');
      expect(adapter).toBeDefined();
    });

    it('should throw for required non-existent adapter', () => {
      expect(() => registry.getRequired('non-existent')).toThrow('Adapter not found: non-existent');
    });
  });

  describe('getKeys and getAll', () => {
    it('should return empty arrays when no adapters registered', () => {
      expect(registry.getKeys()).toEqual([]);
      expect(registry.getAll().size).toBe(0);
    });

    it('should return adapter keys', async () => {
      await registry.register('gitlab-key', 'gitlab', gitlabConfig);
      await registry.register('github-key', 'github', githubConfig);

      const keys = registry.getKeys();
      expect(keys).toContain('gitlab-key');
      expect(keys).toContain('github-key');
      expect(keys).toHaveLength(2);
    });

    it('should return all adapters', async () => {
      await registry.register('gitlab-key', 'gitlab', gitlabConfig);
      await registry.register('github-key', 'github', githubConfig);

      const all = registry.getAll();
      expect(all.size).toBe(2);
      expect(all.has('gitlab-key')).toBe(true);
      expect(all.has('github-key')).toBe(true);
    });
  });

  describe('getByProvider', () => {
    beforeEach(async () => {
      await registry.register('gitlab-1', 'gitlab', gitlabConfig);
      await registry.register('gitlab-2', 'gitlab', { ...gitlabConfig, id: 'gitlab-2' });
      await registry.register('github-1', 'github', githubConfig);
    });

    it('should return adapters by provider type', () => {
      const gitlabAdapters = registry.getByProvider('gitlab');
      expect(gitlabAdapters.size).toBe(2);
      expect(gitlabAdapters.has('gitlab-1')).toBe(true);
      expect(gitlabAdapters.has('gitlab-2')).toBe(true);

      const githubAdapters = registry.getByProvider('github');
      expect(githubAdapters.size).toBe(1);
      expect(githubAdapters.has('github-1')).toBe(true);
    });

    it('should return empty map for provider with no adapters', () => {
      const azureAdapters = registry.getByProvider('azure');
      expect(azureAdapters.size).toBe(0);
    });
  });

  describe('unregister and clear', () => {
    beforeEach(async () => {
      await registry.register('test-key', 'gitlab', gitlabConfig);
    });

    it('should unregister adapter', () => {
      const removed = registry.unregister('test-key');

      expect(removed).toBe(true);
      expect(registry.has('test-key')).toBe(false);
      expect(console.log).toHaveBeenCalledWith('[AdapterRegistry] Unregistered adapter: test-key');
    });

    it('should return false for non-existent adapter', () => {
      const removed = registry.unregister('non-existent');
      expect(removed).toBe(false);
    });

    it('should clear all adapters', async () => {
      await registry.register('another-key', 'github', githubConfig);

      registry.clear();

      expect(registry.getKeys()).toEqual([]);
      expect(console.log).toHaveBeenCalledWith('[AdapterRegistry] Cleared all adapters');
    });
  });

  describe('updateConfig', () => {
    beforeEach(async () => {
      await registry.register('test-key', 'gitlab', gitlabConfig);
    });

    it('should update adapter configuration', async () => {
      const newConfig = { ...gitlabConfig, name: 'Updated GitLab' };

      const adapter = await registry.updateConfig('test-key', newConfig);

      expect(adapter).toBeDefined();
      expect(registry.getConfig('test-key')?.name).toBe('Updated GitLab');
      expect(console.log).toHaveBeenCalledWith(
        '[AdapterRegistry] Updated configuration for: test-key',
      );
    });

    it('should throw for non-existent adapter', async () => {
      await expect(registry.updateConfig('non-existent', gitlabConfig)).rejects.toThrow(
        'Adapter not found: non-existent',
      );
    });
  });

  describe('testConnections', () => {
    beforeEach(async () => {
      await registry.register('working-adapter', 'gitlab', gitlabConfig);
      await registry.register('failing-adapter', 'github', githubConfig);
    });

    it('should test all adapter connections', async () => {
      // Setup mock validateConnection responses
      mockGitLabAdapter.validateConnection.mockResolvedValue(true);
      mockGitHubAdapter.validateConnection.mockRejectedValue(new Error('Connection failed'));

      const results = await registry.testConnections();

      expect(results.get('working-adapter')).toEqual({ success: true });
      expect(results.get('failing-adapter')).toEqual({
        success: false,
        error: 'Connection failed',
      });
    });
  });

  describe('getStats', () => {
    it('should return empty stats for empty registry', () => {
      const stats = registry.getStats();

      expect(stats).toEqual({
        totalAdapters: 0,
        byProvider: {},
        activeConnections: 0,
      });
    });

    it('should return statistics', async () => {
      await registry.register('gitlab-1', 'gitlab', gitlabConfig);
      await registry.register('gitlab-2', 'gitlab', { ...gitlabConfig, id: 'gitlab-2' });
      await registry.register('github-1', 'github', githubConfig);

      const stats = registry.getStats();

      expect(stats.totalAdapters).toBe(3);
      expect(stats.byProvider).toEqual({
        gitlab: 2,
        github: 1,
      });
      expect(stats.activeConnections).toBe(3);
    });
  });

  describe('createKey and parseKey', () => {
    it('should create key from provider and config', () => {
      const key1 = AdapterRegistry.createKey('gitlab', gitlabConfig);
      expect(key1).toBe('gitlab:test-group');

      const key2 = AdapterRegistry.createKey('github', githubConfig);
      expect(key2).toBe('github:test-org');

      const key3 = AdapterRegistry.createKey('azure', azureConfig);
      expect(key3).toBe('azure:test-org:test-project');
    });

    it('should parse key back to components', () => {
      const parsed1 = AdapterRegistry.parseKey('gitlab:test-group');
      expect(parsed1).toEqual({
        provider: 'gitlab',
        organization: 'test-group',
        project: undefined,
      });

      const parsed2 = AdapterRegistry.parseKey('azure:test-org:test-project');
      expect(parsed2).toEqual({
        provider: 'azure',
        organization: 'test-org',
        project: 'test-project',
      });
    });

    it('should throw for invalid provider in key', () => {
      expect(() => AdapterRegistry.parseKey('invalid:provider')).toThrow(
        'Invalid provider in key: invalid',
      );
    });
  });

  describe('provider detection and validation', () => {
    it('should detect GitLab provider from group config', async () => {
      const config = { ...gitlabConfig, apiUrl: 'https://gitlab.com/api/v4' };
      await registry.register('test-key', 'gitlab', config);

      expect(registry.has('test-key')).toBe(true);
    });

    it('should detect GitHub provider from organization config', async () => {
      const config = { ...githubConfig, apiUrl: 'https://api.github.com' };
      await registry.register('test-key', 'github', config);

      expect(registry.has('test-key')).toBe(true);
    });

    it('should validate missing required fields', async () => {
      // Test common validation failures
      await expect(
        registry.register('invalid', 'gitlab', { ...gitlabConfig, id: '' }),
      ).rejects.toThrow('Configuration must have an id');
      await expect(
        registry.register('invalid', 'gitlab', { ...gitlabConfig, name: '' }),
      ).rejects.toThrow('Configuration must have a name');
      await expect(
        registry.register('invalid', 'gitlab', { ...gitlabConfig, token: '' }),
      ).rejects.toThrow('Configuration must have a token');

      // Test Azure-specific validation failures
      await expect(
        registry.register('invalid', 'azure', { ...azureConfig, organization: '' }),
      ).rejects.toThrow('Azure DevOps configuration must have organization');
      await expect(
        registry.register('invalid', 'azure', { ...azureConfig, project: '' }),
      ).rejects.toThrow('Azure DevOps configuration must have project');
    });
  });
});

describe('globalAdapterRegistry', () => {
  it('should be a singleton AdapterRegistry instance', () => {
    expect(globalAdapterRegistry).toBeInstanceOf(AdapterRegistry);
  });

  it('should maintain state across imports', async () => {
    const originalConsoleLog = console.log;
    console.log = jest.fn();

    try {
      const config: ProviderConfig = {
        id: 'global-test',
        name: 'Global Test',
        token: 'test-token',
        apiUrl: 'https://gitlab.com/api/v4',
        group: 'test-group',
      };

      const mockAdapter = {
        initialize: (jest.fn() as any).mockResolvedValue(undefined),
        validateConnection: (jest.fn() as any).mockResolvedValue(true),
      } as any;

      MockedGitLabAdapter.mockImplementation(() => mockAdapter);

      await globalAdapterRegistry.register('global-key', 'gitlab', config);
      expect(globalAdapterRegistry.has('global-key')).toBe(true);

      // Clean up
      globalAdapterRegistry.unregister('global-key');
    } finally {
      console.log = originalConsoleLog;
    }
  });
});
