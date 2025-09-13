import { ProviderManager } from '../providers/ProviderManager.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent } from '../utils/typeGuards.js';

// Provider API response interfaces
interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  language: string;
  stargazers_count: number;
  forks_count: number;
  created_at: string;
  updated_at: string;
  owner: {
    login: string;
  };
}

interface GitLabRepository {
  id: number;
  name: string;
  name_with_namespace: string;
  description: string;
  web_url: string;
  default_branch: string;
  visibility: string;
  created_at: string;
  last_activity_at: string;
  star_count: number;
  forks_count: number;
}

interface AzureRepository {
  id: string;
  name: string;
  url: string;
  defaultBranch: string;
}

type ProviderRepository =
  | GitHubRepository
  | GitLabRepository
  | AzureRepository
  | Record<string, unknown>;

interface ProviderFileContent {
  content?: string;
  data?: string;
  encoding?: string;
  size?: number;
  sha?: string;
  commit_id?: string;
  blob_id?: string;
}

export interface Repository {
  id: string;
  name: string;
  fullName: string;
  description?: string;
  url: string;
  defaultBranch: string;
  private: boolean;
  language?: string;
  stars?: number;
  forks?: number;
  provider: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FileContent {
  content: string;
  encoding: string;
  size: number;
  sha?: string;
  path: string;
  provider: string;
}

export class RepositoryManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listRepositories(
    project?: string,
    filters?: Record<string, unknown>,
  ): Promise<Repository[]> {
    const repositories: Repository[] = [];

    if (project) {
      const provider = this.detectProviderFromProject(project);
      const providerInstance = this.providerManager.getProvider(provider);

      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }

      // Try different tool names based on provider
      const possibleTools = [
        `${provider}_list_repositories`,
        `${provider}_list_repos`,
        `${provider}_get_repositories`,
        `${provider}_search_repositories`,
      ];

      for (const toolName of possibleTools) {
        if (providerInstance.tools.has(toolName)) {
          try {
            const result = await this.providerManager.callTool(toolName, {
              ...filters,
              owner: project.includes(':') ? project.split(':')[1] : project,
            });

            if (hasTextContent(result)) {
              const reposJson = result.content[0].text;
              const parsedRepos: unknown = JSON.parse(reposJson);

              if (Array.isArray(parsedRepos)) {
                for (const repo of parsedRepos) {
                  repositories.push(this.normalizeRepository(repo as ProviderRepository, provider));
                }
              } else if (typeof parsedRepos === 'object' && parsedRepos !== null) {
                repositories.push(
                  this.normalizeRepository(parsedRepos as ProviderRepository, provider),
                );
              }
            }
            break;
          } catch (error) {
            console.error(
              `Error listing repositories from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } else {
      // Parallel operation across all providers
      const providers = this.providerManager
        .getAllProviders()
        .filter((p) => p.status === 'connected');

      const promises = providers.map(async (providerInstance) => {
        try {
          return await this.listRepositories(`${providerInstance.id}:`, filters);
        } catch (error) {
          console.error(
            `Error listing repositories from ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });

      const results = await Promise.allSettled(promises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          repositories.push(...result.value);
        }
      }
    }

    return repositories;
  }

