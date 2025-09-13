import { ProviderManager } from '../providers/ProviderManager.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent } from '../utils/typeGuards.js';

export interface SearchResult {
  type: 'code' | 'repository' | 'issue' | 'user' | 'commit' | 'file';
  id: string;
  title: string;
  description?: string;
  url: string;
  repository?: string;
  path?: string;
  language?: string;
  score?: number;
  provider: string;
  highlights?: string[];
}

export class SearchManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async searchCode(
    query: string,
    project?: string,
    filters?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (project) {
      const provider = this.detectProviderFromProject(project);
      const providerInstance = this.providerManager.getProvider(provider);

      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }

      const possibleTools = [
        `${provider}_search_code`,
        `${provider}_search_files`,
        `${provider}_code_search`,
      ];

      for (const toolName of possibleTools) {
        if (providerInstance.tools.has(toolName)) {
          try {
            const result = await this.providerManager.callTool(toolName, {
              query: query,
              ...filters,
              owner: project.includes(':') ? project.split(':')[1] : undefined,
              org: project.includes(':') ? project.split(':')[1] : undefined,
            });

            if (hasTextContent(result)) {
              const searchJson = result.content[0].text;
              const parsedResults: unknown = JSON.parse(searchJson);

              if (Array.isArray(parsedResults)) {
                for (const item of parsedResults) {
                  results.push(this.normalizeSearchResult(item, 'code', provider));
                }
              }
            }
            break;
          } catch (error) {
            console.error(
              `Error searching code in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } else {
      // Parallel search across all providers
      const providers = this.providerManager
        .getAllProviders()
        .filter((p) => p.status === 'connected');

      const promises = providers.map(async (providerInstance) => {
        try {
          return await this.searchCode(query, `${providerInstance.id}:`, filters);
        } catch (error) {
          console.error(
            `Error searching code in ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });

      const searchResults = await Promise.allSettled(promises);

      for (const result of searchResults) {
        if (result.status === 'fulfilled') {
          results.push(...result.value);
        }
      }
    }

    return results;
  }

  async searchRepositories(
    query: string,
    provider?: string,
    filters?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (provider) {
      const providerInstance = this.providerManager.getProvider(provider);

      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }

      const possibleTools = [
        `${provider}_search_repositories`,
        `${provider}_search_repos`,
        `${provider}_repository_search`,
      ];

      for (const toolName of possibleTools) {
        if (providerInstance.tools.has(toolName)) {
          try {
            const result = await this.providerManager.callTool(toolName, {
              query: query,
              ...filters,
            });

            if (hasTextContent(result)) {
              const searchJson = result.content[0].text;
              const parsedResults: unknown = JSON.parse(searchJson);

              if (Array.isArray(parsedResults)) {
                for (const item of parsedResults) {
                  results.push(this.normalizeSearchResult(item, 'repository', provider));
                }
              }
            }
            break;
          } catch (error) {
            console.error(
              `Error searching repositories in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } else {
      // Parallel search across all providers
      const providers = this.providerManager
        .getAllProviders()
        .filter((p) => p.status === 'connected');

      const promises = providers.map(async (providerInstance) => {
        try {
          return await this.searchRepositories(query, providerInstance.id, filters);
        } catch (error) {
          console.error(
            `Error searching repositories in ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });

      const searchResults = await Promise.allSettled(promises);

      for (const result of searchResults) {
        if (result.status === 'fulfilled') {
          results.push(...result.value);
        }
      }
    }

    return results;
  }

  async searchIssues(
    query: string,
    project?: string,
    filters?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (project) {
      const provider = this.detectProviderFromProject(project);
      const providerInstance = this.providerManager.getProvider(provider);

      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }

      const possibleTools = [
        `${provider}_search_issues`,
        `${provider}_search_work_items`,
        `${provider}_issue_search`,
      ];

      for (const toolName of possibleTools) {
        if (providerInstance.tools.has(toolName)) {
          try {
            const result = await this.providerManager.callTool(toolName, {
              query: query,
              ...filters,
              owner: project.includes(':') ? project.split(':')[1] : undefined,
              org: project.includes(':') ? project.split(':')[1] : undefined,
            });

            if (hasTextContent(result)) {
              const searchJson = result.content[0].text;
              const parsedResults: unknown = JSON.parse(searchJson);

              if (Array.isArray(parsedResults)) {
                for (const item of parsedResults) {
                  results.push(this.normalizeSearchResult(item, 'issue', provider));
                }
              }
            }
            break;
          } catch (error) {
            console.error(
              `Error searching issues in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } else {
      // Search across all providers
      const providers = this.providerManager.getAllProviders();
      for (const providerInstance of providers) {
        if (providerInstance.status === 'connected') {
          try {
            const result = await this.searchIssues(query, `${providerInstance.id}:`, filters);
            results.push(...result);
          } catch (error) {
            console.error(
              `Error searching issues in ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    return results;
  }

  async searchUsers(
    query: string,
    provider?: string,
    filters?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (provider) {
      const providerInstance = this.providerManager.getProvider(provider);

      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }

      const possibleTools = [
        `${provider}_search_users`,
        `${provider}_user_search`,
        `${provider}_find_users`,
      ];

      for (const toolName of possibleTools) {
        if (providerInstance.tools.has(toolName)) {
          try {
            const result = await this.providerManager.callTool(toolName, {
              query: query,
              ...filters,
            });

            if (hasTextContent(result)) {
              const searchJson = result.content[0].text;
              const parsedResults: unknown = JSON.parse(searchJson);

              if (Array.isArray(parsedResults)) {
                for (const item of parsedResults) {
                  results.push(this.normalizeSearchResult(item, 'user', provider));
                }
              }
            }
            break;
          } catch (error) {
            console.error(
              `Error searching users in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    } else {
      // Search across all providers
      const providers = this.providerManager.getAllProviders();
      for (const providerInstance of providers) {
        if (providerInstance.status === 'connected') {
          try {
            const result = await this.searchUsers(query, providerInstance.id, filters);
            results.push(...result);
          } catch (error) {
            console.error(
              `Error searching users in ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    return results;
  }

  async globalSearch(
    query: string,
    type?: string,
    project?: string,
    filters?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    if (!type || type === 'all') {
      // Search all types
      const searchPromises = [
        this.searchCode(query, project, filters),
        this.searchRepositories(
          query,
          project ? this.detectProviderFromProject(project) : undefined,
          filters,
        ),
        this.searchIssues(query, project, filters),
        this.searchUsers(
          query,
          project ? this.detectProviderFromProject(project) : undefined,
          filters,
        ),
      ];

      const allResults = await Promise.allSettled(searchPromises);
      for (const result of allResults) {
        if (result.status === 'fulfilled') {
          results.push(...result.value);
        }
      }
    } else {
      // Search specific type
      switch (type) {
        case 'code':
          results.push(...(await this.searchCode(query, project, filters)));
          break;
        case 'repository':
          results.push(
            ...(await this.searchRepositories(
              query,
              project ? this.detectProviderFromProject(project) : undefined,
              filters,
            )),
          );
          break;
        case 'issue':
          results.push(...(await this.searchIssues(query, project, filters)));
          break;
        case 'user':
          results.push(
            ...(await this.searchUsers(
              query,
              project ? this.detectProviderFromProject(project) : undefined,
              filters,
            )),
          );
          break;
      }
    }

    // Sort by relevance/score
    return results.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  private normalizeSearchResult(
    item: any,
    type: SearchResult['type'],
    provider: string,
  ): SearchResult {
    return {
      type: type,
      id: item.id?.toString() || item.number?.toString() || '',
      title: item.title || item.name || item.login || item.username || item.path || '',
      description: item.body || item.description || item.snippet || '',
      url: item.html_url || item.web_url || item.url || '',
      repository:
        item.repository?.full_name || item.project?.name_with_namespace || item.repo?.name,
      path: item.path || item.file?.path,
      language: item.language || item.file?.language,
      score: item.score || item.relevance,
      provider: provider,
      highlights: item.text_matches?.map((match: any) => match.fragment) || [],
    };
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_search_code',
        description: 'Search for code across repositories',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'Search query (code, functions, classes, etc.)',
            },
            project: {
              type: 'string',
              description: 'Optional project scope (e.g., "github:owner", "gitlab:group")',
            },
            language: {
              type: 'string',
              description: 'Filter by programming language',
            },
            repository: {
              type: 'string',
              description: 'Filter by specific repository',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
            },
          },
        },
      },
      {
        name: 'nexus_search_repositories',
        description: 'Search for repositories across all providers',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'Repository search query (name, description, topic)',
            },
            provider: {
              type: 'string',
              description: 'Optional provider filter (github, gitlab, azure)',
            },
            language: {
              type: 'string',
              description: 'Filter by programming language',
            },
            stars: {
              type: 'string',
              description: 'Filter by star count (e.g., ">100", "10..50")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
            },
          },
        },
      },
      {
        name: 'nexus_search_issues',
        description: 'Search for issues and work items across projects',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'Issue search query (title, description, labels)',
            },
            project: {
              type: 'string',
              description: 'Optional project scope (e.g., "github:owner", "gitlab:group")',
            },
            state: {
              type: 'string',
              description: 'Filter by issue state',
              enum: ['open', 'closed', 'all'],
            },
            author: {
              type: 'string',
              description: 'Filter by author',
            },
            assignee: {
              type: 'string',
              description: 'Filter by assignee',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
            },
          },
        },
      },
      {
        name: 'nexus_search_users',
        description: 'Search for users across all providers',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'User search query (username, name, email)',
            },
            provider: {
              type: 'string',
              description: 'Optional provider filter (github, gitlab, azure)',
            },
            location: {
              type: 'string',
              description: 'Filter by location',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
            },
          },
        },
      },
      {
        name: 'nexus_global_search',
        description: 'Universal search across all content types and providers',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'Universal search query',
            },
            type: {
              type: 'string',
              description: 'Filter by content type',
              enum: ['all', 'code', 'repository', 'issue', 'user'],
            },
            project: {
              type: 'string',
              description: 'Optional project scope (e.g., "github:owner", "gitlab:group")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
            },
          },
        },
      },
    ];
  }
}
