import { ProviderManager } from '../providers/ProviderManager.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent } from '../utils/typeGuards.js';

// Provider-specific interfaces removed - using Record<string, unknown> for flexibility

export interface MergeRequest {
  id: string;
  number: number;
  title: string;
  description?: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  draft: boolean;
  mergeable?: boolean;
  provider: string;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string;
}

export interface MergeRequestReview {
  id: string;
  user: string;
  state: 'approved' | 'requested_changes' | 'commented';
  body?: string;
  provider: string;
  createdAt?: string;
}

export class MergeRequestManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listMergeRequests(
    project: string,
    repositoryName: string,
    filters?: Record<string, unknown>,
  ): Promise<MergeRequest[]> {
    const provider = this.detectProviderFromProject(project);

    if (provider && provider !== '') {
      // Single provider operation
      return this.listMergeRequestsFromProvider(
        provider,
        project.split(':')[1],
        repositoryName,
        filters,
      );
    } else {
      // Parallel operation across all providers
      const providers = this.providerManager
        .getAllProviders()
        .filter((p) => p.status === 'connected');

      const promises = providers.map(async (providerInstance) => {
        try {
          return await this.listMergeRequestsFromProvider(
            providerInstance.id,
            repositoryName, // Use repo name as owner for multi-provider search
            repositoryName,
            filters,
          );
        } catch (error) {
          console.error(
            `Error listing merge requests from ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });

      const results = await Promise.allSettled(promises);
      const mergeRequests: MergeRequest[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          mergeRequests.push(...result.value);
        }
      }

      return mergeRequests;
    }
  }

  private async listMergeRequestsFromProvider(
    provider: string,
    owner: string,
    repositoryName: string,
    filters?: Record<string, unknown>,
  ): Promise<MergeRequest[]> {
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_pull_requests`,
      `${provider}_list_merge_requests`,
      `${provider}_list_prs`,
      `${provider}_list_mrs`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            ...filters,
            owner,
            repo: repositoryName,
            repository: repositoryName,
          });

          if (hasTextContent(result)) {
            const mrsJson = result.content[0].text;
            const parsedMRs: unknown = JSON.parse(mrsJson);

            if (Array.isArray(parsedMRs)) {
              return parsedMRs.map((mr) =>
                this.normalizeMergeRequest(mr as Record<string, unknown>, provider),
              );
            }
          }
        } catch (error) {
          console.error(
            `Error listing merge requests from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  async getMergeRequest(
    project: string,
    repositoryName: string,
    mergeRequestId: string,
  ): Promise<MergeRequest | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_get_pull_request`,
      `${provider}_get_merge_request`,
      `${provider}_get_pr`,
      `${provider}_get_mr`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            pull_number: mergeRequestId,
            merge_request_iid: mergeRequestId,
            id: mergeRequestId,
          });

          if (hasTextContent(result)) {
            const mrJson = result.content[0].text;
            const parsedMR: unknown = JSON.parse(mrJson);
            return this.normalizeMergeRequest(parsedMR as Record<string, unknown>, provider);
          }
        } catch (error) {
          console.error(
            `Error getting merge request ${mergeRequestId} from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async createMergeRequest(
    project: string,
    repositoryName: string,
    data: {
      title: string;
      description?: string;
      sourceBranch: string;
      targetBranch: string;
      draft?: boolean;
    },
  ): Promise<MergeRequest | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_create_pull_request`,
      `${provider}_create_merge_request`,
      `${provider}_create_pr`,
      `${provider}_create_mr`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            title: data.title,
            body: data.description,
            description: data.description,
            head: data.sourceBranch,
            source_branch: data.sourceBranch,
            base: data.targetBranch,
            target_branch: data.targetBranch,
            draft: data.draft ?? false,
          });

          if (hasTextContent(result)) {
            const mrJson = result.content[0].text;
            const parsedMR: unknown = JSON.parse(mrJson);
            return this.normalizeMergeRequest(parsedMR as Record<string, unknown>, provider);
          }
        } catch (error) {
          console.error(
            `Error creating merge request in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async updateMergeRequest(
    project: string,
    repositoryName: string,
    mergeRequestId: string,
    data: {
      title?: string;
      description?: string;
      state?: 'open' | 'closed';
    },
  ): Promise<MergeRequest | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_update_pull_request`,
      `${provider}_update_merge_request`,
      `${provider}_update_pr`,
      `${provider}_update_mr`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            pull_number: mergeRequestId,
            merge_request_iid: mergeRequestId,
            id: mergeRequestId,
            title: data.title,
            body: data.description,
            description: data.description,
            state: data.state,
          });

          if (hasTextContent(result)) {
            const mrJson = result.content[0].text;
            const parsedMR: unknown = JSON.parse(mrJson);
            return this.normalizeMergeRequest(parsedMR as Record<string, unknown>, provider);
          }
        } catch (error) {
          console.error(
            `Error updating merge request ${mergeRequestId} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async mergeMergeRequest(
    project: string,
    repositoryName: string,
    mergeRequestId: string,
    options?: {
      commitTitle?: string;
      commitMessage?: string;
      squash?: boolean;
      deleteSourceBranch?: boolean;
    },
  ): Promise<boolean> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_merge_pull_request`,
      `${provider}_merge_merge_request`,
      `${provider}_merge_pr`,
      `${provider}_merge_mr`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            pull_number: mergeRequestId,
            merge_request_iid: mergeRequestId,
            id: mergeRequestId,
            commit_title: options?.commitTitle,
            commit_message: options?.commitMessage,
            merge_method: options?.squash ? 'squash' : 'merge',
            should_remove_source_branch: options?.deleteSourceBranch,
          });

          return hasTextContent(result);
        } catch (error) {
          console.error(
            `Error merging merge request ${mergeRequestId} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return false;
  }

  async reviewMergeRequest(
    project: string,
    repositoryName: string,
    mergeRequestId: string,
    review: {
      state: 'approve' | 'request_changes' | 'comment';
      body?: string;
    },
  ): Promise<boolean> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_create_pull_request_review`,
      `${provider}_create_merge_request_review`,
      `${provider}_review_pull_request`,
      `${provider}_review_merge_request`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            pull_number: mergeRequestId,
            merge_request_iid: mergeRequestId,
            id: mergeRequestId,
            event: review.state.toUpperCase(),
            body: review.body,
          });

          return hasTextContent(result);
        } catch (error) {
          console.error(
            `Error reviewing merge request ${mergeRequestId} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return false;
  }

  private normalizeMergeRequest(mr: Record<string, unknown>, provider: string): MergeRequest {
    return {
      id:
        typeof mr.id === 'string' || typeof mr.id === 'number'
          ? String(mr.id)
          : typeof mr.iid === 'string' || typeof mr.iid === 'number'
            ? String(mr.iid)
            : '',
      number:
        typeof mr.number === 'number'
          ? mr.number
          : typeof mr.iid === 'number'
            ? mr.iid
            : typeof mr.id === 'number'
              ? mr.id
              : 0,
      title: typeof mr.title === 'string' ? mr.title : '',
      description:
        typeof mr.body === 'string'
          ? mr.body
          : typeof mr.description === 'string'
            ? mr.description
            : '',
      state: this.normalizeState(
        typeof mr.state === 'string' ? mr.state : typeof mr.status === 'string' ? mr.status : '',
      ),
      author:
        typeof mr.user === 'object' &&
        mr.user &&
        typeof (mr.user as Record<string, unknown>).login === 'string'
          ? ((mr.user as Record<string, unknown>).login as string)
          : typeof mr.author === 'object' &&
              mr.author &&
              typeof (mr.author as Record<string, unknown>).username === 'string'
            ? ((mr.author as Record<string, unknown>).username as string)
            : typeof mr.author === 'object' &&
                mr.author &&
                typeof (mr.author as Record<string, unknown>).name === 'string'
              ? ((mr.author as Record<string, unknown>).name as string)
              : '',
      sourceBranch:
        typeof mr.head === 'object' &&
        mr.head &&
        typeof (mr.head as Record<string, unknown>).ref === 'string'
          ? ((mr.head as Record<string, unknown>).ref as string)
          : typeof mr.source_branch === 'string'
            ? mr.source_branch
            : typeof mr.head_branch === 'string'
              ? mr.head_branch
              : '',
      targetBranch:
        typeof mr.base === 'object' &&
        mr.base &&
        typeof (mr.base as Record<string, unknown>).ref === 'string'
          ? ((mr.base as Record<string, unknown>).ref as string)
          : typeof mr.target_branch === 'string'
            ? mr.target_branch
            : typeof mr.base_branch === 'string'
              ? mr.base_branch
              : '',
      url:
        typeof mr.html_url === 'string'
          ? mr.html_url
          : typeof mr.web_url === 'string'
            ? mr.web_url
            : typeof mr.url === 'string'
              ? mr.url
              : '',
      draft: Boolean(mr.draft ?? mr.work_in_progress ?? false),
      mergeable: mr.mergeable as boolean | undefined,
      provider: provider,
      createdAt: (mr.created_at as string | undefined) ?? (mr.createdAt as string | undefined),
      updatedAt: (mr.updated_at as string | undefined) ?? (mr.updatedAt as string | undefined),
      mergedAt: (mr.merged_at as string | undefined) ?? (mr.mergedAt as string | undefined),
    };
  }

  private normalizeState(state: string): 'open' | 'closed' | 'merged' {
    const lowState = state?.toLowerCase() ?? '';
    if (lowState === 'merged') return 'merged';
    if (lowState === 'closed') return 'closed';
    return 'open';
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_list_merge_requests',
        description: 'List merge requests (PRs) in a repository',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            state: {
              type: 'string',
              description: 'Filter by state',
              enum: ['open', 'closed', 'merged', 'all'],
            },
            author: {
              type: 'string',
              description: 'Filter by author username',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of merge requests to return',
            },
          },
        },
      },
      {
        name: 'nexus_get_merge_request',
        description: 'Get detailed information about a specific merge request (PR)',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'merge_request_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            merge_request_id: {
              type: 'string',
              description: 'Merge request ID or number',
            },
          },
        },
      },
      {
        name: 'nexus_create_merge_request',
        description: 'Create a new merge request (PR)',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'title', 'source_branch', 'target_branch'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            title: {
              type: 'string',
              description: 'Merge request title',
            },
            description: {
              type: 'string',
              description: 'Merge request description',
            },
            source_branch: {
              type: 'string',
              description: 'Source branch name',
            },
            target_branch: {
              type: 'string',
              description: 'Target branch name',
            },
            draft: {
              type: 'boolean',
              description: 'Create as draft/WIP',
            },
          },
        },
      },
      {
        name: 'nexus_update_merge_request',
        description: 'Update an existing merge request (PR)',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'merge_request_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            merge_request_id: {
              type: 'string',
              description: 'Merge request ID or number',
            },
            title: {
              type: 'string',
              description: 'New title',
            },
            description: {
              type: 'string',
              description: 'New description',
            },
            state: {
              type: 'string',
              description: 'New state',
              enum: ['open', 'closed'],
            },
          },
        },
      },
      {
        name: 'nexus_merge_merge_request',
        description: 'Merge a merge request (PR)',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'merge_request_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            merge_request_id: {
              type: 'string',
              description: 'Merge request ID or number',
            },
            commit_title: {
              type: 'string',
              description: 'Custom merge commit title',
            },
            commit_message: {
              type: 'string',
              description: 'Custom merge commit message',
            },
            squash: {
              type: 'boolean',
              description: 'Squash commits before merging',
            },
            delete_source_branch: {
              type: 'boolean',
              description: 'Delete source branch after merge',
            },
          },
        },
      },
      {
        name: 'nexus_review_merge_request',
        description: 'Submit a review for a merge request (PR)',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'merge_request_id', 'state'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            merge_request_id: {
              type: 'string',
              description: 'Merge request ID or number',
            },
            state: {
              type: 'string',
              description: 'Review decision',
              enum: ['approve', 'request_changes', 'comment'],
            },
            body: {
              type: 'string',
              description: 'Review comment',
            },
          },
        },
      },
    ];
  }
}
