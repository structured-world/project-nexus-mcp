import {
  DefaultMigrationPipeline,
  MigrationOrchestrator,
} from '../../adapters/MigrationPipeline.js';
import {
  IProviderAdapter,
  TransformOptions,
  LoadOptions,
  TransformResult,
  VerificationReport,
} from '../../adapters/IProviderAdapter.js';
import {
  WorkItem,
  WorkItemExport,
  WorkItemImport,
  WorkItemFilter,
  MigrationResult,
  User,
} from '../../types/index.js';

describe('DefaultMigrationPipeline', () => {
  let pipeline: DefaultMigrationPipeline;
  let mockSourceAdapter: jest.Mocked<IProviderAdapter>;
  let mockTargetAdapter: jest.Mocked<IProviderAdapter>;

  const mockWorkItem: WorkItem = {
    id: 'test-1',
    title: 'Test Work Item',
    description: 'Test description',
    type: 'story',
    state: 'open',
    assignees: [],
    labels: ['test'],
    priority: 'medium',
    provider: 'gitlab',
    author: {
      id: 'user-1',
      username: 'testuser',
      displayName: 'Test User',
      email: 'test@example.com',
      provider: 'gitlab',
    },
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-02'),
    providerFields: { iid: 1, projectId: 123 },
  };

  const mockWorkItemExport: WorkItemExport = {
    id: 'test-1',
    provider: 'gitlab',
    type: 'story',
    title: 'Test Work Item',
    description: 'Test description',
    state: 'open',
    assignees: [],
    labels: ['test'],
    priority: 'medium',
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-02'),
    providerFields: { iid: 1, projectId: 123, weight: 5, confidential: false },
    relationships: {
      parent: undefined,
      children: [],
      blocks: [],
      blockedBy: [],
      relatedTo: [],
    },
  };

  beforeEach(() => {
    pipeline = new DefaultMigrationPipeline();

    mockSourceAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getWorkItem: jest.fn(),
      listWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      linkWorkItems: jest.fn(),
      unlinkWorkItems: jest.fn(),
      bulkCreate: jest.fn(),
      bulkUpdate: jest.fn(),
      search: jest.fn(),
      executeQuery: jest.fn(),
      exportWorkItems: jest.fn(),
      importWorkItems: jest.fn(),
      getCapabilities: jest.fn(),
    } as jest.Mocked<IProviderAdapter>;

    mockTargetAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getWorkItem: jest.fn(),
      listWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      linkWorkItems: jest.fn(),
      unlinkWorkItems: jest.fn(),
      bulkCreate: jest.fn(),
      bulkUpdate: jest.fn(),
      search: jest.fn(),
      executeQuery: jest.fn(),
      exportWorkItems: jest.fn(),
      importWorkItems: jest.fn(),
      getCapabilities: jest.fn(),
    } as jest.Mocked<IProviderAdapter>;
  });

  describe('extract', () => {
    it('should extract work items from source provider', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      const workItems = [mockWorkItem];
      const exports = [mockWorkItemExport];

      mockSourceAdapter.listWorkItems.mockResolvedValue(workItems);
      mockSourceAdapter.exportWorkItems.mockResolvedValue(exports);

      const result = await pipeline.extract(mockSourceAdapter, filter);

      expect(mockSourceAdapter.listWorkItems).toHaveBeenCalledWith(filter);
      expect(mockSourceAdapter.exportWorkItems).toHaveBeenCalledWith(['test-1']);
      expect(result).toEqual(exports);
    });

    it('should handle extraction errors', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      mockSourceAdapter.listWorkItems.mockRejectedValue(new Error('API Error'));

      await expect(pipeline.extract(mockSourceAdapter, filter)).rejects.toThrow(
        'Extraction failed: API Error',
      );
    });

    it('should handle empty extraction results', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      mockSourceAdapter.listWorkItems.mockResolvedValue([]);
      mockSourceAdapter.exportWorkItems.mockResolvedValue([]);

      const result = await pipeline.extract(mockSourceAdapter, filter);

      expect(result).toEqual([]);
      expect(mockSourceAdapter.exportWorkItems).toHaveBeenCalledWith([]);
    });
  });

  describe('transform', () => {
    it('should transform GitLab work items for Azure target', async () => {
      const items = [mockWorkItemExport];
      const options: TransformOptions = {
        mapUsers: new Map([['testuser', 'azure-user']]),
        mapLabels: new Map([['test', 'azure-test']]),
        customFieldMapping: { weight: 'storyPoints' },
        handleMissingFields: 'ignore',
        preserveIds: true,
      };

      const result = await pipeline.transform(items, 'azure', options);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Test Work Item');
      expect(result.items[0].type).toBe('story'); // Normalized from User Story
      expect(result.items[0].description).toContain('Migrated from gitlab:test-1');
      expect(result.errors).toHaveLength(0);
    });

    it('should transform GitHub work items with label detection', async () => {
      const githubExport: WorkItemExport = {
        ...mockWorkItemExport,
        provider: 'github',
        labels: ['enhancement', 'priority-high'],
        relationships: {
          parent: undefined,
          children: ['child-1', 'child-2', 'child-3'],
          blocks: [],
          blockedBy: [],
          relatedTo: [],
        },
      };

      const options: TransformOptions = {
        mapUsers: new Map(),
        mapLabels: new Map(),
        customFieldMapping: {},
        handleMissingFields: 'ignore',
        preserveIds: false,
      };

      const result = await pipeline.transform([githubExport], 'azure', options);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe('feature'); // Enhancement with 3+ children → Feature
      expect(result.warnings.some((w) => w.includes('Enhancement with 3 children'))).toBe(true);
    });

    it('should handle transformation errors gracefully', async () => {
      const malformedExport = {
        ...mockWorkItemExport,
        title: null, // This should cause transformation issues
      } as unknown as WorkItemExport;

      const options: TransformOptions = {
        mapUsers: new Map(),
        mapLabels: new Map(),
        customFieldMapping: {},
        handleMissingFields: 'ignore',
        preserveIds: false,
      };

      const result = await pipeline.transform([malformedExport], 'azure', options);

      expect(result.items).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to transform item');
    });

    it('should preserve custom field mappings', async () => {
      const gitlabExport: WorkItemExport = {
        ...mockWorkItemExport,
        providerFields: {
          iid: 123,
          projectId: 456,
          weight: 8,
          timeEstimate: 3600,
        },
      };

      const options: TransformOptions = {
        mapUsers: new Map(),
        mapLabels: new Map(),
        customFieldMapping: {
          weight: 'storyPoints',
        },
        handleMissingFields: 'metadata',
        preserveIds: false,
      };

      const result = await pipeline.transform([gitlabExport], 'azure', options);

      expect(result.items[0].customFields).toHaveProperty('storyPoints', 8);
      expect(result.items[0].customFields).toHaveProperty('targetCustomField', 'test-value');
      expect(result.items[0].customFields).toHaveProperty('timeEstimate', 3600);
    });

    it('should handle missing fields according to strategy', async () => {
      const gitlabExport: WorkItemExport = {
        ...mockWorkItemExport,
        providerFields: {
          iid: 123,
          projectId: 456,
          confidential: true,
          weight: 5,
        },
      };

      const options: TransformOptions = {
        mapUsers: new Map(),
        mapLabels: new Map(),
        customFieldMapping: {},
        handleMissingFields: 'metadata',
        preserveIds: false,
      };

      const result = await pipeline.transform([gitlabExport], 'github', options);

      expect(result.items[0].customFields).toHaveProperty('migrationMetadata');
      const metadata = result.items[0].customFields.migrationMetadata as any;
      expect(metadata.lostFields).toContain('confidential');
      expect(metadata.sourceProvider).toBe('gitlab');
    });
  });

  describe('load', () => {
    it('should load work items in batches', async () => {
      const items: WorkItemImport[] = [
        {
          title: 'Item 1',
          description: 'Description 1',
          type: 'story',
          state: 'open',
          labels: [],
          assignees: [],
          priority: 'medium',
          customFields: {},
        },
        {
          title: 'Item 2',
          description: 'Description 2',
          type: 'task',
          state: 'open',
          labels: [],
          assignees: [],
          priority: 'low',
          customFields: {},
        },
      ];

      const options: LoadOptions = {
        dryRun: false,
        batchSize: 1,
        continueOnError: true,
      };

      mockTargetAdapter.createWorkItem
        .mockResolvedValueOnce({ ...mockWorkItem, id: 'new-1', title: 'Item 1' })
        .mockResolvedValueOnce({ ...mockWorkItem, id: 'new-2', title: 'Item 2' });

      const result = await pipeline.load(mockTargetAdapter, items, options);

      expect(result.successful).toBe(2);
      expect(result.failed).toHaveLength(0);
      expect(result.mapping.get('Item 1')).toBe('new-1');
      expect(result.mapping.get('Item 2')).toBe('new-2');
      expect(mockTargetAdapter.createWorkItem).toHaveBeenCalledTimes(2);
    });

    it('should handle dry run mode', async () => {
      const items: WorkItemImport[] = [
        {
          title: 'Dry Run Item',
          description: 'Test',
          type: 'story',
          state: 'open',
          labels: [],
          assignees: [],
          priority: 'medium',
          customFields: {},
        },
      ];

      const options: LoadOptions = {
        dryRun: true,
        batchSize: 10,
        continueOnError: true,
      };

      const result = await pipeline.load(mockTargetAdapter, items, options);

      expect(result.successful).toBe(1);
      expect(result.mapping.get('Dry Run Item')).toBe('dry-run-1');
      expect(mockTargetAdapter.createWorkItem).not.toHaveBeenCalled();
    });

    it('should handle load errors with continueOnError', async () => {
      const items: WorkItemImport[] = [
        {
          title: 'Good Item',
          description: 'Will succeed',
          type: 'story',
          state: 'open',
          labels: [],
          assignees: [],
          priority: 'medium',
          customFields: {},
        },
        {
          title: 'Bad Item',
          description: 'Will fail',
          type: 'story',
          state: 'open',
          labels: [],
          assignees: [],
          priority: 'medium',
          customFields: {},
        },
      ];

      const options: LoadOptions = {
        dryRun: false,
        batchSize: 10,
        continueOnError: true,
      };

      mockTargetAdapter.createWorkItem
        .mockResolvedValueOnce({ ...mockWorkItem, id: 'good-1', title: 'Good Item' })
        .mockRejectedValueOnce(new Error('Creation failed'));

      const result = await pipeline.load(mockTargetAdapter, items, options);

      expect(result.successful).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toEqual({
        id: 'Bad Item',
        reason: 'Creation failed',
      });
    });

    it('should fail fast when continueOnError is false', async () => {
      const items: WorkItemImport[] = [
        {
          title: 'Will Fail',
          description: 'Test',
          type: 'story',
          state: 'open',
          labels: [],
          assignees: [],
          priority: 'medium',
          customFields: {},
        },
      ];

      const options: LoadOptions = {
        dryRun: false,
        batchSize: 10,
        continueOnError: false,
      };

      mockTargetAdapter.createWorkItem.mockRejectedValue(new Error('Creation failed'));

      await expect(pipeline.load(mockTargetAdapter, items, options)).rejects.toThrow(
        'Batch load failed on item "Will Fail": Creation failed',
      );
    });
  });

  describe('verify', () => {
    it('should verify migration integrity', async () => {
      const sourceItems: WorkItemExport[] = [mockWorkItemExport];
      const targetItems: WorkItem[] = [
        {
          ...mockWorkItem,
          id: 'target-1',
          title: 'Test Work Item',
        },
      ];
      const mapping = new Map([['Test Work Item', 'target-1']]);

      const result = await pipeline.verify(sourceItems, targetItems, mapping);

      expect(result.totalItems).toBe(1);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.dataIntegrityIssues).toHaveLength(0);
    });

    it('should detect data integrity issues', async () => {
      const sourceItems: WorkItemExport[] = [mockWorkItemExport];
      const targetItems: WorkItem[] = [
        {
          ...mockWorkItem,
          id: 'target-1',
          title: 'Different Title', // Integrity issue
          state: 'closed', // Another integrity issue
        },
      ];
      const mapping = new Map([['Test Work Item', 'target-1']]);

      const result = await pipeline.verify(sourceItems, targetItems, mapping);

      expect(result.dataIntegrityIssues).toHaveLength(2);
      expect(result.dataIntegrityIssues[0].issue).toContain('Title mismatch');
      expect(result.dataIntegrityIssues[1].issue).toContain('State mismatch');
    });

    it('should handle missing target items', async () => {
      const sourceItems: WorkItemExport[] = [mockWorkItemExport];
      const targetItems: WorkItem[] = []; // No target items
      const mapping = new Map([['Test Work Item', 'missing-item']]);

      const result = await pipeline.verify(sourceItems, targetItems, mapping);

      expect(result.dataIntegrityIssues).toHaveLength(1);
      expect(result.dataIntegrityIssues[0].issue).toBe('Target item not found after migration');
    });

    it('should handle assignee count mismatches', async () => {
      const testUser: User = {
        id: 'user-123',
        username: 'testuser',
        displayName: 'Test User',
        email: 'test@example.com',
        provider: 'github',
      };

      const sourceItems: WorkItemExport[] = [
        {
          ...mockWorkItemExport,
          assignees: [testUser, { ...testUser, username: 'user2' }],
        },
      ];

      const targetItems: WorkItem[] = [
        {
          ...mockWorkItem,
          id: 'target-1',
          assignees: [testUser], // Missing one assignee
        },
      ];

      const mapping = new Map([['Test Work Item', 'target-1']]);

      const result = await pipeline.verify(sourceItems, targetItems, mapping);

      expect(result.dataIntegrityIssues).toHaveLength(1);
      expect(result.dataIntegrityIssues[0].issue).toContain('Assignee count mismatch');
    });
  });
});

