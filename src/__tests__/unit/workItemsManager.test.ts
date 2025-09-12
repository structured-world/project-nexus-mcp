import { WorkItemsManager } from '../../abstraction/WorkItemsManager.js';
import { ProviderManager } from '../../providers/ProviderManager.js';
import { WorkItem, ProviderAPIResponse } from '../../types/index.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

describe('WorkItemsManager', () => {
  let workItemsManager: WorkItemsManager;
  let mockProviderManager: jest.Mocked<ProviderManager>;

  const mockProviderInstance = {
    id: 'github',
    config: {
      id: 'github',
      name: 'GitHub',
      type: 'stdio' as const,
      enabled: true,
    },
    tools: new Map([
      [
        'github_list_issues',
        { name: 'github_list_issues', inputSchema: { type: 'object' as const } },
      ],
      [
        'github_create_issue',
        { name: 'github_create_issue', inputSchema: { type: 'object' as const } },
      ],
      [
        'github_update_issue',
        { name: 'github_update_issue', inputSchema: { type: 'object' as const } },
      ],
      ['github_get_issue', { name: 'github_get_issue', inputSchema: { type: 'object' as const } }],
    ]),
    resources: new Map(),
    prompts: new Map(),
    status: 'connected' as const,
  };

  const mockProviderAPIResponse: ProviderAPIResponse = {
    id: 123,
    number: 123,
    title: 'Test Issue',
    description: 'Test description',
    body: 'Test description',
    state: 'open',
    assignee: {
      username: 'assignee',
      login: 'assignee',
      name: 'Assignee User',
    },
    labels: [{ name: 'bug' }, { name: 'priority-high' }],
    priority: 'high',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  };

  beforeEach(() => {
    mockProviderManager = {
      getProvider: jest.fn(),
      getAllProviders: jest.fn(),
      callTool: jest.fn(),
      // Add other required methods
      reloadProvider: jest.fn(),
      shutdown: jest.fn(),
    } as unknown as jest.Mocked<ProviderManager>;

    workItemsManager = new WorkItemsManager(mockProviderManager);
  });

  describe('detectProviderFromProject', () => {
    it('should extract provider from project string', () => {
      const manager = workItemsManager as any;
      expect(manager.detectProviderFromProject('github:owner/repo')).toBe('github');
      expect(manager.detectProviderFromProject('gitlab:group/project')).toBe('gitlab');
      expect(manager.detectProviderFromProject('azure:org/project')).toBe('azure');
    });
  });

  describe('listWorkItems', () => {
    it('should list work items for specific project', async () => {
      const mockResult: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify([mockProviderAPIResponse]) }],
      };

      mockProviderManager.getProvider.mockReturnValue(mockProviderInstance);
      mockProviderManager.callTool.mockResolvedValue(mockResult);

      const result = await workItemsManager.listWorkItems('github:owner/repo', { state: 'open' });

      expect(mockProviderManager.getProvider).toHaveBeenCalledWith('github');
      expect(mockProviderManager.callTool).toHaveBeenCalledWith('github_list_issues', {
        state: 'open',
        project: 'owner/repo',
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('github:123');
      expect(result[0].title).toBe('Test Issue');
    });

    it('should list work items from all providers when no project specified', async () => {
      const mockResult: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify([mockProviderAPIResponse]) }],
      };

      mockProviderManager.getAllProviders.mockReturnValue([mockProviderInstance]);
      mockProviderManager.callTool.mockResolvedValue(mockResult);

      const result = await workItemsManager.listWorkItems();

      expect(mockProviderManager.getAllProviders).toHaveBeenCalled();
      expect(mockProviderManager.callTool).toHaveBeenCalledWith('github_list_issues', {});
      expect(result).toHaveLength(1);
    });

    it('should handle provider not found error', async () => {
      mockProviderManager.getProvider.mockReturnValue(undefined);

      await expect(workItemsManager.listWorkItems('nonexistent:project')).rejects.toThrow(
        'Provider nonexistent not found',
      );
    });

    it('should handle API errors gracefully', async () => {
      mockProviderManager.getProvider.mockReturnValue(mockProviderInstance);
      mockProviderManager.callTool.mockRejectedValue(new Error('API Error'));

      const result = await workItemsManager.listWorkItems('github:owner/repo');

      expect(result).toEqual([]);
    });

    it('should skip disconnected providers', async () => {
      const disconnectedProvider = {
        ...mockProviderInstance,
        status: 'disconnected' as const,
      };

      mockProviderManager.getAllProviders.mockReturnValue([disconnectedProvider]);

      const result = await workItemsManager.listWorkItems();

      expect(result).toEqual([]);
      expect(mockProviderManager.callTool).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON responses', async () => {
      const mockResult: CallToolResult = {
        content: [{ type: 'text', text: 'invalid json' }],
      };

      mockProviderManager.getProvider.mockReturnValue(mockProviderInstance);
      mockProviderManager.callTool.mockResolvedValue(mockResult);

      const result = await workItemsManager.listWorkItems('github:owner/repo');

      expect(result).toEqual([]);
    });
  });

  describe('createWorkItem', () => {
    it('should create work item using appropriate tool', async () => {
      const mockResult: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify(mockProviderAPIResponse) }],
      };

      mockProviderManager.getProvider.mockReturnValue(mockProviderInstance);
      mockProviderManager.callTool.mockResolvedValue(mockResult);

      const newItem: Partial<WorkItem> = {
        title: 'New Issue',
        description: 'New description',
        type: 'bug',
        priority: 'high',
      };

      const result = await workItemsManager.createWorkItem('github:owner/repo', newItem);

      expect(mockProviderManager.callTool).toHaveBeenCalledWith('github_create_issue', {
        owner: 'owner',
        repo: 'repo',
        title: 'New Issue',
        description: 'New description',
        body: 'New description',
        priority: 'high',
      });
      expect(result.id).toBe('github:123');
    });

    it('should handle provider not found', async () => {
      mockProviderManager.getProvider.mockReturnValue(undefined);

      await expect(
        workItemsManager.createWorkItem('nonexistent:project', { title: 'Test' }),
      ).rejects.toThrow('Provider nonexistent not found');
    });

    it('should handle missing create tool', async () => {
      const providerWithoutCreateTool = {
        ...mockProviderInstance,
        tools: new Map([
          [
            'github_list_issues',
            { name: 'github_list_issues', inputSchema: { type: 'object' as const } },
          ],
        ]), // No create tool
      };

      mockProviderManager.getProvider.mockReturnValue(providerWithoutCreateTool);

      await expect(
        workItemsManager.createWorkItem('github:owner/repo', { title: 'Test' }),
      ).rejects.toThrow('No create tool found for provider github');
    });

    it('should handle malformed API response', async () => {
      const mockResult: CallToolResult = {
        content: [{ type: 'text', text: 'invalid response' }],
      };

      mockProviderManager.getProvider.mockReturnValue(mockProviderInstance);
      mockProviderManager.callTool.mockResolvedValue(mockResult);

      await expect(
        workItemsManager.createWorkItem('github:owner/repo', { title: 'Test' }),
      ).rejects.toThrow('Failed to create work item');
    });
  });

  describe('updateWorkItem', () => {
    it('should update work item using appropriate tool', async () => {
      const mockResult: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify(mockProviderAPIResponse) }],
      };

      mockProviderManager.getProvider.mockReturnValue(mockProviderInstance);
      mockProviderManager.callTool.mockResolvedValue(mockResult);

      const updates: Partial<WorkItem> = {
        title: 'Updated Title',
        state: 'closed',
      };

      const result = await workItemsManager.updateWorkItem('github:123', updates);

      expect(mockProviderManager.callTool).toHaveBeenCalledWith('github_update_issue', {
        id: '123',
        title: 'Updated Title',
        state: 'closed',
      });
      expect(result.title).toBe('Test Issue');
    });

    it('should handle provider not found', async () => {
      mockProviderManager.getProvider.mockReturnValue(undefined);

      await expect(
        workItemsManager.updateWorkItem('nonexistent:123', { title: 'Test' }),
      ).rejects.toThrow('Provider nonexistent not found');
    });

    it('should handle missing update tool', async () => {
      const providerWithoutUpdateTool = {
        ...mockProviderInstance,
        tools: new Map([
          [
            'github_list_issues',
            { name: 'github_list_issues', inputSchema: { type: 'object' as const } },
          ],
        ]), // No update tool
      };

      mockProviderManager.getProvider.mockReturnValue(providerWithoutUpdateTool);

      await expect(
        workItemsManager.updateWorkItem('github:123', { title: 'Test' }),
      ).rejects.toThrow('No update tool found for provider github');
    });
  });

  describe('transferWorkItem', () => {
    it('should transfer work item between projects', async () => {
      // Mock getWorkItem (private method accessed via transferWorkItem)
      const getWorkItemResult: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify(mockProviderAPIResponse) }],
      };

      const createWorkItemResult: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify({ ...mockProviderAPIResponse, id: 456 }) }],
      };

      const updateWorkItemResult: CallToolResult = {
        content: [
          { type: 'text', text: JSON.stringify({ ...mockProviderAPIResponse, state: 'closed' }) },
        ],
      };

      const gitlabProvider = {
        ...mockProviderInstance,
        id: 'gitlab',
        config: {
          id: 'gitlab',
          name: 'GitLab',
          type: 'stdio' as const,
          enabled: true,
        },
        tools: new Map([
          [
            'gitlab_create_issue',
            { name: 'gitlab_create_issue', inputSchema: { type: 'object' as const } },
          ],
          [
            'gitlab_update_issue',
            { name: 'gitlab_update_issue', inputSchema: { type: 'object' as const } },
          ],
        ]),
      };

      mockProviderManager.getProvider
        .mockReturnValueOnce(mockProviderInstance) // For getWorkItem
        .mockReturnValueOnce(gitlabProvider) // For createWorkItem
        .mockReturnValueOnce(mockProviderInstance); // For updateWorkItem

      mockProviderManager.callTool
        .mockResolvedValueOnce(getWorkItemResult) // getWorkItem
        .mockResolvedValueOnce(createWorkItemResult) // createWorkItem
        .mockResolvedValueOnce(updateWorkItemResult); // updateWorkItem

      const result = await workItemsManager.transferWorkItem('github:123', 'gitlab:group/project');

      expect(result.id).toBe('gitlab:456');
      expect(mockProviderManager.callTool).toHaveBeenCalledTimes(3);
    });

    it('should handle source work item not found', async () => {
      mockProviderManager.getProvider.mockReturnValue(mockProviderInstance);
      mockProviderManager.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'null' }],
      });

      await expect(
        workItemsManager.transferWorkItem('github:123', 'gitlab:group/project'),
      ).rejects.toThrow('Work item github:123 not found');
    });
  });

  describe('normalization methods', () => {
    const manager = workItemsManager as any;

    describe('normalizeType', () => {
      it('should normalize work item types', () => {
        expect(manager.normalizeType('issue')).toBe('issue');
        expect(manager.normalizeType('TASK')).toBe('task');
        expect(manager.normalizeType('incident')).toBe('bug');
        expect(manager.normalizeType('feature')).toBe('story');
        expect(manager.normalizeType('unknown')).toBe('issue');
      });
    });

    describe('normalizeState', () => {
      it('should normalize work item states', () => {
        expect(manager.normalizeState('open')).toBe('open');
        expect(manager.normalizeState('opened')).toBe('open');
        expect(manager.normalizeState('CLOSED')).toBe('closed');
        expect(manager.normalizeState('resolved')).toBe('closed');
        expect(manager.normalizeState('done')).toBe('closed');
        expect(manager.normalizeState('todo')).toBe('open');
        expect(manager.normalizeState('unknown')).toBe('open');
      });
    });

    describe('denormalizeState', () => {
      it('should denormalize states for different providers', () => {
        expect(manager.denormalizeState('open', 'github')).toBe('open');
        expect(manager.denormalizeState('closed', 'github')).toBe('closed');
        expect(manager.denormalizeState('open', 'gitlab')).toBe('opened');
        expect(manager.denormalizeState('closed', 'gitlab')).toBe('closed');
        expect(manager.denormalizeState('open', 'azure')).toBe('New');
        expect(manager.denormalizeState('closed', 'azure')).toBe('Closed');
      });
    });

    describe('normalizeAssignees', () => {
      it('should handle string assignee', () => {
        const item = { assignee: 'testuser' };
        const result = manager.normalizeAssignees(item);

        expect(result).toHaveLength(1);
        expect(result[0].username).toBe('testuser');
        expect(result[0].displayName).toBe('testuser');
      });

      it('should handle object assignee', () => {
        const item = {
          assignee: {
            username: 'testuser',
            login: 'testuser',
            name: 'Test User',
          },
        };
        const result = manager.normalizeAssignees(item);

        expect(result).toHaveLength(1);
        expect(result[0].username).toBe('testuser');
        expect(result[0].displayName).toBe('Test User');
      });

      it('should handle assignees array', () => {
        const item = {
          assignees: [{ username: 'user1', name: 'User One' }, 'user2'],
        };
        const result = manager.normalizeAssignees(item);

        expect(result).toHaveLength(2);
        expect(result[0].username).toBe('user1');
        expect(result[0].displayName).toBe('User One');
        expect(result[1].username).toBe('user2');
        expect(result[1].displayName).toBe('user2');
      });

      it('should handle assigned_to field', () => {
        const item = { assigned_to: { name: 'Assigned User' } };
        const result = manager.normalizeAssignees(item);

        expect(result).toHaveLength(1);
        expect(result[0].username).toBe('Assigned User');
        expect(result[0].displayName).toBe('Assigned User');
      });
    });

    describe('normalizeLabels', () => {
      it('should normalize label objects', () => {
        const item = {
          labels: [{ name: 'bug' }, { title: 'priority-high' }, 'feature'],
        };
        const result = manager.normalizeLabels(item);

        expect(result).toEqual(['bug', 'priority-high', 'feature']);
      });

      it('should handle tags field', () => {
        const item = {
          tags: ['tag1', 'tag2', null, 'tag3'],
        };
        const result = manager.normalizeLabels(item);

        expect(result).toEqual(['tag1', 'tag2', 'tag3']);
      });

      it('should filter out empty labels', () => {
        const item = {
          labels: [{ name: 'bug' }, { name: '' }, { title: '' }, 'valid-label', ''],
        };
        const result = manager.normalizeLabels(item);

        expect(result).toEqual(['bug', 'valid-label']);
      });
    });

    describe('denormalizeWorkItem', () => {
      it('should denormalize for GitHub', () => {
        const item: Partial<WorkItem> = {
          title: 'Test',
          description: 'Description',
          state: 'closed',
          assignees: [{ id: '1', username: 'user1', displayName: 'User 1', provider: 'github' }],
          labels: ['bug', 'priority-high'],
        };

        const result = manager.denormalizeWorkItem(item, 'github', 'owner/repo');

        expect(result).toEqual({
          owner: 'owner',
          repo: 'repo',
          title: 'Test',
          description: 'Description',
          body: 'Description',
          state: 'closed',
          assignee: 'user1',
          assignees: ['user1'],
          labels: ['bug', 'priority-high'],
        });
      });

      it('should denormalize for GitLab', () => {
        const item: Partial<WorkItem> = {
          title: 'Test',
          state: 'closed',
        };

        const result = manager.denormalizeWorkItem(item, 'gitlab', 'group/project');

        expect(result).toEqual({
          project_id: 'group/project',
          title: 'Test',
          state: 'closed',
        });
      });

      it('should denormalize for Azure', () => {
        const item: Partial<WorkItem> = {
          title: 'Test',
          state: 'open',
        };

        const result = manager.denormalizeWorkItem(item, 'azure', 'project');

        expect(result).toEqual({
          project: 'project',
          title: 'Test',
          state: 'New',
        });
      });
    });

    describe('createProviderFields', () => {
      it('should create GitLab provider fields', () => {
        const item = { iid: 123, weight: 5 };
        const result = manager.createProviderFields(item, 'gitlab');

        expect(result).toMatchObject({
          iid: 123,
          weight: 5,
          confidential: false,
        });
      });

      it('should create GitHub provider fields', () => {
        const item = { number: 123 };
        const result = manager.createProviderFields(item, 'github');

        expect(result).toMatchObject({
          number: 123,
          repository: 'unknown/unknown',
        });
      });

      it('should create Azure provider fields', () => {
        const item = { id: 123, type: 'Bug', state: 'Active' };
        const result = manager.createProviderFields(item, 'azure');

        expect(result).toMatchObject({
          workItemId: 123,
          workItemType: 'Bug',
          state: 'Active',
        });
      });
    });
  });

  describe('createUnifiedTools', () => {
    it('should create unified tools schema', () => {
      const tools = workItemsManager.createUnifiedTools();

      expect(tools).toHaveLength(4);

      const listTool = tools.find((t) => t.name === 'nexus_list_work_items');
      expect(listTool).toBeDefined();
      expect(listTool?.description).toContain('List work items');

      const createTool = tools.find((t) => t.name === 'nexus_create_work_item');
      expect(createTool).toBeDefined();
      expect(createTool?.inputSchema.required).toContain('project');
      expect(createTool?.inputSchema.required).toContain('title');

      const updateTool = tools.find((t) => t.name === 'nexus_update_work_item');
      expect(updateTool).toBeDefined();
      expect(updateTool?.inputSchema.required).toContain('id');

      const transferTool = tools.find((t) => t.name === 'nexus_transfer_work_item');
      expect(transferTool).toBeDefined();
      expect(transferTool?.inputSchema.required).toContain('source_id');
      expect(transferTool?.inputSchema.required).toContain('target_project');
    });
  });
});
