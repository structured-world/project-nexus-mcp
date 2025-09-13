import { ProviderManager } from '../providers/ProviderManager.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent } from '../utils/typeGuards.js';

// Provider API response interfaces
interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    commit?: {
      message: string;
      author: {
        name: string;
        date: string;
      };
    };
    author?: {
      login: string;
    };
  };
  protected: boolean;
}

interface GitLabBranch {
  name: string;
  commit: {
    id: string;
    message: string;
    author_name: string;
    created_at: string;
  };
  protected: boolean;
  default: boolean;
  web_url: string;
}

interface AzureBranch {
  name: string;
  objectId: string;
}

type ProviderBranch = GitHubBranch | GitLabBranch | AzureBranch | Record<string, unknown>;

export interface Branch {
  name: string;
  sha: string;
  protected: boolean;
  default: boolean;
  url?: string;
  provider: string;
  lastCommit?: {
    sha: string;
    message: string;
    author: string;
    date: string;
  };
}

export class BranchManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listBranches(project: string, repositoryName: string): Promise<Branch[]> {
    const provider = this.detectProviderFromProject(project);

    if (provider && provider !== '') {
      // Single provider operation
      return this.listBranchesFromProvider(provider, project.split(':')[1], repositoryName);
    } else {
      // Parallel operation across all providers
      const providers = this.providerManager
        .getAllProviders()
        .filter((p) => p.status === 'connected');

      const promises = providers.map(async (providerInstance) => {
        try {
          return await this.listBranchesFromProvider(
            providerInstance.id,
            repositoryName, // Use repo name as owner for multi-provider search
            repositoryName,
          );
        } catch (error) {
          console.error(
            `Error listing branches from ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });

      const results = await Promise.allSettled(promises);
      const branches: Branch[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          branches.push(...result.value);
        }
      }

      return branches;
    }
  }

  private async listBranchesFromProvider(
    provider: string,
    owner: string,
    repositoryName: string,
  ): Promise<Branch[]> {
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_branches`,
      `${provider}_get_branches`,
      `${provider}_list_refs`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner,
            repo: repositoryName,
            repository: repositoryName,
          });

          if (hasTextContent(result)) {
            const branchesJson = result.content[0].text;
            const parsedBranches: unknown = JSON.parse(branchesJson);

            if (Array.isArray(parsedBranches)) {
              return parsedBranches.map((branch) =>
                this.normalizeBranch(branch as ProviderBranch, provider),
              );
            }
          }
        } catch (error) {
          console.error(
            `Error listing branches from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  async createBranch(
    project: string,
    repositoryName: string,
    branchName: string,
    fromBranch: string = 'main',
  ): Promise<Branch | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [`${provider}_create_branch`, `${provider}_create_ref`];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            branch: branchName,
            ref: `refs/heads/${branchName}`,
            sha: fromBranch, // This might need to be resolved to SHA first
            from_branch: fromBranch,
          });

          if (hasTextContent(result)) {
            const branchJson = result.content[0].text;
            const parsedBranch = JSON.parse(branchJson) as ProviderBranch;
            return this.normalizeBranch(parsedBranch, provider);
          }
        } catch (error) {
          console.error(
            `Error creating branch ${branchName} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async deleteBranch(
    project: string,
    repositoryName: string,
    branchName: string,
  ): Promise<boolean> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [`${provider}_delete_branch`, `${provider}_delete_ref`];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            branch: branchName,
            ref: `refs/heads/${branchName}`,
          });

          return hasTextContent(result);
        } catch (error) {
          console.error(
            `Error deleting branch ${branchName} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return false;
  }

  private normalizeBranch(branch: ProviderBranch, provider: string): Branch {
    const branchData = branch as Record<string, any>;

    // Safely extract name
    const name =
      (branchData.name as string) ?? (branchData.ref as string)?.replace('refs/heads/', '') ?? '';

    // Safely extract SHA
    const sha =
      (branchData.commit?.sha as string) ??
      (branchData.object?.sha as string) ??
      (branchData.sha as string) ??
      (branchData.objectId as string) ??
      '';

    // Safely extract commit info
    let lastCommit: Branch['lastCommit'] = undefined;
    if (branchData.commit) {
      lastCommit = {
        sha: (branchData.commit.sha as string) ?? (branchData.commit.id as string) ?? '',
        message:
          (branchData.commit.message as string) ??
          (branchData.commit.commit?.message as string) ??
          '',
        author:
          (branchData.commit.author?.login as string) ??
          (branchData.commit.commit?.author?.name as string) ??
          (branchData.commit.author_name as string) ??
          '',
        date:
          (branchData.commit.commit?.author?.date as string) ??
          (branchData.commit.created_at as string) ??
          '',
      };
    }
    return {
      name,
      sha,
      protected: (branchData.protected as boolean) ?? false,
      default: (branchData.default_branch as boolean) ?? (branchData.default as boolean) ?? false,
      url: (branchData.url as string) ?? (branchData.web_url as string),
      provider,
      lastCommit,
    };
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_list_branches',
        description: 'List all branches in a repository',
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
          },
        },
      },
      {
        name: 'nexus_create_branch',
        description: 'Create a new branch in a repository',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'branch_name'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            branch_name: {
              type: 'string',
              description: 'Name of the new branch',
            },
            from_branch: {
              type: 'string',
              description: 'Source branch to create from (default: main)',
            },
          },
        },
      },
      {
        name: 'nexus_delete_branch',
        description: 'Delete a branch from a repository',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'branch_name'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            branch_name: {
              type: 'string',
              description: 'Name of the branch to delete',
            },
          },
        },
      },
    ];
  }
}
