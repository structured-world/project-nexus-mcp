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
              return parsedFiles.map((file: Record<string, unknown>) =>
                typeof file.name === 'string'
                  ? file.name
                  : typeof file.path === 'string'
                    ? file.path
                    : '[unknown file]',
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
    const repoData = repo as Record<string, unknown>;
    return {
      id:
        typeof repoData.id === 'string' || typeof repoData.id === 'number'
          ? String(repoData.id)
          : typeof repoData.name === 'string'
            ? repoData.name
            : '',
      name:
        typeof repoData.name === 'string'
          ? repoData.name
          : typeof repoData.repository_name === 'string'
            ? repoData.repository_name
            : '',
      fullName:
        typeof repoData.full_name === 'string'
          ? repoData.full_name
          : typeof repoData.name_with_namespace === 'string'
            ? repoData.name_with_namespace
            : `${
                typeof repoData.owner === 'object' &&
                repoData.owner &&
                typeof (repoData.owner as Record<string, unknown>).login === 'string'
                  ? ((repoData.owner as Record<string, unknown>).login as string)
                  : ''
              }/${typeof repoData.name === 'string' ? repoData.name : ''}`,
      description: typeof repoData.description === 'string' ? repoData.description : '',
      url:
        typeof repoData.html_url === 'string'
          ? repoData.html_url
          : typeof repoData.web_url === 'string'
            ? repoData.web_url
            : typeof repoData.url === 'string'
              ? repoData.url
              : '',
      defaultBranch:
        typeof repoData.default_branch === 'string'
          ? repoData.default_branch
          : typeof repoData.defaultBranch === 'string'
            ? repoData.defaultBranch
            : 'main',
      private:
        (typeof repoData.private === 'boolean'
          ? repoData.private
          : repoData.visibility === 'private') || false,
      language:
        typeof repoData.language === 'string'
          ? repoData.language
          : typeof repoData.primaryLanguage === 'object' &&
              repoData.primaryLanguage &&
              typeof (repoData.primaryLanguage as Record<string, unknown>).name === 'string'
            ? ((repoData.primaryLanguage as Record<string, unknown>).name as string)
            : '',
      stars:
        typeof repoData.stargazers_count === 'number'
          ? repoData.stargazers_count
          : typeof repoData.star_count === 'number'
            ? repoData.star_count
            : typeof repoData.stars === 'number'
              ? repoData.stars
              : 0,
      forks:
        typeof repoData.forks_count === 'number'
          ? repoData.forks_count
          : typeof repoData.forks === 'number'
            ? repoData.forks
            : 0,
      provider,
      createdAt:
        typeof repoData.created_at === 'string'
          ? repoData.created_at
          : typeof repoData.createdAt === 'string'
            ? repoData.createdAt
            : undefined,
      updatedAt:
        typeof repoData.updated_at === 'string'
          ? repoData.updated_at
          : typeof repoData.updatedAt === 'string'
            ? repoData.updatedAt
            : typeof repoData.last_activity_at === 'string'
              ? repoData.last_activity_at
              : undefined,
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
