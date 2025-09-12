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
  Milestone,
  GitLabSpecificFields,
} from '../types/index.js';
import { isGitLabIssue, isGitLabEpic } from '../utils/typeGuards.js';

interface GitLabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: 'opened' | 'closed';
  author: {
    id: number;
    username: string;
    name: string;
    email?: string;
  };
  assignees: Array<{
    id: number;
    username: string;
    name: string;
    email?: string;
  }>;
  labels: string[];
  milestone?: {
    id: number;
    title: string;
    description?: string;
    state: 'active' | 'closed';
    due_date?: string;
    start_date?: string;
  };
  weight?: number;
  time_stats: {
    time_estimate: number;
    total_time_spent: number;
  };
  created_at: string;
  updated_at: string;
  closed_at?: string;
  due_date?: string;
  confidential: boolean;
  discussion_locked: boolean;
  epic?: {
    id: number;
    iid: number;
  };
  health_status?: 'on_track' | 'needs_attention' | 'at_risk';
  issue_type: 'issue' | 'incident' | 'test_case' | 'task';
  web_url: string;
}

interface GitLabEpic {
  id: number;
  iid: number;
  group_id: number;
  title: string;
  description: string;
  state: 'opened' | 'closed';
  author: {
    id: number;
    username: string;
    name: string;
    email?: string;
  };
  labels: string[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
  due_date?: string;
  start_date?: string;
  web_url: string;
}

export class GitLabAdapter extends BaseAdapter implements IProviderAdapter {
  private baseUrl!: string;
  private projectId?: string;
  private groupId?: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.baseUrl = config.apiUrl.endsWith('/') ? config.apiUrl.slice(0, -1) : config.apiUrl;

    if (config.project) {
      this.projectId = config.project;
    }
    if (config.group) {
      this.groupId = config.group;
    }

    await this.validateConnection();
    this.initialized = true;
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v4/user`, {
        headers: this.createAuthHeaders(),
      });

      if (!response.ok) {
        this.handleHttpError(response, 'user validation');
      }

      return true;
    } catch (error) {
      throw new Error(
        `GitLab connection validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    this.ensureInitialized();

    const [type, itemId] = this.parseWorkItemId(id);

    if (type === 'epic') {
      return this.getEpic(itemId);
    } else {
      return this.getIssue(itemId);
    }
  }

