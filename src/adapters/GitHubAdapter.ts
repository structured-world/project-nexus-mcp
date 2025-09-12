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
  GitHubSpecificFields,
} from '../types/index.js';

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened';
  user: {
    id: number;
    login: string;
    avatar_url: string;
    type: string;
  };
  assignees: Array<{
    id: number;
    login: string;
    avatar_url: string;
  }>;
  labels: Array<{
    id: number;
    name: string;
    color: string;
    description?: string;
  }>;
  milestone?: {
    id: number;
    number: number;
    title: string;
    description?: string;
    state: 'open' | 'closed';
    due_on?: string;
    created_at: string;
  };
  created_at: string;
  updated_at: string;
  closed_at?: string;
  draft?: boolean;
  pull_request?: {
    url: string;
    html_url: string;
    diff_url: string;
    patch_url: string;
  };
  reactions: {
    total_count: number;
    '+1': number;
    '-1': number;
    laugh: number;
    hooray: number;
    confused: number;
    heart: number;
    rocket: number;
    eyes: number;
  };
  html_url: string;
  repository_url: string;
}

// GitHubUser interface removed - using inline type instead

export class GitHubAdapter extends BaseAdapter implements IProviderAdapter {
  private baseUrl = 'https://api.github.com';
  private owner!: string;
  private repo!: string;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;

    // Parse organization/project from config
    if (config.organization && config.project) {
      this.owner = config.organization;
      this.repo = config.project;
    } else if (config.project?.includes('/')) {
      [this.owner, this.repo] = config.project.split('/');
    } else {
      throw new Error(
        'GitHub adapter requires owner/repo format in organization+project or project fields',
      );
    }

    await this.validateConnection();
    this.initialized = true;
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/user`, {
        headers: this.createAuthHeaders(),
      });

      if (!response.ok) {
        this.handleHttpError(response, 'user validation');
      }

      return true;
    } catch (error) {
      throw new Error(
        `GitHub connection validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    this.ensureInitialized();

    const issueNumber = this.parseWorkItemId(id);

