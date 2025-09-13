import { ProviderManager } from '../providers/ProviderManager.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent } from '../utils/typeGuards.js';

// Provider API response interfaces
interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
  };
  html_url: string;
  stats?: {
    additions: number;
    deletions: number;
  };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
}

interface GitLabCommit {
  id: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_date: string;
  committer_name: string;
  committer_email: string;
  committed_date: string;
  web_url: string;
  stats?: {
    additions: number;
    deletions: number;
  };
}

type ProviderCommit = GitHubCommit | GitLabCommit | Record<string, unknown>;

export interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  committer?: {
    name: string;
    email: string;
    date: string;
  };
  url: string;
  additions?: number;
  deletions?: number;
  files?: CommitFile[];
  provider: string;
}

export interface CommitFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export class CommitManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listCommits(
    project: string,
    repositoryName: string,
    filters?: Record<string, unknown>,
  ): Promise<Commit[]> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_commits`,
      `${provider}_get_commits`,
      `${provider}_get_repository_commits`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            ...filters,
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
          });

          if (hasTextContent(result)) {
            const commitsJson = result.content[0].text;
            const parsedCommits: unknown = JSON.parse(commitsJson);

            if (Array.isArray(parsedCommits)) {
              return parsedCommits.map((commit: unknown) =>
                this.normalizeCommit(commit as ProviderCommit, provider),
              );
            }
          }
        } catch (error) {
          console.error(
            `Error listing commits from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  async getCommit(project: string, repositoryName: string, sha: string): Promise<Commit | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [`${provider}_get_commit`, `${provider}_get_repository_commit`];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            sha: sha,
            commit_sha: sha,
          });

          if (hasTextContent(result)) {
            const commitJson = result.content[0].text;
            const parsedCommit = JSON.parse(commitJson) as ProviderCommit;
            return this.normalizeCommit(parsedCommit, provider);
          }
        } catch (error) {
          console.error(
            `Error getting commit ${sha} from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async getCommitDiff(project: string, repositoryName: string, sha: string): Promise<string> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_get_commit_diff`,
      `${provider}_get_diff`,
      `${provider}_compare_commits`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            sha: sha,
            commit_sha: sha,
          });

          if (hasTextContent(result)) {
            return result.content[0].text;
          }
        } catch (error) {
          console.error(
            `Error getting diff for commit ${sha} from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return '';
  }

  private normalizeCommit(commit: ProviderCommit, provider: string): Commit {
    // Type guards to identify provider types
    const isGitHubCommit = (c: ProviderCommit): c is GitHubCommit =>
      'sha' in c && 'commit' in c && typeof c.commit === 'object' && c.commit !== null;

    const isGitLabCommit = (c: ProviderCommit): c is GitLabCommit =>
      'id' in c && 'author_name' in c;

    if (isGitHubCommit(commit)) {
      return {
        sha: commit.sha,
        message: commit.commit.message,
        author: {
          name: commit.commit.author.name,
          email: commit.commit.author.email,
          date: commit.commit.author.date,
        },
        committer: {
          name: commit.commit.committer.name,
          email: commit.commit.committer.email,
          date: commit.commit.committer.date,
        },
        url: commit.html_url,
        additions: commit.stats?.additions,
        deletions: commit.stats?.deletions,
        files: commit.files?.map((file) => ({
          filename: file.filename,
          status: this.normalizeFileStatus(file.status),
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
        })),
        provider,
      };
    } else if (isGitLabCommit(commit)) {
      return {
        sha: commit.id,
        message: commit.message,
        author: {
          name: commit.author_name,
          email: commit.author_email,
          date: commit.authored_date,
        },
        committer: {
          name: commit.committer_name,
          email: commit.committer_email,
          date: commit.committed_date,
        },
        url: commit.web_url,
        additions: commit.stats?.additions,
        deletions: commit.stats?.deletions,
        files: undefined, // GitLab commits typically don't include file details
        provider,
      };
    } else {
      // Fallback for generic Record<string, unknown>
      const genericCommit = commit;
      return {
        sha:
          typeof genericCommit.sha === 'string'
            ? genericCommit.sha
            : typeof genericCommit.id === 'string'
              ? genericCommit.id
              : '',
        message:
          typeof genericCommit.message === 'string'
            ? genericCommit.message
            : typeof genericCommit.title === 'string'
              ? genericCommit.title
              : '',
        author: {
          name:
            typeof genericCommit.author_name === 'string'
              ? genericCommit.author_name
              : typeof genericCommit.author === 'object' &&
                  genericCommit.author &&
                  typeof (genericCommit.author as Record<string, unknown>).name === 'string'
                ? ((genericCommit.author as Record<string, unknown>).name as string)
                : '',
          email:
            typeof genericCommit.author_email === 'string'
              ? genericCommit.author_email
              : typeof genericCommit.author === 'object' &&
                  genericCommit.author &&
                  typeof (genericCommit.author as Record<string, unknown>).email === 'string'
                ? ((genericCommit.author as Record<string, unknown>).email as string)
                : '',
          date:
            typeof genericCommit.authored_date === 'string'
              ? genericCommit.authored_date
              : typeof genericCommit.created_at === 'string'
                ? genericCommit.created_at
                : '',
        },
        committer:
          typeof genericCommit.committer_name === 'string'
            ? {
                name: genericCommit.committer_name,
                email:
                  typeof genericCommit.committer_email === 'string'
                    ? genericCommit.committer_email
                    : '',
                date:
                  typeof genericCommit.committed_date === 'string'
                    ? genericCommit.committed_date
                    : '',
              }
            : undefined,
        url:
          typeof genericCommit.html_url === 'string'
            ? genericCommit.html_url
            : typeof genericCommit.web_url === 'string'
              ? genericCommit.web_url
              : '',
        additions:
          typeof genericCommit.stats === 'object' &&
          genericCommit.stats &&
          typeof (genericCommit.stats as Record<string, unknown>).additions === 'number'
            ? ((genericCommit.stats as Record<string, unknown>).additions as number)
            : undefined,
        deletions:
          typeof genericCommit.stats === 'object' &&
          genericCommit.stats &&
          typeof (genericCommit.stats as Record<string, unknown>).deletions === 'number'
            ? ((genericCommit.stats as Record<string, unknown>).deletions as number)
            : undefined,
        files: undefined,
        provider,
      };
    }
  }

  private normalizeFileStatus(status: string): 'added' | 'modified' | 'removed' | 'renamed' {
    const lowStatus = status.toLowerCase();
    if (['added', 'new'].includes(lowStatus)) return 'added';
    if (['modified', 'changed'].includes(lowStatus)) return 'modified';
    if (['removed', 'deleted'].includes(lowStatus)) return 'removed';
    if (['renamed'].includes(lowStatus)) return 'renamed';
    return 'modified';
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_list_commits',
        description: 'List commits in a repository branch',
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
            branch: {
              type: 'string',
              description: 'Branch name (default: default branch)',
            },
            author: {
              type: 'string',
              description: 'Filter by author',
            },
            since: {
              type: 'string',
              description: 'Only commits after this date (ISO 8601)',
            },
            until: {
              type: 'string',
              description: 'Only commits before this date (ISO 8601)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of commits to return',
            },
          },
        },
      },
      {
        name: 'nexus_get_commit',
        description: 'Get detailed information about a specific commit',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'sha'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            sha: {
              type: 'string',
              description: 'Commit SHA hash',
            },
          },
        },
      },
      {
        name: 'nexus_get_commit_diff',
        description: 'Get the diff/patch for a specific commit',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'sha'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            sha: {
              type: 'string',
              description: 'Commit SHA hash',
            },
          },
        },
      },
    ];
  }
}