  async getRepository(project: string, repositoryName: string): Promise<Repository | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_get_repository`,
      `${provider}_get_repo`,
      `${provider}_repository_info`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
          });

          if (hasTextContent(result)) {
            const repoJson = result.content[0].text;
            const parsedRepo = JSON.parse(repoJson) as ProviderRepository;
            return this.normalizeRepository(parsedRepo, provider);
          }
        } catch (error) {
          console.error(
            `Error getting repository ${repositoryName} from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async listFiles(
    project: string,
    repositoryName: string,
    path: string = '',
    ref?: string,
  ): Promise<string[]> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_files`,
      `${provider}_get_file_contents`,
      `${provider}_browse_repository`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            path: path,
            ref: ref,
          });

          if (hasTextContent(result)) {
            const filesJson = result.content[0].text;
            const parsedFiles: unknown = JSON.parse(filesJson);

            if (Array.isArray(parsedFiles)) {
              return parsedFiles.map(
                (file: Record<string, unknown>) =>
                  (file.name as string) ?? (file.path as string) ?? String(file),
              );
            }
          }
        } catch (error) {
          console.error(
            `Error listing files from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  async getFileContent(
    project: string,
    repositoryName: string,
    filePath: string,
    ref?: string,
  ): Promise<FileContent | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_get_file_contents`,
      `${provider}_read_file`,
      `${provider}_get_file`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            path: filePath,
            ref: ref,
          });

          if (hasTextContent(result)) {
            const fileJson = result.content[0].text;
            const parsedFile = JSON.parse(fileJson) as ProviderFileContent;
            return this.normalizeFileContent(parsedFile, provider, filePath);
          }
        } catch (error) {
          console.error(
            `Error getting file content from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  private normalizeRepository(repo: ProviderRepository, provider: string): Repository {
    const repoData = repo as Record<string, any>;
    return {
      id: (repoData.id?.toString() as string) ?? (repoData.name as string) ?? '',
      name: (repoData.name as string) ?? (repoData.repository_name as string) ?? '',
      fullName:
        (repoData.full_name as string) ??
        (repoData.name_with_namespace as string) ??
        `${(repoData.owner?.login as string) ?? ''}/${(repoData.name as string) ?? ''}`,
      description: (repoData.description as string) ?? '',
      url:
        (repoData.html_url as string) ??
        (repoData.web_url as string) ??
        (repoData.url as string) ??
        '',
      defaultBranch:
        (repoData.default_branch as string) ?? (repoData.defaultBranch as string) ?? 'main',
      private: ((repoData.private as boolean) ?? repoData.visibility === 'private') || false,
      language: (repoData.language as string) ?? (repoData.primaryLanguage?.name as string) ?? '',
      stars:
        (repoData.stargazers_count as number) ??
        (repoData.star_count as number) ??
        (repoData.stars as number) ??
        0,
      forks: (repoData.forks_count as number) ?? (repoData.forks as number) ?? 0,
      provider,
      createdAt: (repoData.created_at as string) ?? (repoData.createdAt as string),
      updatedAt:
        (repoData.updated_at as string) ??
        (repoData.updatedAt as string) ??
        (repoData.last_activity_at as string),
    };
  }

  private normalizeFileContent(
    file: ProviderFileContent,
    provider: string,
    path: string,
  ): FileContent {
    return {
      content: file.content ?? file.data ?? '',
      encoding: file.encoding ?? 'utf-8',
      size: file.size ?? file.content?.length ?? 0,
      sha: file.sha ?? file.commit_id ?? file.blob_id,
      path,
      provider,
    };
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_list_repositories',
        description: 'List repositories across all configured providers or from a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description:
                'Optional project identifier (e.g., "github:owner", "gitlab:group", "azure:org"). If not provided, lists from all providers.',
            },
            type: {
              type: 'string',
              description: 'Repository type filter (public, private, all)',
              enum: ['public', 'private', 'all'],
            },
            language: {
              type: 'string',
              description: 'Filter by programming language',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of repositories to return',
            },
          },
        },
      },
      {
        name: 'nexus_get_repository',
        description: 'Get detailed information about a specific repository',
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
        name: 'nexus_list_files',
        description: 'List files and directories in a repository',
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
            path: {
              type: 'string',
              description: 'Directory path to list (default: root)',
            },
            ref: {
              type: 'string',
              description: 'Branch, tag, or commit SHA (default: default branch)',
            },
          },
        },
      },
      {
        name: 'nexus_get_file_content',
        description: 'Get the content of a specific file in a repository',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'file_path'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            file_path: {
              type: 'string',
              description: 'Path to the file',
            },
            ref: {
              type: 'string',
              description: 'Branch, tag, or commit SHA (default: default branch)',
            },
          },
        },
      },
    ];
  }
}