describe('MigrationOrchestrator', () => {
  let orchestrator: MigrationOrchestrator;
  let mockPipeline: jest.Mocked<DefaultMigrationPipeline>;
  let mockSourceAdapter: jest.Mocked<IProviderAdapter>;
  let mockTargetAdapter: jest.Mocked<IProviderAdapter>;

  beforeEach(() => {
    mockPipeline = {
      extract: jest.fn(),
      transform: jest.fn(),
      load: jest.fn(),
      verify: jest.fn(),
      transformWorkItem: jest.fn(),
      loadBatch: jest.fn(),
      createBatches: jest.fn(),
      transformUsers: jest.fn(),
      transformLabels: jest.fn(),
      transformCustomFields: jest.fn(),
      handleMissingFields: jest.fn(),
      validateMigrationCompatibility: jest.fn(),
      detectGitLabType: jest.fn(),
      normalizeWorkItemType: jest.fn(),
      verifyDataIntegrity: jest.fn(),
    } as unknown as jest.Mocked<DefaultMigrationPipeline>;

    orchestrator = new MigrationOrchestrator(mockPipeline);

    mockSourceAdapter = {
      initialize: jest.fn(),
      validateConnection: jest.fn(),
      getWorkItem: jest.fn(),
      listWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
      updateWorkItem: jest.fn(),
      deleteWorkItem: jest.fn(),
      linkWorkItems: jest.fn(),
      unlinkWorkItems: jest.fn(),
      bulkCreate: jest.fn(),
      bulkUpdate: jest.fn(),
      search: jest.fn(),
      executeQuery: jest.fn(),
      exportWorkItems: jest.fn(),
      importWorkItems: jest.fn(),
      getCapabilities: jest.fn(),
    } as jest.Mocked<IProviderAdapter>;

    // Mock target adapter
    mockTargetAdapter = {
      ...mockSourceAdapter,
      constructor: { name: 'GitHubAdapter' },
    } as jest.Mocked<IProviderAdapter>;
  });

  describe('migrate', () => {
    it('should orchestrate full migration successfully', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      const options = {
        transform: {
          mapUsers: new Map(),
          mapLabels: new Map(),
          customFieldMapping: {},
          handleMissingFields: 'ignore' as const,
          preserveIds: false,
        },
        load: {
          dryRun: false,
          batchSize: 10,
          continueOnError: true,
        },
      };

      const mockExports = [{ id: 'export-1', title: 'Test' } as WorkItemExport];
      const mockTransformResult: TransformResult = {
        items: [{ title: 'Test', type: 'story' } as WorkItemImport],
        warnings: [],
        errors: [],
        fieldsMapped: new Map(),
        fieldsLost: [],
      };
      const mockMigrationResult: MigrationResult = {
        successful: 1,
        failed: [],
        mapping: new Map([['Test', 'new-1']]),
      };
      const mockVerificationResult: VerificationReport = {
        totalItems: 1,
        successful: 1,
        failed: 0,
        dataIntegrityIssues: [],
      };

      mockPipeline.extract.mockResolvedValue(mockExports);
      mockPipeline.transform.mockResolvedValue(mockTransformResult);
      mockPipeline.load.mockResolvedValue(mockMigrationResult);
      mockPipeline.verify.mockResolvedValue(mockVerificationResult);
      mockTargetAdapter.listWorkItems.mockResolvedValue([]);

      const result = await orchestrator.migrate(
        mockSourceAdapter,
        mockTargetAdapter,
        filter,
        options,
      );

      expect(mockPipeline.extract).toHaveBeenCalledWith(mockSourceAdapter, filter);
      expect(mockPipeline.transform).toHaveBeenCalledWith(mockExports, 'github', options.transform);
      expect(mockPipeline.load).toHaveBeenCalledWith(
        mockTargetAdapter,
        mockTransformResult.items,
        options.load,
      );
      expect(result.migration).toBe(mockMigrationResult);
      expect(result.verification).toBe(mockVerificationResult);
      expect(result.transformResult).toBe(mockTransformResult);
    });

    it('should fail on transformation errors', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      const options = {
        transform: {
          mapUsers: new Map(),
          mapLabels: new Map(),
          customFieldMapping: {},
          handleMissingFields: 'ignore' as const,
          preserveIds: false,
        },
        load: {
          dryRun: false,
          batchSize: 10,
          continueOnError: true,
        },
      };

      const mockExports = [{ id: 'export-1', title: 'Test' } as WorkItemExport];
      const mockTransformResult: TransformResult = {
        items: [],
        warnings: [],
        errors: ['Transformation failed'],
        fieldsMapped: new Map(),
        fieldsLost: [],
      };

      mockPipeline.extract.mockResolvedValue(mockExports);
      mockPipeline.transform.mockResolvedValue(mockTransformResult);

      await expect(
        orchestrator.migrate(mockSourceAdapter, mockTargetAdapter, filter, options),
      ).rejects.toThrow('Transformation failed: Transformation failed');
    });

    it('should skip verification when requested', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      const options = {
        transform: {
          mapUsers: new Map(),
          mapLabels: new Map(),
          customFieldMapping: {},
          handleMissingFields: 'ignore' as const,
          preserveIds: false,
        },
        load: {
          dryRun: false,
          batchSize: 10,
          continueOnError: true,
        },
        skipVerification: true,
      };

      const mockExports = [{ id: 'export-1', title: 'Test' } as WorkItemExport];
      const mockTransformResult: TransformResult = {
        items: [{ title: 'Test', type: 'story' } as WorkItemImport],
        warnings: [],
        errors: [],
        fieldsMapped: new Map(),
        fieldsLost: [],
      };
      const mockMigrationResult: MigrationResult = {
        successful: 1,
        failed: [],
        mapping: new Map([['Test', 'new-1']]),
      };

      mockPipeline.extract.mockResolvedValue(mockExports);
      mockPipeline.transform.mockResolvedValue(mockTransformResult);
      mockPipeline.load.mockResolvedValue(mockMigrationResult);

      const result = await orchestrator.migrate(
        mockSourceAdapter,
        mockTargetAdapter,
        filter,
        options,
      );

      expect(mockPipeline.verify).not.toHaveBeenCalled();
      expect(result.verification).toBeUndefined();
    });

    it('should skip verification for dry runs', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      const options = {
        transform: {
          mapUsers: new Map(),
          mapLabels: new Map(),
          customFieldMapping: {},
          handleMissingFields: 'ignore' as const,
          preserveIds: false,
        },
        load: {
          dryRun: true, // Dry run should skip verification
          batchSize: 10,
          continueOnError: true,
        },
      };

      const mockExports = [{ id: 'export-1', title: 'Test' } as WorkItemExport];
      const mockTransformResult: TransformResult = {
        items: [{ title: 'Test', type: 'story' } as WorkItemImport],
        warnings: [],
        errors: [],
        fieldsMapped: new Map(),
        fieldsLost: [],
      };
      const mockMigrationResult: MigrationResult = {
        successful: 1,
        failed: [],
        mapping: new Map([['Test', 'dry-run-1']]),
      };

      mockPipeline.extract.mockResolvedValue(mockExports);
      mockPipeline.transform.mockResolvedValue(mockTransformResult);
      mockPipeline.load.mockResolvedValue(mockMigrationResult);

      const result = await orchestrator.migrate(
        mockSourceAdapter,
        mockTargetAdapter,
        filter,
        options,
      );

      expect(mockPipeline.verify).not.toHaveBeenCalled();
      expect(result.verification).toBeUndefined();
    });

    it('should handle verification failures gracefully', async () => {
      const filter: WorkItemFilter = { state: 'open' };
      const options = {
        transform: {
          mapUsers: new Map(),
          mapLabels: new Map(),
          customFieldMapping: {},
          handleMissingFields: 'ignore' as const,
          preserveIds: false,
        },
        load: {
          dryRun: false,
          batchSize: 10,
          continueOnError: true,
        },
      };

      const mockExports = [{ id: 'export-1', title: 'Test' } as WorkItemExport];
      const mockTransformResult: TransformResult = {
        items: [{ title: 'Test', type: 'story' } as WorkItemImport],
        warnings: [],
        errors: [],
        fieldsMapped: new Map(),
        fieldsLost: [],
      };
      const mockMigrationResult: MigrationResult = {
        successful: 1,
        failed: [],
        mapping: new Map([['Test', 'new-1']]),
      };

      mockPipeline.extract.mockResolvedValue(mockExports);
      mockPipeline.transform.mockResolvedValue(mockTransformResult);
      mockPipeline.load.mockResolvedValue(mockMigrationResult);
      mockTargetAdapter.listWorkItems.mockRejectedValue(new Error('List failed'));

      const result = await orchestrator.migrate(
        mockSourceAdapter,
        mockTargetAdapter,
        filter,
        options,
      );

      // Should complete successfully even if verification fails
      expect(result.migration).toBe(mockMigrationResult);
      expect(result.verification).toBeUndefined();
    });
  });

  describe('detectTargetProvider', () => {
    it('should detect provider from adapter class name', () => {
      const gitlabAdapter = {
        constructor: { name: 'GitLabAdapter' },
      } as unknown as IProviderAdapter;

      const azureAdapter = {
        constructor: { name: 'AzureAdapter' },
      } as unknown as IProviderAdapter;

      // Use private method via any cast for testing
      const orchestratorAny = orchestrator as any;
      expect(orchestratorAny.detectTargetProvider(gitlabAdapter)).toBe('gitlab');
      expect(orchestratorAny.detectTargetProvider(azureAdapter)).toBe('azure');
    });

    it('should throw for unknown adapter types', () => {
      const unknownAdapter = {
        constructor: { name: 'UnknownAdapter' },
      } as unknown as IProviderAdapter;
      const orchestratorAny = orchestrator as any;

      expect(() => orchestratorAny.detectTargetProvider(unknownAdapter)).toThrow(
        'Cannot detect provider type from adapter: UnknownAdapter',
      );
    });
  });
});
