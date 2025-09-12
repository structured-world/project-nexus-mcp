import { ProviderManager } from '../providers/ProviderManager.js';
import { WorkItem, ProviderAPIResponse, Priority } from '../types/index.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent, isProviderAPIResponse, isLabelLike } from '../utils/typeGuards.js';

export class WorkItemsManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listWorkItems(project?: string, filters?: Record<string, unknown>): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    if (project) {
      const provider = this.detectProviderFromProject(project);
      const providerInstance = this.providerManager.getProvider(provider);

      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }

      const toolName = `${provider}_list_issues`;

      try {
        const result = await this.providerManager.callTool(toolName, {
          ...filters,
          project: project.split(':')[1],
        });

        if (hasTextContent(result)) {
          const itemsJson = result.content[0].text;
          const parsedItems: unknown = JSON.parse(itemsJson);

          if (Array.isArray(parsedItems)) {
            for (const item of parsedItems) {
              if (isProviderAPIResponse(item)) {
                workItems.push(this.normalizeWorkItem(item, provider));
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          process.stderr.write(`Error listing work items from ${provider}: ${error.message}\n`);
        } else {
          process.stderr.write(`Error listing work items from ${provider}: ${String(error)}\n`);
        }
      }
    } else {
      for (const provider of this.providerManager.getAllProviders()) {
        if (provider.status !== 'connected') continue;

        const listTools = ['list_issues', 'list_work_items', 'list_tasks'];

        for (const toolSuffix of listTools) {
          const toolName = `${provider.id}_${toolSuffix}`;
          if (provider.tools.has(toolName)) {
            try {
              const result = await this.providerManager.callTool(toolName, filters ?? {});

              if (hasTextContent(result)) {
                const itemsJson = result.content[0].text;
                const parsedItems: unknown = JSON.parse(itemsJson);

                if (Array.isArray(parsedItems)) {
                  for (const item of parsedItems) {
                    if (isProviderAPIResponse(item)) {
                      workItems.push(this.normalizeWorkItem(item, provider.id));
                    }
                  }
                }
              }
              break;
            } catch (error) {
              if (error instanceof Error) {
                process.stderr.write(
                  `Error listing work items from ${provider.id}: ${error.message}\n`,
                );
              } else {
                process.stderr.write(
                  `Error listing work items from ${provider.id}: ${String(error)}\n`,
                );
              }
            }
          }
        }
      }
    }

    return workItems;
  }

  async createWorkItem(project: string, item: Partial<WorkItem>): Promise<WorkItem> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const createTools = ['create_issue', 'create_work_item', 'create_task'];

    let toolName: string | null = null;
    for (const toolSuffix of createTools) {
      const candidateTool = `${provider}_${toolSuffix}`;
      if (providerInstance.tools.has(candidateTool)) {
        toolName = candidateTool;
        break;
      }
    }

    if (!toolName) {
      throw new Error(`No create tool found for provider ${provider}`);
    }

    const projectPath = project.split(':')[1];
    const args = this.denormalizeWorkItem(item, provider, projectPath);

    const result = await this.providerManager.callTool(toolName, args);

    if (hasTextContent(result)) {
      const createdItemJson = result.content[0].text;
      const createdItem: unknown = JSON.parse(createdItemJson);

      if (isProviderAPIResponse(createdItem)) {
        return this.normalizeWorkItem(createdItem, provider);
      }
    }

    throw new Error('Failed to create work item');
  }

  async updateWorkItem(workItemId: string, updates: Partial<WorkItem>): Promise<WorkItem> {
    const [provider, id] = workItemId.split(':');
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const updateTools = ['update_issue', 'update_work_item', 'update_task'];

    let toolName: string | null = null;
    for (const toolSuffix of updateTools) {
      const candidateTool = `${provider}_${toolSuffix}`;
      if (providerInstance.tools.has(candidateTool)) {
        toolName = candidateTool;
        break;
      }
    }

    if (!toolName) {
      throw new Error(`No update tool found for provider ${provider}`);
    }

    const args = {
      id: id,
      ...this.denormalizeWorkItem(updates, provider),
    };

    const result = await this.providerManager.callTool(toolName, args);

    if (hasTextContent(result)) {
      const updatedItemJson = result.content[0].text;
      const updatedItem: unknown = JSON.parse(updatedItemJson);

      if (isProviderAPIResponse(updatedItem)) {
        return this.normalizeWorkItem(updatedItem, provider);
      }
    }

    throw new Error('Failed to update work item');
  }

  async transferWorkItem(workItemId: string, targetProject: string): Promise<WorkItem> {
    const sourceWorkItem = await this.getWorkItem(workItemId);

    if (!sourceWorkItem) {
      throw new Error(`Work item ${workItemId} not found`);
    }

    const newItem = await this.createWorkItem(targetProject, {
      title: sourceWorkItem.title,
      description: `Transferred from ${sourceWorkItem.provider}:${sourceWorkItem.id}\n\n${sourceWorkItem.description}`,
      type: sourceWorkItem.type,
      labels: [...sourceWorkItem.labels, 'transferred'],
      priority: sourceWorkItem.priority,
    });

    await this.updateWorkItem(workItemId, {
      state: 'closed',
      description: `${sourceWorkItem.description}\n\n---\nTransferred to ${targetProject}:${newItem.id}`,
    });

    return newItem;
  }

  private async getWorkItem(workItemId: string): Promise<WorkItem | null> {
    const [provider, id] = workItemId.split(':');
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const getTools = ['get_issue', 'get_work_item', 'get_task'];

    let toolName: string | null = null;
    for (const toolSuffix of getTools) {
      const candidateTool = `${provider}_${toolSuffix}`;
      if (providerInstance.tools.has(candidateTool)) {
        toolName = candidateTool;
        break;
      }
    }

    if (!toolName) {
      return null;
    }

    try {
      const result = await this.providerManager.callTool(toolName, { id });

      if (hasTextContent(result)) {
        const itemJson = result.content[0].text;
        const item: unknown = JSON.parse(itemJson);

        if (isProviderAPIResponse(item)) {
          return this.normalizeWorkItem(item, provider);
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        process.stderr.write(`Error getting work item ${workItemId}: ${error.message}\n`);
      } else {
        process.stderr.write(`Error getting work item ${workItemId}: ${String(error)}\n`);
      }
    }

    return null;
  }

  private normalizeWorkItem(item: ProviderAPIResponse, provider: string): WorkItem {
    const assignees = this.normalizeAssignees(item);
    const author = this.normalizeAuthor(item);

    const normalized: WorkItem = {
      id: `${provider}:${item.id ?? item.number ?? item.iid}`,
      provider: provider as 'gitlab' | 'github' | 'azure',
      type: this.normalizeType(item.type ?? item.issue_type ?? 'issue'),
      title: item.title ?? item.name ?? item.summary ?? '',
      description: item.description ?? item.body ?? item.content ?? '',
      state: this.normalizeState(item.state ?? item.status ?? 'open'),
      author: author,
      assignees: assignees,
      labels: this.normalizeLabels(item),
      priority: (item.priority as Priority | undefined) ?? 'medium',
      createdAt: item.created_at ? new Date(item.created_at) : new Date(),
      updatedAt: item.updated_at ? new Date(item.updated_at) : new Date(),
      providerFields: this.createProviderFields(item, provider),
    };

    return normalized;
  }

  private denormalizeWorkItem(
    item: Partial<WorkItem>,
    provider: string,
    project?: string,
  ): Record<string, unknown> {
    const denormalized: Record<string, unknown> = {};

    if (project) {
      if (provider === 'github') {
        const [owner, repo] = project.split('/');
        denormalized.owner = owner;
        denormalized.repo = repo;
      } else if (provider === 'gitlab') {
        denormalized.project_id = project;
      } else if (provider === 'azure') {
        denormalized.project = project;
      }
    }

    if (item.title) denormalized.title = item.title;
    if (item.description) {
      denormalized.description = item.description;
      denormalized.body = item.description;
    }
    if (item.state) {
      denormalized.state = this.denormalizeState(item.state, provider);
    }
    if (item.assignees && item.assignees.length > 0) {
      denormalized.assignee = item.assignees[0].username;
      denormalized.assignees = item.assignees.map((a) => a.username);
    }
    if (item.labels) {
      denormalized.labels = item.labels;
    }
    if (item.milestone) {
      denormalized.milestone = item.milestone;
    }
    if (item.priority) {
      denormalized.priority = item.priority;
    }

    return denormalized;
  }

  private normalizeType(type: string): WorkItem['type'] {
    const typeMap: Record<string, WorkItem['type']> = {
      issue: 'issue',
      task: 'task',
      epic: 'epic',
      story: 'story',
      bug: 'bug',
      incident: 'bug',
      feature: 'story',
    };

    return typeMap[type.toLowerCase()] ?? 'issue';
  }

  private normalizeState(status: string): 'open' | 'closed' {
    const statusMap: Record<string, 'open' | 'closed'> = {
      open: 'open',
      opened: 'open',
      closed: 'closed',
      resolved: 'closed',
      done: 'closed',
      todo: 'open',
      new: 'open',
    };

    return statusMap[status.toLowerCase()] ?? 'open';
  }

  private denormalizeState(state: 'open' | 'closed', provider: string): string {
    if (provider === 'github') {
      return state === 'closed' ? 'closed' : 'open';
    } else if (provider === 'gitlab') {
      return state === 'closed' ? 'closed' : 'opened';
    } else if (provider === 'azure') {
      const azureStateMap: Record<string, string> = {
        open: 'New',
        closed: 'Closed',
      };
      return azureStateMap[state] || state;
    }

    return state;
  }

  private normalizeAssignees(item: ProviderAPIResponse): import('../types/index.js').User[] {
    const assignees: import('../types/index.js').User[] = [];

    if (item.assignee) {
      if (typeof item.assignee === 'string') {
        assignees.push(this.createUser(item.assignee, item.assignee));
      } else {
        assignees.push(
          this.createUser(
            item.assignee.username ?? item.assignee.login ?? 'unknown',
            item.assignee.name ?? item.assignee.username ?? item.assignee.login ?? 'unknown',
          ),
        );
      }
    }

    if (item.assignees && Array.isArray(item.assignees)) {
      for (const assignee of item.assignees) {
        if (typeof assignee === 'string') {
          assignees.push(this.createUser(assignee, assignee));
        } else {
          assignees.push(
            this.createUser(
              assignee.username ?? assignee.login ?? 'unknown',
              assignee.name ?? assignee.username ?? assignee.login ?? 'unknown',
            ),
          );
        }
      }
    }

    if (item.assigned_to && assignees.length === 0) {
      if (typeof item.assigned_to === 'string') {
        assignees.push(this.createUser(item.assigned_to, item.assigned_to));
      } else {
        assignees.push(
          this.createUser(item.assigned_to.name ?? 'unknown', item.assigned_to.name ?? 'unknown'),
        );
      }
    }

    return assignees;
  }

  private normalizeAuthor(_item: ProviderAPIResponse): import('../types/index.js').User {
    // Default author - in real implementation this would come from the API response
    return this.createUser('unknown', 'Unknown User');
  }

  private createUser(username: string, displayName: string): import('../types/index.js').User {
    return {
      id: username,
      username,
      displayName,
      provider: 'gitlab' as const, // Will be set properly in real implementation
    };
  }

  private createProviderFields(
    item: ProviderAPIResponse,
    provider: string,
  ): import('../types/index.js').ProviderSpecificFields {
    if (provider === 'gitlab') {
      return {
        iid: item.iid ?? 0,
        projectId: 0, // Would be extracted from API response
        weight: 'weight' in item && typeof item.weight === 'number' ? item.weight : undefined,
        confidential: false,
      } as import('../types/index.js').GitLabSpecificFields;
    } else if (provider === 'github') {
      return {
        number: item.number ?? 0,
        repository: 'unknown/unknown',
        stateReason: undefined,
      } as import('../types/index.js').GitHubSpecificFields;
    } else {
      return {
        workItemId: typeof item.id === 'number' ? item.id : 0,
        workItemType: item.type ?? 'Issue',
        state: item.state ?? item.status ?? 'New',
      } as import('../types/index.js').AzureSpecificFields;
    }
  }

  // Removed unused normalizeMilestone method

  private normalizeLabels(item: ProviderAPIResponse): string[] {
    if (item.labels && Array.isArray(item.labels)) {
      const validLabels: Array<string | { name: string } | { title: string }> =
        item.labels.filter(isLabelLike);
      const labelTexts: string[] = validLabels.map((label) =>
        typeof label === 'string' ? label : ('name' in label ? label.name : label.title) || '',
      );
      return labelTexts.filter((labelText) => labelText.length > 0);
    }

    if (item.tags && Array.isArray(item.tags)) {
      return item.tags.filter((tag): tag is string => typeof tag === 'string');
    }

    return [];
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_list_work_items',
        description:
          'List work items (issues, tasks, etc.) from all configured providers or a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description:
                'Optional project identifier (e.g., "github:owner/repo", "gitlab:group/project")',
            },
            status: {
              type: 'string',
              enum: ['open', 'closed', 'in_progress', 'all'],
              description: 'Filter by status',
            },
            assignee: {
              type: 'string',
              description: 'Filter by assignee username',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by labels',
            },
          },
        },
      },
      {
        name: 'nexus_create_work_item',
        description: 'Create a new work item in the specified project',
        inputSchema: {
          type: 'object',
          required: ['project', 'title'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner/repo")',
            },
            title: {
              type: 'string',
              description: 'Title of the work item',
            },
            description: {
              type: 'string',
              description: 'Description or body of the work item',
            },
            type: {
              type: 'string',
              enum: ['issue', 'task', 'epic', 'story', 'bug'],
              description: 'Type of work item',
            },
            assignee: {
              type: 'string',
              description: 'Username to assign the item to',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels to apply',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'critical'],
              description: 'Priority level',
            },
          },
        },
      },
      {
        name: 'nexus_update_work_item',
        description: 'Update an existing work item',
        inputSchema: {
          type: 'object',
          required: ['id'],
          properties: {
            id: {
              type: 'string',
              description: 'Work item identifier (e.g., "github:123")',
            },
            title: {
              type: 'string',
              description: 'New title',
            },
            description: {
              type: 'string',
              description: 'New description',
            },
            status: {
              type: 'string',
              enum: ['open', 'closed', 'in_progress'],
              description: 'New status',
            },
            assignee: {
              type: 'string',
              description: 'New assignee username',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'New labels',
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high', 'critical'],
              description: 'New priority',
            },
          },
        },
      },
      {
        name: 'nexus_transfer_work_item',
        description: 'Transfer a work item from one project/platform to another',
        inputSchema: {
          type: 'object',
          required: ['source_id', 'target_project'],
          properties: {
            source_id: {
              type: 'string',
              description: 'Source work item identifier (e.g., "gitlab:123")',
            },
            target_project: {
              type: 'string',
              description: 'Target project identifier (e.g., "github:owner/repo")',
            },
            close_source: {
              type: 'boolean',
              description: 'Whether to close the source item after transfer',
              default: true,
            },
          },
        },
      },
    ];
  }
}
