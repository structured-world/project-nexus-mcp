import { BaseAdapter } from './BaseAdapter.js';
import { IProviderAdapter, ProviderConfig } from './IProviderAdapter.js';
import {
  WorkItem,
  CreateWorkItemData,
  UpdateWorkItemData,
  WorkItemFilter,
  ProviderCapabilities,
  WorkItemType,
  Priority,
  User,
  Iteration,
  AzureSpecificFields,
  AzureProcess,
} from '../types/index.js';

interface AzureWorkItem {
  id: number;
  rev: number;
  fields: {
    'System.Id': number;
    'System.WorkItemType': string;
    'System.Title': string;
    'System.Description'?: string;
    'System.State': string;
    'System.Reason'?: string;
    'System.AssignedTo'?: {
      displayName: string;
      uniqueName: string;
      id: string;
    };
    'System.CreatedBy': {
      displayName: string;
      uniqueName: string;
      id: string;
    };
    'System.CreatedDate': string;
    'System.ChangedDate': string;
    'System.ClosedDate'?: string;
    'System.AreaPath'?: string;
    'System.IterationPath'?: string;
    'System.Tags'?: string;
    'Microsoft.VSTS.Common.Priority'?: number;
    'Microsoft.VSTS.Common.Severity'?: string;
    'Microsoft.VSTS.Scheduling.StoryPoints'?: number;
    'Microsoft.VSTS.Scheduling.Effort'?: number;
    'Microsoft.VSTS.Scheduling.RemainingWork'?: number;
    'Microsoft.VSTS.Scheduling.OriginalEstimate'?: number;
    'Microsoft.VSTS.Scheduling.CompletedWork'?: number;
    'System.BoardColumn'?: string;
    'System.BoardLane'?: string;
    [key: string]: unknown;
  };
  relations?: Array<{
    rel: string;
    url: string;
    attributes?: {
      name?: string;
      comment?: string;
    };
  }>;
  _links: {
    self: { href: string };
    workItemUpdates: { href: string };
    workItemRevisions: { href: string };
    workItemComments: { href: string };
    html: { href: string };
    workItemType: { href: string };
    fields: { href: string };
  };
}

export class AzureAdapter extends BaseAdapter implements IProviderAdapter {
  private baseUrl!: string;
  private organization!: string;
  private project!: string;
  private process: AzureProcess = 'agile';

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.organization = config.organization ?? '';
    this.project = config.project ?? '';
    this.process = config.process ?? 'agile';

    if (!this.organization || !this.project) {
      throw new Error('Azure DevOps adapter requires organization and project configuration');
    }

    this.baseUrl = `https://dev.azure.com/${this.organization}`;

    await this.validateConnection();
    this.initialized = true;
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/_apis/projects/${this.project}?api-version=7.0`,
        {
          headers: this.createAuthHeaders(),
        },
      );

      if (!response.ok) {
        this.handleHttpError(response, 'project validation');
      }

      return true;
    } catch (error) {
      throw new Error(
        `Azure DevOps connection validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    this.ensureInitialized();