  private async getIssue(iid: string): Promise<WorkItem> {
    if (!this.projectId) {
      throw new Error('Project ID is required for issue operations');
    }

    const response = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.projectId}/issues/${iid}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `getting issue ${iid}`);
    }

    const issueData: unknown = await response.json();
    if (!isGitLabIssue(issueData)) {
      throw new Error('Invalid GitLab issue response');
    }
    return this.convertIssueToWorkItem(issueData as GitLabIssue);
  }

  private async getEpic(iid: string): Promise<WorkItem> {
    if (!this.groupId) {
      throw new Error('Group ID is required for epic operations');
    }

    const response = await fetch(`${this.baseUrl}/api/v4/groups/${this.groupId}/epics/${iid}`, {
      headers: this.createAuthHeaders(),
    });

    if (!response.ok) {
      this.handleHttpError(response, `getting epic ${iid}`);
    }

    const epicData: unknown = await response.json();
    if (!isGitLabEpic(epicData)) {
      throw new Error('Invalid GitLab epic response');
    }
    return this.convertEpicToWorkItem(epicData as GitLabEpic);
  }

  async listWorkItems(filter: WorkItemFilter): Promise<WorkItem[]> {
    this.ensureInitialized();

    const workItems: WorkItem[] = [];

    // Get issues from project
    if (this.projectId) {
      const issues = await this.listIssues(filter);
      workItems.push(...issues);
    }

    // Get epics from group (if premium)
    if (this.groupId && filter.type === 'epic') {
      const epics = await this.listEpics(filter);
      workItems.push(...epics);
    }

    return workItems;
  }

  private async listIssues(filter: WorkItemFilter): Promise<WorkItem[]> {
    const params = new URLSearchParams();

    if (filter.state) {
      params.append('state', filter.state === 'open' ? 'opened' : filter.state);
    }
    if (filter.assignee) {
      params.append('assignee_username', filter.assignee);
    }
    if (filter.labels && filter.labels.length > 0) {
      params.append('labels', filter.labels.join(','));
    }
    if (filter.milestone) {
      params.append('milestone', filter.milestone);
    }
    if (filter.since) {
      params.append('updated_after', filter.since.toISOString());
    }
    if (filter.until) {
      params.append('updated_before', filter.until.toISOString());
    }

    const response = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.projectId}/issues?${params.toString()}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'listing issues');
    }

    const issuesData: unknown = await response.json();
    if (!Array.isArray(issuesData)) {
      throw new Error('Expected array of issues');
    }
    const issues = issuesData.filter(isGitLabIssue);
    return issues.map((issue) => this.convertIssueToWorkItem(issue as GitLabIssue));
  }

  private async listEpics(filter: WorkItemFilter): Promise<WorkItem[]> {
    const params = new URLSearchParams();

    if (filter.state) {
      params.append('state', filter.state === 'open' ? 'opened' : filter.state);
    }
    if (filter.labels && filter.labels.length > 0) {
      params.append('labels', filter.labels.join(','));
    }

    const response = await fetch(
      `${this.baseUrl}/api/v4/groups/${this.groupId}/epics?${params.toString()}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'listing epics');
    }

    const epicsData: unknown = await response.json();
    if (!Array.isArray(epicsData)) {
      throw new Error('Expected array of epics');
    }
    const epics = epicsData.filter(isGitLabEpic);
    return epics.map((epic) => this.convertEpicToWorkItem(epic as GitLabEpic));
  }

  async createWorkItem(data: CreateWorkItemData): Promise<WorkItem> {
    this.ensureInitialized();
    this.validateCreateData(data);

    if (data.type === 'epic') {
      return this.createEpic(data);
    } else {
      return this.createIssue(data);
    }
  }

  private async createIssue(data: CreateWorkItemData): Promise<WorkItem> {
    if (!this.projectId) {
      throw new Error('Project ID is required for issue creation');
    }

    const payload = {
      title: data.title,
      description: data.description,
      issue_type: this.mapWorkItemTypeToGitLab(data.type),
      assignee_ids: data.assignees?.map((a) => parseInt(a.id)) ?? [],
      labels: data.labels?.join(',') ?? '',
      milestone_id: data.milestone?.id ? parseInt(data.milestone.id) : undefined,
      due_date: data.dueDate?.toISOString().split('T')[0],
      confidential: data.confidential ?? false,
      weight: data.customFields?.weight as number,
    };

    const response = await fetch(`${this.baseUrl}/api/v4/projects/${this.projectId}/issues`, {
      method: 'POST',
      headers: this.createAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.handleHttpError(response, 'creating issue');
    }

    const issueData: unknown = await response.json();
    if (!isGitLabIssue(issueData)) {
      throw new Error('Invalid GitLab issue response');
    }
    return this.convertIssueToWorkItem(issueData as GitLabIssue);
  }

  private async createEpic(data: CreateWorkItemData): Promise<WorkItem> {
    if (!this.groupId) {
      throw new Error('Group ID is required for epic creation');
    }

    const payload = {
      title: data.title,
      description: data.description,
      labels: data.labels?.join(',') ?? '',
      due_date: data.dueDate?.toISOString().split('T')[0],
      start_date: data.customFields?.startDate as string,
    };

    const response = await fetch(`${this.baseUrl}/api/v4/groups/${this.groupId}/epics`, {
      method: 'POST',
      headers: this.createAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.handleHttpError(response, 'creating epic');
    }

    const epicData: unknown = await response.json();
    if (!isGitLabEpic(epicData)) {
      throw new Error('Invalid GitLab epic response');
    }
    return this.convertEpicToWorkItem(epicData as GitLabEpic);
  }

  async updateWorkItem(id: string, updates: UpdateWorkItemData): Promise<WorkItem> {
    this.ensureInitialized();

    const [type, itemId] = this.parseWorkItemId(id);

    if (type === 'epic') {
      return this.updateEpic(itemId, updates);
    } else {
      return this.updateIssue(itemId, updates);
    }
  }

  private async updateIssue(iid: string, updates: UpdateWorkItemData): Promise<WorkItem> {
    if (!this.projectId) {
      throw new Error('Project ID is required for issue updates');
    }

    interface GitLabUpdatePayload {
      title?: string;
      description?: string;
      state_event?: 'close' | 'reopen';
      assignee_ids?: number[];
      labels?: string;
      milestone_id?: number;
      due_date?: string;
    }

    const payload: GitLabUpdatePayload = {};

    if (updates.title) payload.title = updates.title;
    if (updates.description) payload.description = updates.description;
    if (updates.state) payload.state_event = updates.state === 'closed' ? 'close' : 'reopen';
    if (updates.assignees) payload.assignee_ids = updates.assignees.map((a) => parseInt(a.id));
    if (updates.labels) payload.labels = updates.labels.join(',');
    if (updates.milestone) payload.milestone_id = parseInt(updates.milestone.id);
    if (updates.dueDate) payload.due_date = updates.dueDate.toISOString().split('T')[0];

    const response = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.projectId}/issues/${iid}`,
      {
        method: 'PUT',
        headers: this.createAuthHeaders(),
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `updating issue ${iid}`);
    }

    const issueData: unknown = await response.json();
    if (!isGitLabIssue(issueData)) {
      throw new Error('Invalid GitLab issue response');
    }
    return this.convertIssueToWorkItem(issueData as GitLabIssue);
  }

  private async updateEpic(iid: string, updates: UpdateWorkItemData): Promise<WorkItem> {
    if (!this.groupId) {
      throw new Error('Group ID is required for epic updates');
    }

    interface GitLabEpicUpdatePayload {
      title?: string;
      description?: string;
      state_event?: 'close' | 'reopen';
      labels?: string;
      due_date?: string;
    }

    const payload: GitLabEpicUpdatePayload = {};

    if (updates.title) payload.title = updates.title;
    if (updates.description) payload.description = updates.description;
    if (updates.state) payload.state_event = updates.state === 'closed' ? 'close' : 'reopen';
    if (updates.labels) payload.labels = updates.labels.join(',');
    if (updates.dueDate) payload.due_date = updates.dueDate.toISOString().split('T')[0];

    const response = await fetch(`${this.baseUrl}/api/v4/groups/${this.groupId}/epics/${iid}`, {
      method: 'PUT',
      headers: this.createAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.handleHttpError(response, `updating epic ${iid}`);
    }

    const epicData: unknown = await response.json();
    if (!isGitLabEpic(epicData)) {
      throw new Error('Invalid GitLab epic response');
    }
    return this.convertEpicToWorkItem(epicData as GitLabEpic);
  }

  async deleteWorkItem(id: string): Promise<void> {
    this.ensureInitialized();

    const [type, itemId] = this.parseWorkItemId(id);

    if (type === 'epic') {
      await this.deleteEpic(itemId);
    } else {
      await this.deleteIssue(itemId);
    }
  }

  private async deleteIssue(iid: string): Promise<void> {
    if (!this.projectId) {
      throw new Error('Project ID is required for issue deletion');
    }

    const response = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.projectId}/issues/${iid}`,
      {
        method: 'DELETE',
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `deleting issue ${iid}`);
    }
  }

  private async deleteEpic(iid: string): Promise<void> {
    if (!this.groupId) {
      throw new Error('Group ID is required for epic deletion');
    }

    const response = await fetch(`${this.baseUrl}/api/v4/groups/${this.groupId}/epics/${iid}`, {
      method: 'DELETE',
      headers: this.createAuthHeaders(),
    });

    if (!response.ok) {
      this.handleHttpError(response, `deleting epic ${iid}`);
    }
  }

  async search(query: string): Promise<WorkItem[]> {
    this.ensureInitialized();

    const workItems: WorkItem[] = [];

    // Search issues
    if (this.projectId) {
      const issueResults = await this.searchIssues(query);
      workItems.push(...issueResults);
    }

    // Search epics (if group available)
    if (this.groupId) {
      const epicResults = await this.searchEpics(query);
      workItems.push(...epicResults);
    }

    return workItems;
  }

  private async searchIssues(query: string): Promise<WorkItem[]> {
    const response = await fetch(
      `${this.baseUrl}/api/v4/projects/${this.projectId}/search?scope=issues&search=${encodeURIComponent(query)}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'searching issues');
    }

    const issuesData: unknown = await response.json();
    if (!Array.isArray(issuesData)) {
      throw new Error('Expected array of issues');
    }
    const issues = issuesData.filter(isGitLabIssue);
    return issues.map((issue) => this.convertIssueToWorkItem(issue as GitLabIssue));
  }

  private async searchEpics(query: string): Promise<WorkItem[]> {
    const response = await fetch(
      `${this.baseUrl}/api/v4/groups/${this.groupId}/search?scope=epics&search=${encodeURIComponent(query)}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'searching epics');
    }

    const epicsData: unknown = await response.json();
    if (!Array.isArray(epicsData)) {
      throw new Error('Expected array of epics');
    }
    const epics = epicsData.filter(isGitLabEpic);
    return epics.map((epic) => this.convertEpicToWorkItem(epic as GitLabEpic));
  }

  async executeQuery(query: string): Promise<WorkItem[]> {
    // For GitLab, we'll implement basic query parsing
    // This could be enhanced with more sophisticated query parsing
    return this.search(query);
  }

  getCapabilities(): ProviderCapabilities {
    // Detect capabilities based on license (would need API call in real implementation)
    return {
      supportsEpics: Boolean(this.groupId), // Epics require group
      supportsIterations: true, // GitLab has iterations
      supportsMilestones: true,
      supportsMultipleAssignees: true, // GitLab supports multiple assignees
      supportsConfidential: true,
      supportsWeight: true,
      supportsTimeTracking: true,
      supportsCustomFields: false, // Limited custom field support
      maxAssignees: 100,
      hierarchyLevels: 3, // Epic → Issue → Task
      customWorkItemTypes: ['issue', 'task', 'incident', 'test_case'],
    };
  }

  // Helper methods

  private parseWorkItemId(id: string): [string, string] {
    // Expected format: gitlab:project/group#type:id or gitlab:type:id
    const parts = id.split(':');
    if (parts.length >= 3 && parts[2].includes('#')) {
      const [, typeAndId] = parts[2].split('#');
      const [type, itemId] = typeAndId.split(':');
      return [type, itemId];
    } else if (parts.length >= 2) {
      return ['issue', parts[1]]; // Default to issue
    }
    throw new Error(`Invalid GitLab work item ID format: ${id}`);
  }

  private convertIssueToWorkItem(issue: GitLabIssue): WorkItem {
    const gitlabFields: GitLabSpecificFields = {
      iid: issue.iid,
      projectId: issue.project_id,
      weight: issue.weight,
      timeEstimate: issue.time_stats.time_estimate,
      timeSpent: issue.time_stats.total_time_spent,
      confidential: issue.confidential,
      discussionLocked: issue.discussion_locked,
      epicId: issue.epic?.id,
      healthStatus: issue.health_status,
      issueType: issue.issue_type,
    };

    return {
      id: `gitlab:${this.projectId}#issue:${issue.iid}`,
      provider: 'gitlab',
      type: this.mapGitLabTypeToWorkItem(issue.issue_type),
      title: issue.title,
      description: issue.description || '',
      state: issue.state === 'opened' ? 'open' : 'closed',
      author: this.convertGitLabUser(issue.author),
      assignees: issue.assignees.map((a) => this.convertGitLabUser(a)),
      labels: issue.labels,
      milestone: issue.milestone ? this.convertGitLabMilestone(issue.milestone) : undefined,
      priority: this.extractPriorityFromLabels(issue.labels),
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
      dueDate: issue.due_date ? new Date(issue.due_date) : undefined,
      providerFields: gitlabFields,
    };
  }

  private convertEpicToWorkItem(epic: GitLabEpic): WorkItem {
    const gitlabFields: GitLabSpecificFields = {
      iid: epic.iid,
      projectId: epic.group_id, // For epics, group_id is stored here
      issueType: 'issue', // Epics don't have issue_type
    };

    return {
      id: `gitlab:${this.groupId}#epic:${epic.iid}`,
      provider: 'gitlab',
      type: 'epic',
      title: epic.title,
      description: epic.description || '',
      state: epic.state === 'opened' ? 'open' : 'closed',
      author: this.convertGitLabUser(epic.author),
      assignees: [], // Epics don't have assignees
      labels: epic.labels,
      priority: this.extractPriorityFromLabels(epic.labels),
      createdAt: new Date(epic.created_at),
      updatedAt: new Date(epic.updated_at),
      closedAt: epic.closed_at ? new Date(epic.closed_at) : undefined,
      dueDate: epic.due_date ? new Date(epic.due_date) : undefined,
      providerFields: gitlabFields,
    };
  }

  private convertGitLabUser(gitlabUser: {
    id: number;
    username: string;
    name: string;
    email?: string;
  }): User {
    return {
      id: gitlabUser.id.toString(),
      username: gitlabUser.username,
      displayName: gitlabUser.name,
      email: gitlabUser.email,
      provider: 'gitlab',
    };
  }

  private convertGitLabMilestone(milestone: {
    id: number;
    title: string;
    description?: string;
    state: string;
    due_date?: string;
    start_date?: string;
  }): Milestone {
    return {
      id: milestone.id.toString(),
      title: milestone.title,
      description: milestone.description,
      startDate: milestone.start_date ? new Date(milestone.start_date) : undefined,
      dueDate: milestone.due_date ? new Date(milestone.due_date) : undefined,
      state: milestone.state === 'active' ? 'open' : 'closed',
      provider: 'gitlab',
    };
  }

  private mapWorkItemTypeToGitLab(type: WorkItemType): 'issue' | 'incident' | 'test_case' | 'task' {
    const typeMap: Record<WorkItemType, 'issue' | 'incident' | 'test_case' | 'task'> = {
      epic: 'issue', // Epics are handled separately
      feature: 'issue',
      story: 'issue',
      bug: 'incident',
      task: 'task',
      test: 'test_case',
      issue: 'issue',
    };

    return typeMap[type];
  }

  private mapGitLabTypeToWorkItem(
    gitlabType: 'issue' | 'incident' | 'test_case' | 'task',
  ): WorkItemType {
    const typeMap: Record<string, WorkItemType> = {
      issue: 'issue',
      incident: 'bug',
      test_case: 'test',
      task: 'task',
    };

    return typeMap[gitlabType] ?? 'issue';
  }

  private extractPriorityFromLabels(labels: string[]): Priority {
    const priorityLabels: Partial<Record<string, Priority>> = {
      critical: 'critical',
      high: 'high',
      medium: 'medium',
      low: 'low',
      'priority::critical': 'critical',
      'priority::high': 'high',
      'priority::medium': 'medium',
      'priority::low': 'low',
    };

    for (const label of labels) {
      const priority = priorityLabels[label.toLowerCase()];
      if (priority !== undefined) return priority;
    }

    return 'medium'; // Default priority
  }
}
