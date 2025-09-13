import {
  HierarchyLevel,
  ProviderConfig,
  ProjectMapping,
  NexusConfig,
  ProviderInstance,
} from '../../types/index';

describe('types', () => {
  describe('HierarchyLevel enum', () => {
    it('should have correct numeric values', () => {
      expect(HierarchyLevel.Portfolio).toBe(0);
      expect(HierarchyLevel.Feature).toBe(1);
      expect(HierarchyLevel.Requirement).toBe(2);
      expect(HierarchyLevel.Task).toBe(3);
    });

    it('should allow comparison operations', () => {
      expect(HierarchyLevel.Portfolio < HierarchyLevel.Feature).toBe(true);
      expect(HierarchyLevel.Feature < HierarchyLevel.Requirement).toBe(true);
      expect(HierarchyLevel.Requirement < HierarchyLevel.Task).toBe(true);
    });
  });

  describe('ProviderConfig interface', () => {
    it('should accept valid STDIO provider config', () => {
      const config: ProviderConfig = {
        id: 'github',
        name: 'GitHub Provider',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        enabled: true,
        version: '1.0.0',
        autoUpdate: true,
      };

      expect(config.id).toBe('github');
      expect(config.type).toBe('stdio');
      expect(config.enabled).toBe(true);
    });

    it('should accept valid HTTP provider config', () => {
      const config: ProviderConfig = {
        id: 'custom-api',
        name: 'Custom API Provider',
        type: 'http',
        url: 'https://api.example.com',
        headers: { Authorization: 'Bearer token' },
        enabled: true,
      };

      expect(config.type).toBe('http');
      expect(config.url).toBe('https://api.example.com');
      expect(config.headers).toEqual({ Authorization: 'Bearer token' });
    });

    it('should accept valid SSE provider config', () => {
      const config: ProviderConfig = {
        id: 'stream-api',
        name: 'Streaming API Provider',
        type: 'sse',
        url: 'https://stream.example.com',
        env: { API_KEY: 'secret' },
        enabled: false,
      };

      expect(config.type).toBe('sse');
      expect(config.env).toEqual({ API_KEY: 'secret' });
      expect(config.enabled).toBe(false);
    });
  });

  describe('ProjectMapping interface', () => {
    it('should map paths to project identifiers', () => {
      const mapping: ProjectMapping = {
        '/home/user/project1': 'gitlab:mygroup/project1',
        '/home/user/project2': 'github:myorg/project2',
        '/workspace/azure-proj': 'azure:MyOrg/MyProject',
      };

      expect(mapping['/home/user/project1']).toBe('gitlab:mygroup/project1');
      expect(mapping['/home/user/project2']).toBe('github:myorg/project2');
      expect(mapping['/workspace/azure-proj']).toBe('azure:MyOrg/MyProject');
    });

    it('should allow empty mapping', () => {
      const mapping: ProjectMapping = {};
      expect(Object.keys(mapping)).toHaveLength(0);
    });
  });

  describe('NexusConfig interface', () => {
    it('should accept complete configuration', () => {
      const config: NexusConfig = {
        providers: [
          {
            id: 'github',
            name: 'GitHub',
            type: 'stdio',
            command: 'npx',
            args: ['@modelcontextprotocol/server-github'],
            enabled: true,
          },
        ],
        projects: {
          '/workspace/myproject': 'github:myorg/myproject',
        },
        defaultRepository: 'github:myorg/myproject',
        defaultTask: 'github:myorg/myproject#1',
      };

      expect(config.providers).toHaveLength(1);
      expect(config.providers[0].id).toBe('github');
      expect(config.defaultRepository).toBe('github:myorg/myproject');
      expect(config.defaultTask).toBe('github:myorg/myproject#1');
    });

    it('should accept minimal configuration', () => {
      const config: NexusConfig = {
        providers: [],
        projects: {},
      };

      expect(config.providers).toHaveLength(0);
      expect(config.projects).toEqual({});
      expect(config.defaultRepository).toBeUndefined();
      expect(config.defaultTask).toBeUndefined();
    });
  });

  describe('ProviderInstance interface', () => {
    it('should accept provider instance with all status values', () => {
      const statuses: ProviderInstance['status'][] = [
        'starting',
        'connected',
        'disconnected',
        'error',
        'auth_failed',
      ];

      statuses.forEach((status) => {
        const instance: ProviderInstance = {
          id: 'test-provider',
          config: {
            id: 'test',
            name: 'Test Provider',
            type: 'stdio',
            enabled: true,
          },
          tools: new Map(),
          resources: new Map(),
          prompts: new Map(),
          status,
        };

        expect(instance.status).toBe(status);
      });
    });

    it('should accept provider instance with error details', () => {
      const instance: ProviderInstance = {
        id: 'failed-provider',
        config: {
          id: 'failed',
          name: 'Failed Provider',
          type: 'stdio',
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        status: 'error',
        error: 'Connection failed',
        errorType: 'network',
        shouldReconnect: true,
        reconnectAttempts: 2,
        lastReconnectTime: new Date('2025-01-01T12:00:00Z'),
        lastUpdated: new Date('2025-01-01T12:05:00Z'),
      };

      expect(instance.error).toBe('Connection failed');
      expect(instance.errorType).toBe('network');
      expect(instance.shouldReconnect).toBe(true);
      expect(instance.reconnectAttempts).toBe(2);
    });
  });

  describe('type exports and enums', () => {
    it('should export HierarchyLevel enum', () => {
      expect(typeof HierarchyLevel).toBe('object');
      expect(typeof HierarchyLevel.Portfolio).toBe('number');
    });

    it('should test type assignments work correctly', () => {
      // These are compile-time tests that ensure types are properly exported
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test',
        type: 'stdio',
        enabled: true,
      };

      const mapping: ProjectMapping = {
        '/test': 'test:path',
      };

      expect(config.id).toBe('test');
      expect(mapping['/test']).toBe('test:path');
    });
  });
});