    const response = await fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `getting issue ${issueNumber}`);
    }

    const issue = (await response.json()) as GitHubIssue;
    return this.convertIssueToWorkItem(issue);
  }

  async listWorkItems(filter: WorkItemFilter): Promise<WorkItem[]> {
    this.ensureInitialized();

    const params = new URLSearchParams();

    if (filter.state) {
      params.append('state', filter.state);
    }
    if (filter.assignee) {
      params.append('assignee', filter.assignee);
    }
    if (filter.labels && filter.labels.length > 0) {
      params.append('labels', filter.labels.join(','));
    }
    if (filter.milestone) {
      params.append('milestone', filter.milestone);
    }
    if (filter.since) {
      params.append('since', filter.since.toISOString());
    }

    // Determine if we should include pull requests
    // GitHub treats pull requests as issues, but we can filter them out
    const includePullRequests = filter.type === 'feature' || filter.type === undefined;

    const response = await fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues?${params.toString()}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'listing issues');
    }

    const issues = (await response.json()) as GitHubIssue[];

    // Filter out pull requests if not requested
    const filteredIssues = includePullRequests
      ? issues
      : issues.filter((issue) => !issue.pull_request);

    return filteredIssues.map((issue) => this.convertIssueToWorkItem(issue));
  }

  async createWorkItem(data: CreateWorkItemData): Promise<WorkItem> {
    this.ensureInitialized();
    this.validateCreateData(data);

    // GitHub doesn't have native work item types, so we use labels to indicate type
    const labels = [...(data.labels ?? [])];
    const workItemTypeLabel = this.getTypeLabel(data.type);
    if (workItemTypeLabel && !labels.includes(workItemTypeLabel)) {
      labels.push(workItemTypeLabel);
    }

    // Add priority label if specified
    if (data.priority && data.priority !== 'medium') {
      const priorityLabel = `priority: ${data.priority}`;
      if (!labels.includes(priorityLabel)) {
        labels.push(priorityLabel);
      }
    }

    const payload = {
      title: data.title,
      body: data.description,
      assignees: data.assignees?.map((a) => a.username) ?? [],
      labels: labels,
      milestone: data.milestone?.id ? parseInt(data.milestone.id) : undefined,
    };

    const response = await fetch(`${this.baseUrl}/repos/${this.owner}/${this.repo}/issues`, {
      method: 'POST',
      headers: this.createAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      this.handleHttpError(response, 'creating issue');
    }

    const issue = (await response.json()) as GitHubIssue;
    return this.convertIssueToWorkItem(issue);
  }

  async updateWorkItem(id: string, updates: UpdateWorkItemData): Promise<WorkItem> {
    this.ensureInitialized();

    const issueNumber = this.parseWorkItemId(id);

    interface GitHubUpdatePayload {
      title?: string;
      body?: string;
      state?: string;
      assignees?: string[];
      labels?: string[];
      milestone?: number | null;
    }

    const payload: GitHubUpdatePayload = {};

    if (updates.title) payload.title = updates.title;
    if (updates.description) payload.body = updates.description;
    if (updates.state) payload.state = updates.state;
    if (updates.assignees) payload.assignees = updates.assignees.map((a) => a.username);
    if (updates.labels) payload.labels = updates.labels;
    if (updates.milestone) payload.milestone = parseInt(updates.milestone.id);

    const response = await fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      {
        method: 'PATCH',
        headers: this.createAuthHeaders(),
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, `updating issue ${issueNumber}`);
    }

    const issue = (await response.json()) as GitHubIssue;
    return this.convertIssueToWorkItem(issue);
  }

  async deleteWorkItem(id: string): Promise<void> {
    // GitHub doesn't support deleting issues via API
    // Instead, we close the issue and add a "deleted" label

    await this.updateWorkItem(id, {
      state: 'closed',
      labels: ['deleted', 'archived'],
    });
  }

  async search(query: string): Promise<WorkItem[]> {
    this.ensureInitialized();

    // Use GitHub's search API with repository scope
    const searchQuery = `repo:${this.owner}/${this.repo} ${query}`;
    const response = await fetch(
      `${this.baseUrl}/search/issues?q=${encodeURIComponent(searchQuery)}`,
      {
        headers: this.createAuthHeaders(),
      },
    );

    if (!response.ok) {
      this.handleHttpError(response, 'searching issues');
    }

    const searchResult = (await response.json()) as { items?: GitHubIssue[] };
    const issues: GitHubIssue[] = searchResult.items ?? [];

    return issues.map((issue) => this.convertIssueToWorkItem(issue));
  }

  async executeQuery(query: string): Promise<WorkItem[]> {
    // GitHub search supports advanced query syntax
    return this.search(query);
  }

  async linkWorkItems(parent: string, child: string, linkType: string): Promise<void> {
    // GitHub doesn't have native linking, but we can simulate with comments and labels
    const parentNumber = this.parseWorkItemId(parent);
    const childNumber = this.parseWorkItemId(child);

    // Add comment to parent referencing child
    const commentBody = `Related ${linkType}: #${childNumber}`;
    await fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${parentNumber}/comments`,
      {
        method: 'POST',
        headers: this.createAuthHeaders(),
        body: JSON.stringify({ body: commentBody }),
      },
    );

    // Add comment to child referencing parent
    const childCommentBody = `${linkType === 'blocks' ? 'Blocked by' : 'Related to'}: #${parentNumber}`;
    await fetch(`${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${childNumber}/comments`, {
      method: 'POST',
      headers: this.createAuthHeaders(),
      body: JSON.stringify({ body: childCommentBody }),
    });
  }

  async unlinkWorkItems(parent: string, child: string): Promise<void> {
    // In a real implementation, we would need to find and remove the linking comments
    // For now, we'll add a comment indicating the unlink
    const parentNumber = this.parseWorkItemId(parent);
    const childNumber = this.parseWorkItemId(child);

    const commentBody = `Unlinked from #${childNumber}`;
    await fetch(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${parentNumber}/comments`,
      {
        method: 'POST',
        headers: this.createAuthHeaders(),
        body: JSON.stringify({ body: commentBody }),
      },
    );
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsEpics: false, // Can simulate with parent issues
      supportsIterations: false, // Can use milestones
      supportsMilestones: true,
      supportsMultipleAssignees: true,
      supportsConfidential: false,
      supportsWeight: false,
      supportsTimeTracking: false,
      supportsCustomFields: true, // Through Projects Beta
      maxAssignees: 10,
      hierarchyLevels: 2,
      customWorkItemTypes: ['issue'],
    };
  }

  // Helper methods

  private parseWorkItemId(id: string): string {
    // Expected format: github:owner/repo#number or github:number
    const parts = id.split(':');
    if (parts.length >= 2) {
      const idPart = parts[parts.length - 1];
      return idPart.includes('#') ? idPart.split('#')[1] : idPart;
    }
    throw new Error(`Invalid GitHub work item ID format: ${id}`);
  }

  private convertIssueToWorkItem(issue: GitHubIssue): WorkItem {
    const githubFields: GitHubSpecificFields = {
      number: issue.number,
      repository: `${this.owner}/${this.repo}`,
      stateReason: issue.state_reason,
      reactions: issue.reactions,
      isDraft: issue.draft,
    };

    return {
      id: `github:${this.owner}/${this.repo}#${issue.number}`,
      provider: 'github',
      type: this.detectWorkItemType(issue),
      title: issue.title,
      description: issue.body ?? '',
      state: issue.state,
      author: this.convertGitHubUser(issue.user),
      assignees: issue.assignees.map((a) => this.convertGitHubUser(a)),
      labels: issue.labels.map((label) => label.name),
      milestone: issue.milestone ? this.convertGitHubMilestone(issue.milestone) : undefined,
      priority: this.extractPriorityFromLabels(issue.labels.map((l) => l.name)),
      createdAt: new Date(issue.created_at),
      updatedAt: new Date(issue.updated_at),
      closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
      providerFields: githubFields,
    };
  }

  private convertGitHubUser(githubUser: {
    id: number;
    login: string;
    name?: string;
    email?: string;
  }): User {
    return {
      id: githubUser.id.toString(),
      username: githubUser.login,
      displayName: githubUser.name ?? githubUser.login,
      email: githubUser.email,
      provider: 'github',
    };
  }

  private convertGitHubMilestone(milestone: {
    id: number;
    number: number;
    title: string;
    description?: string;
    state: string;
    due_on?: string;
    created_at: string;
  }): Milestone {
    return {
      id: milestone.id.toString(),
      title: milestone.title,
      description: milestone.description,
      dueDate: milestone.due_on ? new Date(milestone.due_on) : undefined,
      state: milestone.state as 'open' | 'closed',
      provider: 'github',
    };
  }

  private detectWorkItemType(issue: GitHubIssue): WorkItemType {
    const labels = issue.labels.map((l) => l.name.toLowerCase());

    // Check for type labels
    if (labels.includes('epic')) return 'epic';
    if (labels.includes('bug')) return 'bug';
    if (labels.includes('task')) return 'task';
    if (labels.includes('enhancement')) return 'story';
    if (labels.includes('feature')) return 'feature';
    if (labels.includes('test')) return 'test';

    // Check if it's a pull request
    if (issue.pull_request) return 'feature';

    // Check for parent-child pattern (epic simulation)
    if (issue.body && issue.body.includes('- [ ]') && issue.body.split('- [ ]').length > 3) {
      return 'epic';
    }

    return 'issue'; // Default
  }

  private getTypeLabel(type: WorkItemType): string | null {
    const typeLabelMap: Record<WorkItemType, string> = {
      epic: 'epic',
      feature: 'enhancement',
      story: 'enhancement',
      bug: 'bug',
      task: 'task',
      test: 'test',
      issue: '', // No specific label for generic issues
    };

    return typeLabelMap[type] || null;
  }

  private extractPriorityFromLabels(labels: string[]): Priority {
    const priorityPatterns: Array<{ pattern: RegExp; priority: Priority }> = [
      { pattern: /priority:\s*critical|critical/i, priority: 'critical' },
      { pattern: /priority:\s*high|high/i, priority: 'high' },
      { pattern: /priority:\s*low|low/i, priority: 'low' },
      { pattern: /priority:\s*medium|medium/i, priority: 'medium' },
    ];

    for (const label of labels) {
      for (const { pattern, priority } of priorityPatterns) {
        if (pattern.test(label)) {
          return priority;
        }
      }
    }

    return 'medium'; // Default priority
  }

  protected createAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Project-Nexus-MCP/1.0',
    };
  }
}
