import { ProviderManager } from '../providers/ProviderManager.js';
import { WorkItem, ProviderAPIResponse, Priority } from '../types/index.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent, isProviderAPIResponse, isLabelLike } from '../utils/typeGuards.js';
import { CacheManager, ProjectCacheData, UserRole } from '../cache/CacheManager.js';
export class WorkItemsManager {
  private cacheManager: CacheManager;

  constructor(
    protected providerManager: ProviderManager,
    cacheManager?: CacheManager,
  ) {
    this.cacheManager = cacheManager ?? new CacheManager();

    // Set up cache refresh callback
    this.cacheManager.onCacheExpired = (cacheKey: string) => {
      void this.handleCacheExpired(cacheKey);
    };
  }

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listWorkItems(project?: string, filters?: Record<string, unknown>): Promise<WorkItem[]> {
    const workItems: WorkItem[] = [];

    if (project) {
      // Check if project has provider prefix (contains ':')
      if (project.includes(':')) {
        // Handle project with provider prefix
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
        // Handle project without provider prefix - search across all providers
        process.stderr.write(`Searching for project "${project}" across all providers...\n`);

        for (const provider of this.providerManager.getAllProviders()) {
          if (provider.status !== 'connected') continue;

          const listTools = ['list_issues', 'list_work_items', 'list_tasks'];

          for (const toolSuffix of listTools) {
            const toolName = `${provider.id}_${toolSuffix}`;
            if (provider.tools.has(toolName)) {
              try {
                // Search with project as a filter parameter
                const searchFilters = {
                  ...filters,
                  project: project,
                  project_path: project,
                  repository: project,
                  repo: project,
                };

                const result = await this.providerManager.callTool(toolName, searchFilters);

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
              } catch {
                // Continue to next provider on error - project might not exist in this provider
                process.stderr.write(`No results from ${provider.id} for project "${project}"\n`);
              }
            }
          }
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
      try {
        const createdItem: unknown = JSON.parse(createdItemJson);

        if (isProviderAPIResponse(createdItem)) {
          return this.normalizeWorkItem(createdItem, provider);
        }
      } catch {
        throw new Error('Failed to create work item');
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

  denormalizeWorkItem(
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

  normalizeType(type: string): WorkItem['type'] {
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

  normalizeState(status: string): 'open' | 'closed' {
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

  denormalizeState(state: 'open' | 'closed', provider: string): string {
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

  normalizeAssignees(item: ProviderAPIResponse): import('../types/index.js').User[] {
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

  normalizeAuthor(_item: ProviderAPIResponse): import('../types/index.js').User {
    // Default author - in real implementation this would come from the API response
    return this.createUser('unknown', 'Unknown User');
  }

  createUser(username: string, displayName: string): import('../types/index.js').User {
    return {
      id: username,
      username,
      displayName,
      provider: 'gitlab' as const, // Will be set properly in real implementation
    };
  }

  createProviderFields(
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

  normalizeLabels(item: ProviderAPIResponse): string[] {
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

  async searchProjects(query?: string): Promise<ProjectCacheData[]> {
    // Try to use cached data first
    const cachedResults = this.cacheManager.searchProjects(query);
    if (cachedResults.length > 0) {
      process.stderr.write(`[cache] Serving ${cachedResults.length} projects from cache\n`);
      return cachedResults;
    }

    // If no cache or cache is empty, fetch fresh data
    process.stderr.write('[cache] No cached projects found, fetching fresh data...\n');

    const projects: ProjectCacheData[] = [];

    for (const provider of this.providerManager.getAllProviders()) {
      if (provider.status !== 'connected') continue;

      // Check if we have valid cache for this provider
      if (this.cacheManager.hasValidCache(provider.id, 'projects')) {
        const cached = this.cacheManager.getProjects(provider.id);
        if (cached) {
          projects.push(...cached);
          continue; // Skip API call for this provider
        }
      }

      // Fetch fresh data for this provider
      const providerProjects = await this.fetchProjectsFromProvider(provider.id);
      projects.push(...providerProjects);

      // Cache the results for this provider
      this.cacheManager.setProjects(provider.id, providerProjects);
    }

    // Apply query filter if provided
    if (query) {
      const searchTerm = query.toLowerCase();
      return projects.filter(
        (project) =>
          project.name.toLowerCase().includes(searchTerm) ||
          project.id.toLowerCase().includes(searchTerm) ||
          project.description?.toLowerCase().includes(searchTerm),
      );
    }

    return projects;
  }

  /**
   * Fetch projects from a specific provider (used for cache warming)
   */
  async fetchProjectsFromProvider(providerId: string): Promise<ProjectCacheData[]> {
    const provider = this.providerManager.getProvider(providerId);
    if (!provider || provider.status !== 'connected') {
      return [];
    }

    const projects: ProjectCacheData[] = [];

    // Try different project listing tools based on provider
    const projectTools = [
      'search_repositories', // GitHub has this
      'list_repositories',
      'list_projects',
      'get_repositories',
      'list_user_repositories',
      'list_org_repositories',
    ];

    for (const toolSuffix of projectTools) {
      const toolName = `${providerId}_${toolSuffix}`;
      if (provider.tools.has(toolName)) {
        try {
          // Prepare parameters based on tool type
          let toolParams = {};
          if (toolName.includes('search_repositories')) {
            // GitHub search_repositories requires a query parameter
            toolParams = { query: 'stars:>0' }; // Search for public repositories with stars
          }

          const result = await this.providerManager.callTool(toolName, toolParams);

          if (hasTextContent(result)) {
            const projectsJson = result.content[0].text;
            const parsedProjects: unknown = JSON.parse(projectsJson);

            // Handle both array responses and GitHub-style object responses
            let projectArray: unknown[] = [];
            if (Array.isArray(parsedProjects)) {
              projectArray = parsedProjects;
            } else if (typeof parsedProjects === 'object' && parsedProjects !== null) {
              // GitHub search API returns { items: [...], total_count: number }
              const searchResult = parsedProjects as Record<string, unknown>;
              if (Array.isArray(searchResult.items)) {
                projectArray = searchResult.items;
              }
            }

            if (projectArray.length > 0) {
              for (const project of projectArray) {
                if (typeof project === 'object' && project !== null) {
                  const proj = project as Record<string, unknown>;
                  const projectId =
                    typeof proj.full_name === 'string'
                      ? proj.full_name
                      : typeof proj.path_with_namespace === 'string'
                        ? proj.path_with_namespace
                        : typeof proj.name === 'string'
                          ? proj.name
                          : typeof proj.id === 'string' || typeof proj.id === 'number'
                            ? String(proj.id)
                            : '';
                  const projectName =
                    typeof proj.name === 'string'
                      ? proj.name
                      : typeof proj.title === 'string'
                        ? proj.title
                        : projectId;

                  if (projectId && projectName) {
                    // Also fetch project members if available
                    const members = await this.fetchProjectMembers(providerId, projectId);

                    projects.push({
                      id: `${providerId}:${projectId}`,
                      name: projectName,
                      provider: providerId,
                      description:
                        typeof proj.description === 'string' ? proj.description : undefined,
                      url:
                        typeof proj.html_url === 'string'
                          ? proj.html_url
                          : typeof proj.web_url === 'string'
                            ? proj.web_url
                            : undefined,
                      members,
                    });
                  }
                }
              }
            }
          }
          break; // Found a working tool for this provider
        } catch {
          // Continue to next tool
          continue;
        }
      }
    }

    return projects;
  }

  /**
   * Fetch project members for a specific project
   */
  async fetchProjectMembers(providerId: string, projectPath: string): Promise<UserRole[]> {
    const provider = this.providerManager.getProvider(providerId);
    if (!provider || provider.status !== 'connected') {
      return [];
    }

    const memberTools = [
      'list_project_members',
      'get_project_members',
      'list_collaborators',
      'get_collaborators',
      'list_team_members',
    ];

    for (const toolSuffix of memberTools) {
      const toolName = `${providerId}_${toolSuffix}`;
      if (provider.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            project: projectPath,
            project_id: projectPath,
            repo: projectPath,
            repository: projectPath,
          });

          if (hasTextContent(result)) {
            const membersJson = result.content[0].text;
            const parsedMembers: unknown = JSON.parse(membersJson);

            if (Array.isArray(parsedMembers)) {
              return parsedMembers.map((member) => {
                const mem = member as Record<string, unknown>;
                return {
                  userId: String(mem.id ?? mem.user_id ?? mem.username),
                  username: String(mem.username ?? mem.login ?? mem.name),
                  displayName: String(mem.name ?? mem.display_name ?? mem.username ?? mem.login),
                  email: typeof mem.email === 'string' ? mem.email : undefined,
                  role:
                    typeof mem.role === 'string'
                      ? mem.role
                      : typeof mem.permission === 'string'
                        ? mem.permission
                        : typeof mem.access_level === 'string'
                          ? mem.access_level
                          : 'member',
                  accessLevel: typeof mem.access_level === 'number' ? mem.access_level : undefined,
                } as UserRole;
              });
            }
          }
          break; // Found a working tool
        } catch {
          // Continue to next tool
          continue;
        }
      }
    }

    return []; // No members found or no working tool
  }

  /**
   * Handle cache expiration - trigger refresh
   */
  private async handleCacheExpired(cacheKey: string): Promise<void> {
    const [type, provider] = cacheKey.split(':');

    if (type === 'projects') {
      process.stderr.write(`[cache] Refreshing projects cache for ${provider}...\n`);
      try {
        const projects = await this.fetchProjectsFromProvider(provider);
        this.cacheManager.setProjects(provider, projects);
      } catch (error) {
        process.stderr.write(
          `[cache] Failed to refresh projects for ${provider}: ${String(error)}\n`,
        );
      }
    } else if (type === 'users') {
      process.stderr.write(`[cache] Refreshing users cache for ${provider}...\n`);
      try {
        const users = await this.fetchUsersFromProvider(provider);
        this.cacheManager.setUsers(provider, users);
      } catch (error) {
        process.stderr.write(`[cache] Failed to refresh users for ${provider}: ${String(error)}\n`);
      }
    }
  }

  /**
   * Fetch users from a specific provider (used for cache warming)
   */
  async fetchUsersFromProvider(providerId: string): Promise<UserRole[]> {
    const provider = this.providerManager.getProvider(providerId);
    if (!provider || provider.status !== 'connected') {
      return [];
    }

    const users: UserRole[] = [];

    // Try different user listing tools based on provider
    const userTools = [
      'search_users', // GitHub has this
      'list_users',
      'get_users',
      'list_org_members',
      'get_org_members',
      'list_team_members',
    ];

    for (const toolSuffix of userTools) {
      const toolName = `${providerId}_${toolSuffix}`;
      if (provider.tools.has(toolName)) {
        try {
          // Prepare parameters based on tool type
          let toolParams = {};
          if (toolName.includes('search_users')) {
            // GitHub search_users requires a q parameter
            toolParams = { q: 'type:user' }; // Search for users
          }

          const result = await this.providerManager.callTool(toolName, toolParams);

          if (hasTextContent(result)) {
            const usersJson = result.content[0].text;
            const parsedUsers: unknown = JSON.parse(usersJson);

            // Handle both array responses and GitHub-style object responses
            let userArray: unknown[] = [];
            if (Array.isArray(parsedUsers)) {
              userArray = parsedUsers;
            } else if (typeof parsedUsers === 'object' && parsedUsers !== null) {
              // GitHub search API returns { items: [...], total_count: number }
              const searchResult = parsedUsers as Record<string, unknown>;
              if (Array.isArray(searchResult.items)) {
                userArray = searchResult.items;
              }
            }

            if (userArray.length > 0) {
              for (const user of userArray) {
                if (typeof user === 'object' && user !== null) {
                  const usr = user as Record<string, unknown>;
                  users.push({
                    userId: String(usr.id ?? usr.user_id ?? usr.username),
                    username: String(usr.username ?? usr.login ?? usr.name),
                    displayName: String(usr.name ?? usr.display_name ?? usr.username ?? usr.login),
                    email: typeof usr.email === 'string' ? usr.email : undefined,
                    role:
                      typeof usr.role === 'string'
                        ? usr.role
                        : typeof usr.permission === 'string'
                          ? usr.permission
                          : typeof usr.access_level === 'string'
                            ? usr.access_level
                            : 'member',
                    accessLevel:
                      typeof usr.access_level === 'number' ? usr.access_level : undefined,
                  });
                }
              }
            }
          }
          break; // Found a working tool for this provider
        } catch {
          // Continue to next tool
          continue;
        }
      }
    }

    return users;
  }

  /**
   * Search users across all providers (with caching)
   */
  async searchUsers(query?: string): Promise<UserRole[]> {
    // Try to use cached data first
    const cachedResults = this.cacheManager.searchUsers(query);
    if (cachedResults.length > 0) {
      process.stderr.write(`[cache] Serving ${cachedResults.length} users from cache\n`);
      return cachedResults;
    }

    // If no cache or cache is empty, fetch fresh data
    process.stderr.write('[cache] No cached users found, fetching fresh data...\n');

    const users: UserRole[] = [];

    for (const provider of this.providerManager.getAllProviders()) {
      if (provider.status !== 'connected') continue;

      // Check if we have valid cache for this provider
      if (this.cacheManager.hasValidCache(provider.id, 'users')) {
        const cached = this.cacheManager.getUsers(provider.id);
        if (cached) {
          users.push(...cached);
          continue; // Skip API call for this provider
        }
      }

      // Fetch fresh data for this provider
      const providerUsers = await this.fetchUsersFromProvider(provider.id);
      users.push(...providerUsers);

      // Cache the results for this provider
      this.cacheManager.setUsers(provider.id, providerUsers);
    }

    // Apply query filter if provided
    if (query) {
      const searchTerm = query.toLowerCase();
      return users.filter(
        (user) =>
          user.username.toLowerCase().includes(searchTerm) ||
          user.displayName.toLowerCase().includes(searchTerm) ||
          user.email?.toLowerCase().includes(searchTerm),
      );
    }

    return users;
  }

  /**
   * Get users for a specific project (from cache)
   */
  getProjectUsers(projectId: string): UserRole[] {
    return this.cacheManager.getProjectUsers(projectId);
  }

  /**
   * Warm up caches for all connected providers
   */
  async warmupCaches(): Promise<void> {
    process.stderr.write('[cache] Starting cache warmup...\n');

    const providers = this.providerManager
      .getAllProviders()
      .filter((p) => p.status === 'connected');

    // Warm up projects and users in parallel for each provider
    const warmupPromises = providers.map(async (provider) => {
      try {
        // Warm up projects cache
        process.stderr.write(`[cache] Warming up projects for ${provider.id}...\n`);
        const projects = await this.fetchProjectsFromProvider(provider.id);
        this.cacheManager.setProjects(provider.id, projects);

        // Warm up users cache
        process.stderr.write(`[cache] Warming up users for ${provider.id}...\n`);
        const users = await this.fetchUsersFromProvider(provider.id);
        this.cacheManager.setUsers(provider.id, users);

        process.stderr.write(`[cache] Warmup completed for ${provider.id}\n`);
      } catch (error) {
        process.stderr.write(`[cache] Warmup failed for ${provider.id}: ${String(error)}\n`);
      }
    });

    await Promise.all(warmupPromises);
    process.stderr.write('[cache] Cache warmup completed for all providers\n');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cacheManager.getStats();
  }

  /**
   * Get cache manager instance (for external use)
   */
  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_search_projects',
        description:
          'FIRST STEP: Search for projects/repositories across all providers when you need to find a project by partial name. This returns full project paths with provider prefixes (e.g., "gitlab:lantec/uscribe/recipes") that you can then use with nexus_list_work_items. ALWAYS use this first when user mentions project names like "recipes", "backend", etc. Results are cached for 15 minutes.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Optional search query to filter projects by name or description. If omitted, lists all available projects.',
            },
          },
        },
      },
      {
        name: 'nexus_search_users',
        description:
          'Search for users across all configured providers. Returns user information including roles and access levels in projects. Results are cached for 15 minutes.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Optional search query to filter users by username, display name, or email. If omitted, lists all available users.',
            },
          },
        },
      },
      {
        name: 'nexus_get_project_users',
        description:
          'Get users/members for a specific project. Returns cached user data with their roles in the project.',
        inputSchema: {
          type: 'object',
          required: ['project_id'],
          properties: {
            project_id: {
              type: 'string',
              description:
                'Project identifier in format "provider:project_path" (e.g., "gitlab:myorg/myproject")',
            },
          },
        },
      },
      {
        name: 'nexus_cache_stats',
        description:
          'Get cache statistics showing what data is cached and cache age/TTL information.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'nexus_list_work_items',
        description:
          'List work items (issues, tasks, etc.) from a SPECIFIC project. REQUIRES full project path with provider prefix (e.g., "gitlab:lantec/uscribe/backend", "github:microsoft/vscode"). IMPORTANT: If you only know partial project name (like "recipes" or "backend"), you MUST first use nexus_search_projects to find the full project path. DO NOT pass raw project names without provider prefix - this will cause errors. Examples of correct usage: project="gitlab:myorg/myrepo", project="github:owner/repo", project="azure:projectname".',
        inputSchema: {
          type: 'object',
          required: ['project'],
          properties: {
            project: {
              type: 'string',
              description:
                'REQUIRED: Project identifier with provider prefix (e.g., "github:owner/repo", "gitlab:group/project", "azure:projectname"). NEVER use raw project names like "recipes" or "backend" - use nexus_search_projects first to find the full path.',
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
