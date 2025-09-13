import { jest } from '@jest/globals';
import { EnhancedWorkItemsManager } from '../../abstraction/EnhancedWorkItemsManager.js';
import { ProviderManager } from '../../providers/ProviderManager.js';
import { AdapterFactory } from '../../adapters/AdapterFactory.js';
import { DefaultMigrationPipeline } from '../../adapters/MigrationPipeline.js';
import { IProviderAdapter } from '../../adapters/IProviderAdapter.js';
import * as configValidator from '../../utils/configValidator.js';
import {
  WorkItem,
  CreateWorkItemData,
  UpdateWorkItemData,
  WorkItemFilter,
  ProviderCapabilities,
  MigrationResult,
  User,
} from '../../types/index.js';

// Mock dependencies
jest.mock('../../providers/ProviderManager.js');
jest.mock('../../adapters/AdapterFactory.js');
jest.mock('../../adapters/MigrationPipeline.js');
jest.mock('../../utils/configValidator.js');

const MockedProviderManager = ProviderManager as jest.MockedClass<typeof ProviderManager>;
const MockedDefaultMigrationPipeline = DefaultMigrationPipeline as jest.MockedClass<
  typeof DefaultMigrationPipeline
>;
const mockedValidateProviderConfig = configValidator.validateProviderConfig as jest.MockedFunction<
  typeof configValidator.validateProviderConfig
>;
const mockedLogConfigurationStatus = configValidator.logConfigurationStatus as jest.MockedFunction<
  typeof configValidator.logConfigurationStatus
>;