    const workItemId = this.parseWorkItemId(id);

    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems/${workItemId}?$expand=relations&api-version=7.0`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `getting work item ${workItemId}`);
    }

    const azureWorkItem = (await response.json()) as AzureWorkItem;
    return this.convertAzureWorkItemToWorkItem(azureWorkItem);
  }

  async listWorkItems(filter: WorkItemFilter): Promise<WorkItem[]> {
    this.ensureInitialized();

    // Build WIQL (Work Item Query Language) query
    const wiqlQuery = this.buildWiqlQuery(filter);

    const queryResponse = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/wiql?api-version=7.0`,
      {
        method: 'POST',
        headers: this.createAuthHeaders(),
        body: JSON.stringify({ query: wiqlQuery }),
      },
    );

    if (!queryResponse.ok) {
      this.handleHttpError(queryResponse, 'querying work items');
    }

    const queryResult = (await queryResponse.json()) as { workItems?: Array<{ id: number }> };
    const workItemIds = queryResult.workItems?.map((wi) => wi.id) ?? [];

    if (workItemIds.length === 0) {
      return [];
    }

    // Fetch work items in batches (Azure DevOps has a limit)
    const batchSize = 200;
    const workItems: WorkItem[] = [];

    for (let i = 0; i < workItemIds.length; i += batchSize) {
      const batchIds = workItemIds.slice(i, i + batchSize);
      const idsParam = batchIds.join(',');

      const response = await fetch(
        `${this.baseUrl}/${this.project}/_apis/wit/workitems?ids=${idsParam}&$expand=relations&api-version=7.0`,
        {
          headers: this.createAuthHeaders(),
        },
      );

      if (!response.ok) {
        this.handleHttpError(response, 'fetching work items batch');
      }

      const batchResult = (await response.json()) as { value?: AzureWorkItem[] };
      const batchWorkItems = (batchResult.value ?? []).map((wi: AzureWorkItem) =>
        this.convertAzureWorkItemToWorkItem(wi),
      );

      workItems.push(...batchWorkItems);
    }

    return workItems;
  }

  async createWorkItem(data: CreateWorkItemData): Promise<WorkItem> {
    this.ensureInitialized();
    this.validateCreateData(data);

    const workItemType = this.mapWorkItemTypeToAzure(data.type);
    const patches = this.buildCreatePatches(data);

    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems/$${workItemType}?api-version=7.0`,
      {
        method: 'POST',
        headers: {
          ...this.createAuthHeaders(),
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patches),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'creating work item');
    }

    const azureWorkItem = (await response.json()) as AzureWorkItem;
    return this.convertAzureWorkItemToWorkItem(azureWorkItem);
  }

  async updateWorkItem(id: string, updates: UpdateWorkItemData): Promise<WorkItem> {
    this.ensureInitialized();

    const workItemId = this.parseWorkItemId(id);
    const patches = this.buildUpdatePatches(updates);

    if (patches.length === 0) {
      // No updates to apply, return current work item
      return this.getWorkItem(id);
    }

    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems/${workItemId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: {
          ...this.createAuthHeaders(),
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patches),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `updating work item ${workItemId}`);
    }

    const azureWorkItem = (await response.json()) as AzureWorkItem;
    return this.convertAzureWorkItemToWorkItem(azureWorkItem);
  }

  async deleteWorkItem(id: string): Promise<void> {
    this.ensureInitialized();

    const workItemId = this.parseWorkItemId(id);

    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems/${workItemId}?api-version=7.0`,
      {
        method: 'DELETE',
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `deleting work item ${workItemId}`);
    }
  }

  async search(query: string): Promise<WorkItem[]> {
    this.ensureInitialized();

    // Use WIQL for search
    const wiqlQuery = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State] 
      FROM WorkItems 
      WHERE [System.TeamProject] = '${this.project}' 
        AND ([System.Title] CONTAINS '${query}' OR [System.Description] CONTAINS '${query}')
      ORDER BY [System.ChangedDate] DESC`;

    const queryResponse = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/wiql?api-version=7.0`,
      {
        method: 'POST',
        headers: this.createAuthHeaders(),
        body: JSON.stringify({ query: wiqlQuery }),
      },
    );

    if (!queryResponse.ok) {
      this.handleHttpError(queryResponse, 'searching work items');
    }

    const queryResult = (await queryResponse.json()) as { workItems?: Array<{ id: number }> };
    const workItemIds = queryResult.workItems?.map((wi) => wi.id) ?? [];

    if (workItemIds.length === 0) {
      return [];
    }

    // Fetch the actual work items
    const idsParam = workItemIds.slice(0, 200).join(','); // Limit to first 200 results
    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems?ids=${idsParam}&$expand=relations&api-version=7.0`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'fetching search results');
    }

    const result = (await response.json()) as { value?: AzureWorkItem[] };
    return (result.value ?? []).map((wi: AzureWorkItem) => this.convertAzureWorkItemToWorkItem(wi));
  }

  async executeQuery(query: string): Promise<WorkItem[]> {
    this.ensureInitialized();

    // Execute WIQL query directly
    const queryResponse = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/wiql?api-version=7.0`,
      {
        method: 'POST',
        headers: this.createAuthHeaders(),
        body: JSON.stringify({ query }),
      },
    );

    if (!queryResponse.ok) {
      this.handleHttpError(queryResponse, 'executing query');
    }

    const queryResult = (await queryResponse.json()) as { workItems?: Array<{ id: number }> };
    const workItemIds = queryResult.workItems?.map((wi) => wi.id) ?? [];

    if (workItemIds.length === 0) {
      return [];
    }

    // Fetch the actual work items
    const idsParam = workItemIds.join(',');
    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems?ids=${idsParam}&$expand=relations&api-version=7.0`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'fetching query results');
    }

    const result = (await response.json()) as { value?: AzureWorkItem[] };
    return (result.value ?? []).map((wi: AzureWorkItem) => this.convertAzureWorkItemToWorkItem(wi));
  }

  async linkWorkItems(parent: string, child: string, linkType: string): Promise<void> {
    this.ensureInitialized();

    const parentId = this.parseWorkItemId(parent);
    const childId = this.parseWorkItemId(child);
    const azureLinkType = this.mapLinkTypeToAzure(linkType);

    const patches = [
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: azureLinkType,
          url: `${this.baseUrl}/${this.project}/_apis/wit/workItems/${childId}`,
        },
      },
    ];

    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems/${parentId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: {
          ...this.createAuthHeaders(),
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patches),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `linking work items ${parentId} -> ${childId}`);
    }
  }

  async unlinkWorkItems(parent: string, child: string): Promise<void> {
    this.ensureInitialized();

    const parentId = this.parseWorkItemId(parent);
    const childId = this.parseWorkItemId(child);

    // First get the parent work item to find the relation index
    const azureWorkItem = await this.getAzureWorkItem(parentId);

    if (!azureWorkItem.relations) {
      return; // No relations to unlink
    }

    // Find the relation to remove
    const relationIndex = azureWorkItem.relations.findIndex((rel) =>
      rel.url.includes(`/${childId}`),
    );

    if (relationIndex === -1) {
      return; // Relation not found
    }

    const patches = [
      {
        op: 'remove',
        path: `/relations/${relationIndex}`,
      },
    ];

    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems/${parentId}?api-version=7.0`,
      {
        method: 'PATCH',
        headers: {
          ...this.createAuthHeaders(),
          'Content-Type': 'application/json-patch+json',
        },
        body: JSON.stringify(patches),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `unlinking work items ${parentId} -> ${childId}`);
    }
  }

  getCapabilities(): ProviderCapabilities {
    const workItemTypes = this.getWorkItemTypesForProcess(this.process);

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
      hierarchyLevels: this.process === 'basic' ? 3 : 4,
      customWorkItemTypes: workItemTypes,
    };
  }

  // Helper methods

  private parseWorkItemId(id: string): string {
    // Expected format: azure:org/project#id or azure:id
    const parts = id.split(':');
    if (parts.length >= 2) {
      const idPart = parts[parts.length - 1];
      return idPart.includes('#') ? idPart.split('#')[1] : idPart;
    }
    throw new Error(`Invalid Azure DevOps work item ID format: ${id}`);
  }

  private async getAzureWorkItem(id: string): Promise<AzureWorkItem> {
    const response = await fetch(
      `${this.baseUrl}/${this.project}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.0`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `getting Azure work item ${id}`);
    }

    return response.json() as Promise<AzureWorkItem>;
  }

  private convertAzureWorkItemToWorkItem(azureWorkItem: AzureWorkItem): WorkItem {
    const fields = azureWorkItem.fields;

    const azureFields: AzureSpecificFields = {
      workItemId: fields['System.Id'],
      workItemType: fields['System.WorkItemType'],
      areaPath: fields['System.AreaPath'],
      iterationPath: fields['System.IterationPath'],
      state: fields['System.State'],
      reason: fields['System.Reason'],
      boardColumn: fields['System.BoardColumn'],
      boardLane: fields['System.BoardLane'],
      storyPoints: fields['Microsoft.VSTS.Scheduling.StoryPoints'],
      effort: fields['Microsoft.VSTS.Scheduling.Effort'],
      remainingWork: fields['Microsoft.VSTS.Scheduling.RemainingWork'],
      originalEstimate: fields['Microsoft.VSTS.Scheduling.OriginalEstimate'],
      completedWork: fields['Microsoft.VSTS.Scheduling.CompletedWork'],
      customFields: this.extractCustomFields(fields),
    };

    const assignee = fields['System.AssignedTo'];
    const assignees = assignee ? [this.convertAzureUser(assignee)] : [];

    return {
      id: `azure:${this.organization}/${this.project}#${fields['System.Id']}`,
      provider: 'azure',
      type: this.mapAzureTypeToWorkItem(fields['System.WorkItemType']),
      title: fields['System.Title'],
      description: fields['System.Description'] ?? '',
      state: this.mapAzureStateToCommon(fields['System.State']),
      author: this.convertAzureUser(fields['System.CreatedBy']),
      assignees,
      labels: this.parseTags(fields['System.Tags']),
      iteration: fields['System.IterationPath']
        ? this.createIterationFromPath(fields['System.IterationPath'])
        : undefined,
      priority: this.mapAzurePriorityToCommon(fields['Microsoft.VSTS.Common.Priority']),
      createdAt: new Date(fields['System.CreatedDate']),
      updatedAt: new Date(fields['System.ChangedDate']),
      closedAt: fields['System.ClosedDate'] ? new Date(fields['System.ClosedDate']) : undefined,
      providerFields: azureFields,
    };
  }

  private convertAzureUser(azureUser: {
    displayName: string;
    uniqueName: string;
    id: string;
  }): User {
    return {
      id: azureUser.id,
      username: azureUser.uniqueName,
      displayName: azureUser.displayName,
      provider: 'azure',
    };
  }

  private createIterationFromPath(iterationPath: string): Iteration {
    const pathParts = iterationPath.split('\\');
    const iterationName = pathParts[pathParts.length - 1];

    return {
      id: iterationPath,
      title: iterationName,
      startDate: new Date(), // Would need additional API call for actual dates
      endDate: new Date(),
      state: 'current',
      provider: 'azure',
      path: iterationPath,
    };
  }

  private buildWiqlQuery(filter: WorkItemFilter): string {
    let query = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State] FROM WorkItems WHERE [System.TeamProject] = '${this.project}'`;

    if (filter.type) {
      const azureType = this.mapWorkItemTypeToAzure(filter.type);
      query += ` AND [System.WorkItemType] = '${azureType}'`;
    }

    if (filter.state) {
      if (filter.state === 'open') {
        query += ` AND [System.State] NOT IN ('Closed', 'Done', 'Resolved')`;
      } else if (filter.state === 'closed') {
        query += ` AND [System.State] IN ('Closed', 'Done', 'Resolved')`;
      }
    }

    if (filter.assignee) {
      query += ` AND [System.AssignedTo] = '${filter.assignee}'`;
    }

    if (filter.labels && filter.labels.length > 0) {
      const tagConditions = filter.labels.map((label) => `[System.Tags] CONTAINS '${label}'`);
      query += ` AND (${tagConditions.join(' OR ')})`;
    }

    if (filter.iteration) {
      query += ` AND [System.IterationPath] UNDER '${filter.iteration}'`;
    }

    if (filter.since) {
      query += ` AND [System.ChangedDate] >= '${filter.since.toISOString()}'`;
    }

    if (filter.until) {
      query += ` AND [System.ChangedDate] <= '${filter.until.toISOString()}'`;
    }

    query += ' ORDER BY [System.ChangedDate] DESC';

    return query;
  }

  private buildCreatePatches(
    data: CreateWorkItemData,
  ): Array<{ op: string; path: string; value: unknown }> {
    const patches = [{ op: 'add', path: '/fields/System.Title', value: data.title }];

    if (data.description) {
      patches.push({ op: 'add', path: '/fields/System.Description', value: data.description });
    }

    if (data.assignees && data.assignees.length > 0) {
      // Azure DevOps only supports single assignee
      patches.push({
        op: 'add',
        path: '/fields/System.AssignedTo',
        value: data.assignees[0].username,
      });
    }

    if (data.labels && data.labels.length > 0) {
      patches.push({ op: 'add', path: '/fields/System.Tags', value: data.labels.join(';') });
    }

    if (data.priority) {
      const azurePriority = this.mapCommonPriorityToAzure(data.priority);
      patches.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: String(azurePriority),
      });
    }

    if (data.iteration) {
      patches.push({
        op: 'add',
        path: '/fields/System.IterationPath',
        value: data.iteration.path ?? data.iteration.title,
      });
    }

    if (data.customFields) {
      for (const [field, value] of Object.entries(data.customFields)) {
        patches.push({ op: 'add', path: `/fields/${field}`, value: String(value) });
      }
    }

    return patches;
  }

  private buildUpdatePatches(
    updates: UpdateWorkItemData,
  ): Array<{ op: string; path: string; value: unknown }> {
    const patches = [];

    if (updates.title) {
      patches.push({ op: 'replace', path: '/fields/System.Title', value: updates.title });
    }

    if (updates.description) {
      patches.push({
        op: 'replace',
        path: '/fields/System.Description',
        value: updates.description,
      });
    }

    if (updates.state) {
      const azureState = this.mapCommonStateToAzure(updates.state);
      patches.push({ op: 'replace', path: '/fields/System.State', value: azureState });
    }

    if (updates.assignees) {
      const assigneeValue = updates.assignees.length > 0 ? updates.assignees[0].username : '';
      patches.push({ op: 'replace', path: '/fields/System.AssignedTo', value: assigneeValue });
    }

    if (updates.labels) {
      patches.push({ op: 'replace', path: '/fields/System.Tags', value: updates.labels.join(';') });
    }

    if (updates.priority) {
      const azurePriority = this.mapCommonPriorityToAzure(updates.priority);
      patches.push({
        op: 'replace',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: azurePriority,
      });
    }

    if (updates.iteration) {
      patches.push({
        op: 'replace',
        path: '/fields/System.IterationPath',
        value: updates.iteration.path ?? updates.iteration.title,
      });
    }

    return patches;
  }

  private mapWorkItemTypeToAzure(type: WorkItemType): string {
    const typeMaps = {
      agile: {
        epic: 'Epic',
        feature: 'Feature',
        story: 'User Story',
        bug: 'Bug',
        task: 'Task',
        test: 'Test Case',
        issue: 'User Story',
      },
      scrum: {
        epic: 'Epic',
        feature: 'Feature',
        story: 'Product Backlog Item',
        bug: 'Bug',
        task: 'Task',
        test: 'Test Case',
        issue: 'Product Backlog Item',
      },
      basic: {
        epic: 'Epic',
        feature: 'Epic',
        story: 'Issue',
        bug: 'Issue',
        task: 'Task',
        test: 'Task',
        issue: 'Issue',
      },
    };

    return typeMaps[this.process][type] || 'Issue';
  }

  private mapAzureTypeToWorkItem(azureType: string): WorkItemType {
    const typeMap: Record<string, WorkItemType> = {
      Epic: 'epic',
      Feature: 'feature',
      'User Story': 'story',
      'Product Backlog Item': 'story',
      Issue: 'issue',
      Task: 'task',
      Bug: 'bug',
      'Test Case': 'test',
    };

    return typeMap[azureType] ?? 'issue';
  }

  private mapAzureStateToCommon(azureState: string): 'open' | 'closed' {
    const closedStates = ['Closed', 'Done', 'Resolved', 'Removed'];
    return closedStates.includes(azureState) ? 'closed' : 'open';
  }

  private mapCommonStateToAzure(state: 'open' | 'closed'): string {
    return state === 'closed' ? 'Done' : 'Active';
  }

  private mapCommonPriorityToAzure(priority: Priority): number {
    const priorityMap: Record<Priority, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };

    return priorityMap[priority] || 3;
  }

  private mapAzurePriorityToCommon(azurePriority?: number): Priority {
    if (!azurePriority) return 'medium';

    const priorityMap: Record<number, Priority> = {
      1: 'critical',
      2: 'high',
      3: 'medium',
      4: 'low',
    };

    return priorityMap[azurePriority] ?? 'medium';
  }

  private mapLinkTypeToAzure(linkType: string): string {
    const linkTypeMap: Record<string, string> = {
      blocks: 'System.LinkTypes.Dependency-Forward',
      related: 'System.LinkTypes.Related',
      duplicate: 'System.LinkTypes.Duplicate-Forward',
      'parent-child': 'System.LinkTypes.Hierarchy-Forward',
    };

    return linkTypeMap[linkType] || 'System.LinkTypes.Related';
  }

  private parseTags(tagsString?: string): string[] {
    if (!tagsString) return [];
    return tagsString
      .split(';')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  private extractCustomFields(fields: Record<string, unknown>): Record<string, unknown> {
    const customFields: Record<string, unknown> = {};

    // Extract non-system fields as custom fields
    for (const [key, value] of Object.entries(fields)) {
      if (!key.startsWith('System.') && !key.startsWith('Microsoft.VSTS.')) {
        customFields[key] = value;
      }
    }

    return customFields;
  }

  private getWorkItemTypesForProcess(process: AzureProcess): string[] {
    const workItemTypes = {
      agile: ['Epic', 'Feature', 'User Story', 'Task', 'Bug', 'Test Case'],
      scrum: ['Epic', 'Feature', 'Product Backlog Item', 'Task', 'Bug', 'Test Case'],
      basic: ['Epic', 'Issue', 'Task'],
    };

    return workItemTypes[process];
  }

  protected createAuthHeaders(): Record<string, string> {
    const encodedToken = Buffer.from(`:${this.config.token}`).toString('base64');
    return {
      Authorization: `Basic ${encodedToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Project-Nexus-MCP/1.0',
    };
  }
}