describe('EnhancedWorkItemsManager', () => {
  let enhancedManager: EnhancedWorkItemsManager;
  let mockProviderManager: jest.Mocked<ProviderManager>;
  let mockAdapter: jest.Mocked<IProviderAdapter>;
  let mockMigrationPipeline: jest.Mocked<DefaultMigrationPipeline>;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalEnv: NodeJS.ProcessEnv;

  const mockUser: User = {
    id: 'user1',
    username: 'testuser',
    displayName: 'Test User',
    provider: 'github',
  };

  const mockAssignee: User = {
    id: 'user2',
    username: 'assignee',
    displayName: 'Assigned User',
    email: 'assignee@example.com',
    provider: 'github',
  };

  const mockReviewer: User = {
    id: 'user3',
    username: 'reviewer',
    displayName: 'Code Reviewer',
    email: 'reviewer@example.com',
    provider: 'github',
  };

  const mockMilestone = {
    id: 'milestone1',
    title: 'v1.0.0 Release',
    description: 'First major release',
    startDate: new Date('2024-01-01'),
    dueDate: new Date('2024-03-01'),
    state: 'open' as const,
    provider: 'github' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = jest.fn();
    console.error = jest.fn();

    // Save original environment
    originalEnv = { ...process.env };

    // Create mock provider manager
    mockProviderManager = {
      getAllProviders: jest.fn(),
      getProvider: jest.fn(),
    } as any;

    // Create mock adapter
    mockAdapter = {
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
      listWorkItems: jest.fn(),
      search: jest.fn(),
      getCapabilities: jest.fn(),
    } as any;

    // Create mock migration pipeline
    mockMigrationPipeline = {
      extract: jest.fn(),
      transform: jest.fn(),
      load: jest.fn(),
    } as any;

    // Mock constructors
    MockedProviderManager.mockImplementation(() => mockProviderManager);
    MockedDefaultMigrationPipeline.mockImplementation(() => mockMigrationPipeline);

    // Mock AdapterFactory static methods
    jest.spyOn(AdapterFactory, 'createAndInitialize').mockResolvedValue(mockAdapter);

    enhancedManager = new EnhancedWorkItemsManager(mockProviderManager);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.env = originalEnv;
  });

  describe('initializeAdapters', () => {
    const mockProviderInstance = {
      id: 'github',
      status: 'connected' as const,
      config: {
        id: 'github',
        name: 'GitHub Provider',
        type: 'stdio' as const,
        enabled: true,
      },
      tools: new Map(),
      resources: new Map(),
      prompts: new Map(),
      lastUpdated: new Date(),
    };

    beforeEach(() => {
      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      process.env.GITHUB_TOKEN = 'test-token';
    });

    it('should initialize adapters successfully', async () => {
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      const result = await enhancedManager.initializeAdapters();

      expect(result.initialized).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(AdapterFactory.createAndInitialize).toHaveBeenCalledWith('github', {
        id: 'github',
        name: 'GitHub Provider',
        apiUrl: 'https://api.github.com',
        token: 'test-token',
        organization: undefined,
        project: undefined,
        group: undefined,
      });
    });

    it('should skip providers with invalid configuration', async () => {
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'missing-token',
        isValid: false,
        reason: 'Missing GITHUB_TOKEN',
      });

      const result = await enhancedManager.initializeAdapters();

      expect(result.initialized).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
      expect(console.log).toHaveBeenCalledWith('⚠️  Skipped github: Missing GITHUB_TOKEN');
    });

    it('should handle adapter initialization failures', async () => {
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      const error = new Error('Initialization failed');
      jest.spyOn(AdapterFactory, 'createAndInitialize').mockRejectedValue(error);

      const result = await enhancedManager.initializeAdapters();

      expect(result.initialized).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(1);
      expect(console.log).toHaveBeenCalledWith(
        '❌ Failed to initialize github adapter: Initialization failed',
      );
    });

    it('should skip disconnected providers', async () => {
      const disconnectedProvider = {
        ...mockProviderInstance,
        status: 'disconnected' as const,
      };
      mockProviderManager.getAllProviders.mockReturnValue([disconnectedProvider]);

      const result = await enhancedManager.initializeAdapters();

      expect(result.initialized).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(AdapterFactory.createAndInitialize).not.toHaveBeenCalled();
    });

    it('should run in silent mode when requested', async () => {
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });

      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('🔧 Initializing Provider Adapters'),
      );
    });

    it('should log configuration status when providers are skipped', async () => {
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'missing-token',
        isValid: false,
        reason: 'Missing token',
      });

      await enhancedManager.initializeAdapters();

      expect(mockedLogConfigurationStatus).toHaveBeenCalledWith([
        {
          provider: 'github',
          status: 'missing-token',
          isValid: false,
          reason: 'Missing token',
        },
      ]);
    });
  });

  describe('getConfigurationStatus', () => {
    it('should return cached configuration results', async () => {
      const mockProviderInstance = {
        id: 'github',
        status: 'connected' as const,
        config: {
          id: 'github',
          name: 'GitHub Provider',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        lastUpdated: new Date(),
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      // Initialize to cache results
      await enhancedManager.initializeAdapters({ silent: true });

      const status = enhancedManager.getConfigurationStatus();

      expect(status.configured).toEqual(['github']);
      expect(status.missing).toEqual([]);
      expect(status.total).toBe(1);
    });

    it('should validate on-demand when no cached results', () => {
      mockedValidateProviderConfig
        .mockReturnValueOnce({
          provider: 'github',
          status: 'configured',
          isValid: true,
        })
        .mockReturnValueOnce({
          provider: 'gitlab',
          status: 'missing-token',
          isValid: false,
          reason: 'Missing GITLAB_TOKEN',
        })
        .mockReturnValueOnce({
          provider: 'azure',
          status: 'missing-token',
          isValid: false,
          reason: 'Missing AZURE_DEVOPS_PAT',
        });

      const status = enhancedManager.getConfigurationStatus();

      expect(status.configured).toEqual(['github']);
      expect(status.missing).toEqual([
        { provider: 'gitlab', reason: 'Missing GITLAB_TOKEN' },
        { provider: 'azure', reason: 'Missing AZURE_DEVOPS_PAT' },
      ]);
      expect(status.total).toBe(3);
    });
  });

  describe('getProviderCapabilities', () => {
    beforeEach(async () => {
      const mockProviderInstance = {
        id: 'github',
        status: 'connected' as const,
        config: {
          id: 'github',
          name: 'GitHub Provider',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        lastUpdated: new Date(),
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should return capabilities for all adapters', () => {
      const mockCapabilities: ProviderCapabilities = {
        supportsEpics: true,
        supportsIterations: false,
        supportsMilestones: true,
        supportsMultipleAssignees: false,
        supportsConfidential: false,
        supportsWeight: false,
        supportsTimeTracking: false,
        supportsCustomFields: false,
        maxAssignees: 1,
        hierarchyLevels: 2,
        customWorkItemTypes: ['issue', 'task'],
      };

      mockAdapter.getCapabilities.mockReturnValue(mockCapabilities);

      const capabilities = enhancedManager.getProviderCapabilities();

      expect(capabilities.get('github')).toEqual(mockCapabilities);
    });

    it('should handle capability retrieval errors', () => {
      mockAdapter.getCapabilities.mockImplementation(() => {
        throw new Error('Capabilities error');
      });

      const capabilities = enhancedManager.getProviderCapabilities();

      expect(capabilities.size).toBe(0);
      expect(console.error).toHaveBeenCalledWith(
        'Failed to get capabilities for github:',
        expect.any(Error),
      );
    });
  });

  describe('createWorkItemEnhanced', () => {
    const mockWorkItem: WorkItem = {
      id: 'github:owner/repo#123',
      title: 'Test Issue',
      description: 'Test description with detailed requirements',
      state: 'open',
      type: 'issue',
      provider: 'github',

      // People - comprehensive user assignment
      author: mockUser,
      assignees: [mockAssignee],
      reviewers: [mockReviewer],
      mentions: [mockUser, mockReviewer],

      // Organization
      labels: ['bug', 'high-priority', 'backend'],
      milestone: mockMilestone,
      priority: 'high',

      // Timestamps - realistic dates
      createdAt: new Date('2024-01-10T10:00:00Z'),
      updatedAt: new Date('2024-01-12T15:30:00Z'),
      dueDate: new Date('2024-01-20T23:59:59Z'),

      // Relationships - test parent/child relationships
      parent: undefined, // This is a root item
      children: [], // Will be populated in relationship tests
      blockedBy: [],
      blocks: [],
      relatedTo: [],

      // Provider-specific fields - GitHub specific
      providerFields: {
        number: 123,
        repository: 'owner/repo',
        stateReason: undefined,
        reactions: { '+1': 5, '-1': 0, laugh: 2, hooray: 1, confused: 0, heart: 3 },
        isDraft: false,
        projectItems: [
          {
            projectId: 'proj_123',
            itemId: 'item_456',
            fieldValues: { status: 'In Progress', effort: 5 },
          },
        ],
      },
    };

    const createData: CreateWorkItemData = {
      title: 'Test Issue',
      description: 'Test description with detailed requirements',
      type: 'issue',
      assignees: [mockAssignee],
      labels: ['bug', 'high-priority'],
      priority: 'high',
      milestone: mockMilestone,
      dueDate: new Date('2024-01-20T23:59:59Z'),
      confidential: false,
      customFields: {
        estimatedHours: 8,
        complexity: 'medium',
        team: 'backend',
      },
    };

    beforeEach(async () => {
      const mockProviderInstance = {
        id: 'github',
        status: 'connected' as const,
        config: {
          id: 'github',
          name: 'GitHub Provider',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        lastUpdated: new Date(),
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should create work item using adapter', async () => {
      mockAdapter.createWorkItem.mockResolvedValue(mockWorkItem);

      // Mock the parent class method
      jest.spyOn(enhancedManager as any, 'detectProviderFromProject').mockReturnValue('github');

      const result = await enhancedManager.createWorkItemEnhanced('test/repo', createData);

      expect(mockAdapter.createWorkItem).toHaveBeenCalledWith(createData);
      expect(result).toEqual(mockWorkItem);
    });

    it('should fallback to legacy system on adapter failure', async () => {
      mockAdapter.createWorkItem.mockRejectedValue(new Error('Adapter error'));

      // Mock the parent class method
      jest.spyOn(enhancedManager as any, 'detectProviderFromProject').mockReturnValue('github');
      jest.spyOn(enhancedManager, 'createWorkItem').mockResolvedValue(mockWorkItem);

      const result = await enhancedManager.createWorkItemEnhanced('test/repo', createData);

      expect(console.error).toHaveBeenCalledWith(
        'Adapter creation failed, falling back to legacy: Adapter error',
      );
      expect(enhancedManager.createWorkItem).toHaveBeenCalledWith('test/repo', {
        title: createData.title,
        description: createData.description,
        type: createData.type,
        labels: createData.labels,
        priority: createData.priority,
      });
      expect(result).toEqual(mockWorkItem);
    });

    it('should use legacy system when no adapter available', async () => {
      jest
        .spyOn(enhancedManager as any, 'detectProviderFromProject')
        .mockReturnValue('unsupported');
      jest.spyOn(enhancedManager, 'createWorkItem').mockResolvedValue(mockWorkItem);

      const result = await enhancedManager.createWorkItemEnhanced('test/repo', createData);

      expect(enhancedManager.createWorkItem).toHaveBeenCalled();
      expect(result).toEqual(mockWorkItem);
    });
  });

  describe('updateWorkItemEnhanced', () => {
    const mockWorkItem: WorkItem = {
      id: 'github:owner/repo#123',
      title: 'Updated Issue',
      description: 'Updated description with resolution details',
      state: 'closed',
      type: 'issue',
      provider: 'github',

      // People - updated assignees
      author: mockUser,
      assignees: [mockAssignee],
      reviewers: [mockReviewer],
      mentions: [mockUser],

      // Organization - updated labels and priority
      labels: ['bug', 'resolved', 'backend'],
      milestone: mockMilestone,
      priority: 'medium', // Reduced after fix

      // Timestamps - shows progression
      createdAt: new Date('2024-01-10T10:00:00Z'),
      updatedAt: new Date('2024-01-15T16:45:00Z'), // Later update
      closedAt: new Date('2024-01-15T16:45:00Z'),
      dueDate: new Date('2024-01-20T23:59:59Z'),

      // Relationships
      parent: undefined,
      children: [],
      blockedBy: [],
      blocks: [],
      relatedTo: [],

      // Provider-specific fields - GitHub with closure info
      providerFields: {
        number: 123,
        repository: 'owner/repo',
        stateReason: 'completed',
        reactions: { '+1': 8, '-1': 0, laugh: 1, hooray: 3, confused: 0, heart: 5 },
        isDraft: false,
        projectItems: [
          {
            projectId: 'proj_123',
            itemId: 'item_456',
            fieldValues: { status: 'Done', effort: 8 },
          },
        ],
      },
    };

    const updateData: UpdateWorkItemData = {
      title: 'Updated Issue',
      description: 'Updated description with resolution details',
      state: 'closed',
      assignees: [mockAssignee],
      labels: ['bug', 'resolved', 'backend'],
      priority: 'medium',
      milestone: mockMilestone,
    };

    beforeEach(async () => {
      const mockProviderInstance = {
        id: 'github',
        status: 'connected' as const,
        config: {
          id: 'github',
          name: 'GitHub Provider',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        lastUpdated: new Date(),
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should update work item using adapter', async () => {
      mockAdapter.updateWorkItem.mockResolvedValue(mockWorkItem);

      const result = await enhancedManager.updateWorkItemEnhanced('github:123', updateData);

      expect(mockAdapter.updateWorkItem).toHaveBeenCalledWith('github:123', updateData);
      expect(result).toEqual(mockWorkItem);
    });

    it('should fallback to legacy system on adapter failure', async () => {
      mockAdapter.updateWorkItem.mockRejectedValue(new Error('Update error'));
      jest.spyOn(enhancedManager, 'updateWorkItem').mockResolvedValue(mockWorkItem);

      const result = await enhancedManager.updateWorkItemEnhanced('github:123', updateData);

      expect(console.error).toHaveBeenCalledWith(
        'Adapter update failed, falling back to legacy: Update error',
      );
      expect(enhancedManager.updateWorkItem).toHaveBeenCalledWith('github:123', {
        title: updateData.title,
        description: updateData.description,
        state: updateData.state,
        labels: updateData.labels,
        priority: updateData.priority,
      });
      expect(result).toEqual(mockWorkItem);
    });
  });

  describe('listWorkItemsEnhanced', () => {
    const mockWorkItems: WorkItem[] = [
      {
        id: 'github:owner/repo#123',
        title: 'Test Issue 1',
        description: 'Description for first test issue',
        state: 'open',
        type: 'issue',
        provider: 'github',

        // People
        author: mockUser,
        assignees: [mockAssignee],
        reviewers: [],
        mentions: [],

        // Organization
        labels: ['feature', 'frontend'],
        milestone: mockMilestone,
        priority: 'medium',

        // Timestamps
        createdAt: new Date('2024-01-11T09:00:00Z'),
        updatedAt: new Date('2024-01-11T14:30:00Z'),
        dueDate: new Date('2024-01-25T23:59:59Z'),

        // Relationships
        parent: undefined,
        children: [],
        blockedBy: [],
        blocks: [],
        relatedTo: [],

        // Provider-specific fields
        providerFields: {
          number: 123,
          repository: 'owner/repo',
          stateReason: undefined,
          reactions: { '+1': 2, '-1': 0, laugh: 0, hooray: 1, confused: 0, heart: 1 },
          isDraft: false,
          projectItems: [],
        },
      },
      {
        id: 'github:owner/repo#124',
        title: 'Test Issue 2',
        description: 'Description for second test issue',
        state: 'closed',
        type: 'bug',
        provider: 'github',

        // People
        author: mockAssignee,
        assignees: [mockUser],
        reviewers: [mockReviewer],
        mentions: [mockUser],

        // Organization
        labels: ['bug', 'critical', 'security'],
        milestone: mockMilestone,
        priority: 'critical',

        // Timestamps
        createdAt: new Date('2024-01-05T08:00:00Z'),
        updatedAt: new Date('2024-01-08T17:15:00Z'),
        closedAt: new Date('2024-01-08T17:15:00Z'),
        dueDate: new Date('2024-01-07T23:59:59Z'), // Past due initially

        // Relationships
        parent: undefined,
        children: [],
        blockedBy: [],
        blocks: [],
        relatedTo: [],

        // Provider-specific fields
        providerFields: {
          number: 124,
          repository: 'owner/repo',
          stateReason: 'completed',
          reactions: { '+1': 10, '-1': 1, laugh: 0, hooray: 5, confused: 0, heart: 8 },
          isDraft: false,
          projectItems: [
            {
              projectId: 'proj_123',
              itemId: 'item_789',
              fieldValues: { status: 'Done', effort: 13, severity: 'Critical' },
            },
          ],
        },
      },
    ];

    beforeEach(async () => {
      const mockProviderInstance = {
        id: 'github',
        status: 'connected' as const,
        config: {
          id: 'github',
          name: 'GitHub Provider',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        lastUpdated: new Date(),
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should list work items using adapter with filter', async () => {
      const filter: WorkItemFilter = { state: 'open', assignee: 'user1' };
      mockAdapter.listWorkItems.mockResolvedValue(mockWorkItems);
      jest.spyOn(enhancedManager as any, 'detectProviderFromProject').mockReturnValue('github');

      const result = await enhancedManager.listWorkItemsEnhanced('test/repo', filter);

      expect(mockAdapter.listWorkItems).toHaveBeenCalledWith(filter);
      expect(result).toEqual(mockWorkItems);
    });

    it('should fallback to legacy system when adapter fails', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      mockAdapter.listWorkItems.mockRejectedValue(new Error('List error'));
      jest.spyOn(enhancedManager as any, 'detectProviderFromProject').mockReturnValue('github');
      jest.spyOn(enhancedManager, 'listWorkItems').mockResolvedValue(mockWorkItems);

      const result = await enhancedManager.listWorkItemsEnhanced('test/repo', filter);

      expect(console.error).toHaveBeenCalledWith(
        'Adapter listing failed, falling back to legacy: List error',
      );
      expect(enhancedManager.listWorkItems).toHaveBeenCalledWith('test/repo', { status: 'open' });
      expect(result).toEqual(mockWorkItems);
    });

    it('should use legacy system when no project specified', async () => {
      jest.spyOn(enhancedManager, 'listWorkItems').mockResolvedValue(mockWorkItems);

      const result = await enhancedManager.listWorkItemsEnhanced();

      expect(enhancedManager.listWorkItems).toHaveBeenCalledWith(undefined, {});
      expect(result).toEqual(mockWorkItems);
    });
  });

  describe('searchWorkItems', () => {
    beforeEach(async () => {
      const mockProviderInstances = [
        {
          id: 'github',
          status: 'connected' as const,
          config: {
            id: 'github',
            name: 'GitHub',
            type: 'stdio' as const,
            enabled: true,
          },
          tools: new Map(),
          resources: new Map(),
          prompts: new Map(),
          lastUpdated: new Date(),
        },
        {
          id: 'gitlab',
          status: 'connected' as const,
          config: {
            id: 'gitlab',
            name: 'GitLab',
            type: 'stdio' as const,
            enabled: true,
          },
          tools: new Map(),
          resources: new Map(),
          prompts: new Map(),
          lastUpdated: new Date(),
        },
      ];

      mockProviderManager.getAllProviders.mockReturnValue(mockProviderInstances);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should search across all adapters', async () => {
      const mockResults1 = [{ id: 'github:1', title: 'Result 1' }];
      const mockResults2 = [{ id: 'gitlab:1', title: 'Result 2' }];

      mockAdapter.search
        .mockResolvedValueOnce(mockResults1 as any)
        .mockResolvedValueOnce(mockResults2 as any);

      const result = await enhancedManager.searchWorkItems('test query');

      expect(result).toEqual([...mockResults1, ...mockResults2]);
    });

    it('should handle search errors gracefully', async () => {
      mockAdapter.search
        .mockRejectedValueOnce(new Error('Search failed'))
        .mockResolvedValueOnce([{ id: 'gitlab:1', title: 'Success' }] as any);

      const result = await enhancedManager.searchWorkItems('test query');

      expect(result).toEqual([{ id: 'gitlab:1', title: 'Success' }]);
      expect(console.error).toHaveBeenCalledWith('Search failed for github: Search failed');
    });
  });

  describe('migrateWorkItems', () => {
    beforeEach(async () => {
      const mockProviderInstances = [
        {
          id: 'github',
          status: 'connected' as const,
          config: {
            id: 'github',
            name: 'GitHub',
            type: 'stdio' as const,
            enabled: true,
          },
          tools: new Map(),
          resources: new Map(),
          prompts: new Map(),
          lastUpdated: new Date(),
        },
        {
          id: 'gitlab',
          status: 'connected' as const,
          config: {
            id: 'gitlab',
            name: 'GitLab',
            type: 'stdio' as const,
            enabled: true,
          },
          tools: new Map(),
          resources: new Map(),
          prompts: new Map(),
          lastUpdated: new Date(),
        },
      ];

      mockProviderManager.getAllProviders.mockReturnValue(mockProviderInstances);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should migrate work items between providers', async () => {
      jest
        .spyOn(enhancedManager as any, 'detectProviderFromProject')
        .mockReturnValueOnce('github')
        .mockReturnValueOnce('gitlab');

      const mockExported = [{ id: 'github:1', title: 'Item 1' }];
      const mockTransformed = {
        items: [{ id: 'gitlab:1', title: 'Item 1' }],
        errors: [],
      };
      const mockMigrationResult: MigrationResult = {
        successful: 1,
        failed: [],
        mapping: new Map([['github:1', 'gitlab:1']]),
      };

      mockMigrationPipeline.extract.mockResolvedValue(mockExported as any);
      mockMigrationPipeline.transform.mockResolvedValue(mockTransformed as any);
      mockMigrationPipeline.load.mockResolvedValue(mockMigrationResult);

      const result = await enhancedManager.migrateWorkItems('github/repo', 'gitlab/project', [
        'github:1',
      ]);

      expect(mockMigrationPipeline.extract).toHaveBeenCalledWith(mockAdapter, {});
      expect(mockMigrationPipeline.transform).toHaveBeenCalledWith(
        mockExported,
        'gitlab',
        expect.objectContaining({
          preserveIds: true,
          mapUsers: expect.any(Map),
        }),
      );
      expect(mockMigrationPipeline.load).toHaveBeenCalledWith(
        mockAdapter,
        mockTransformed.items,
        expect.objectContaining({
          batchSize: 10,
          continueOnError: true,
          dryRun: false,
        }),
      );
      expect(result).toEqual(mockMigrationResult);
    });

    it('should handle dry run migration', async () => {
      jest
        .spyOn(enhancedManager as any, 'detectProviderFromProject')
        .mockReturnValueOnce('github')
        .mockReturnValueOnce('gitlab');

      const mockExported = [{ id: 'github:1', title: 'Item 1' }];
      const mockTransformed = {
        items: [{ id: 'gitlab:1', title: 'Item 1' }],
        errors: ['Warning: Field mapping'],
      };

      mockMigrationPipeline.extract.mockResolvedValue(mockExported as any);
      mockMigrationPipeline.transform.mockResolvedValue(mockTransformed as any);

      const result = await enhancedManager.migrateWorkItems(
        'github/repo',
        'gitlab/project',
        ['github:1'],
        { dryRun: true },
      );

      expect(result.successful).toBe(1);
      expect(result.failed).toEqual([{ id: 'dry-run', reason: 'Warning: Field mapping' }]);
      expect(mockMigrationPipeline.load).not.toHaveBeenCalled();
    });

    it('should throw error when adapters are missing', async () => {
      jest
        .spyOn(enhancedManager as any, 'detectProviderFromProject')
        .mockReturnValue('unsupported');

      await expect(
        enhancedManager.migrateWorkItems('unsupported/repo', 'gitlab/project', []),
      ).rejects.toThrow(
        'Migration requires both source (unsupported) and target (unsupported) adapters',
      );
    });
  });

  describe('exportWorkItems', () => {
    beforeEach(async () => {
      const mockProviderInstance = {
        id: 'github',
        status: 'connected' as const,
        config: {
          id: 'github',
          name: 'GitHub Provider',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        lastUpdated: new Date(),
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should export work items using migration pipeline', async () => {
      const mockExported = [{ id: 'github:1', title: 'Item 1' }];
      const filter: WorkItemFilter = { state: 'open' };

      jest.spyOn(enhancedManager as any, 'detectProviderFromProject').mockReturnValue('github');
      mockMigrationPipeline.extract.mockResolvedValue(mockExported as any);

      const result = await enhancedManager.exportWorkItems('github/repo', filter);

      expect(mockMigrationPipeline.extract).toHaveBeenCalledWith(mockAdapter, filter);
      expect(result).toEqual(mockExported);
    });

    it('should throw error when adapter is missing', async () => {
      jest
        .spyOn(enhancedManager as any, 'detectProviderFromProject')
        .mockReturnValue('unsupported');

      await expect(enhancedManager.exportWorkItems('unsupported/repo')).rejects.toThrow(
        'Export requires adapter for provider: unsupported',
      );
    });
  });

  describe('provider configuration helpers', () => {
    it('should get correct base URLs for providers', () => {
      const manager = enhancedManager as any;

      expect(manager.getProviderBaseUrl('github')).toBe('https://api.github.com');
      expect(manager.getProviderBaseUrl('gitlab')).toBe('https://gitlab.com/api/v4');
      expect(manager.getProviderBaseUrl('azure')).toBe('https://dev.azure.com');
      expect(manager.getProviderBaseUrl('unknown')).toBe('');
    });

    it('should use custom GitLab URL from environment', () => {
      process.env.GITLAB_URL = 'https://custom-gitlab.com/api/v4';
      const manager = enhancedManager as any;

      expect(manager.getProviderBaseUrl('gitlab')).toBe('https://custom-gitlab.com/api/v4');
    });

    it('should get provider tokens from environment', () => {
      process.env.GITHUB_TOKEN = 'github-token';
      process.env.GITLAB_TOKEN = 'gitlab-token';
      process.env.AZURE_DEVOPS_PAT = 'azure-token';

      const manager = enhancedManager as any;

      expect(manager.getProviderToken('github')).toBe('github-token');
      expect(manager.getProviderToken('gitlab')).toBe('gitlab-token');
      expect(manager.getProviderToken('azure')).toBe('azure-token');
      expect(manager.getProviderToken('unknown')).toBe('test_token');
    });

    it('should get provider organization from environment', () => {
      process.env.GITHUB_ORG = 'github-org';
      process.env.AZURE_ORG = 'azure-org';

      const manager = enhancedManager as any;

      expect(manager.getProviderOrganization('github')).toBe('github-org');
      expect(manager.getProviderOrganization('azure')).toBe('azure-org');
      expect(manager.getProviderOrganization('gitlab')).toBeUndefined();
    });

    it('should get provider project from environment', () => {
      process.env.AZURE_PROJECT = 'azure-project';

      const manager = enhancedManager as any;

      expect(manager.getProviderProject('azure')).toBe('azure-project');
      expect(manager.getProviderProject('github')).toBeUndefined();
    });

    it('should get provider group from environment', () => {
      process.env.GITLAB_GROUP = 'gitlab-group';

      const manager = enhancedManager as any;

      expect(manager.getProviderGroup('gitlab')).toBe('gitlab-group');
      expect(manager.getProviderGroup('github')).toBeUndefined();
    });
  });

  describe('getAdapterForProvider', () => {
    beforeEach(async () => {
      const mockProviderInstance = {
        id: 'github',
        status: 'connected' as const,
        config: {
          id: 'github',
          name: 'GitHub Provider',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        lastUpdated: new Date(),
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockedValidateProviderConfig.mockReturnValue({
        provider: 'github',
        status: 'configured',
        isValid: true,
      });

      await enhancedManager.initializeAdapters({ silent: true });
    });

    it('should find adapter by exact match', () => {
      const manager = enhancedManager as any;
      const adapter = manager.getAdapterForProvider('github');

      expect(adapter).toBe(mockAdapter);
    });

    it('should find adapter by provider prefix', () => {
      const manager = enhancedManager as any;
      // Manually set an adapter with composite key
      manager.adapters.set('github:org/repo', mockAdapter);

      const adapter = manager.getAdapterForProvider('github');

      expect(adapter).toBe(mockAdapter);
    });

    it('should return null for unknown provider', () => {
      const manager = enhancedManager as any;
      const adapter = manager.getAdapterForProvider('unknown');

      expect(adapter).toBeNull();
    });
  });
});
