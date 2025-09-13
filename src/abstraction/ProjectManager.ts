import { ProviderManager } from '../providers/ProviderManager.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent } from '../utils/typeGuards.js';

// Provider API response interfaces
interface GitHubOrganization {
  id: number;
  login: string;
  name: string;
  description: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  public_repos: number;
}

interface GitLabGroup {
  id: number;
  name: string;
  full_name?: string;
  name_with_namespace: string;
  description: string;
  web_url: string;
  visibility: string;
  created_at: string;
}

type ProviderProject = GitHubOrganization | GitLabGroup | Record<string, unknown>;

interface ProviderMember {
  id: number;
  login?: string;
  username?: string;
  name?: string;
  email?: string;
  role?: string;
  permission?: string;
  access_level?: number;
}

export interface Project {
  id: string;
  name: string;
  fullName: string;
  description?: string;
  url: string;
  visibility: 'public' | 'private' | 'internal';
  provider: string;
  createdAt?: string;
  updatedAt?: string;
  defaultBranch?: string;
  repositoryCount?: number;
  memberCount?: number;
}

export interface ProjectMember {
  id: string;
  username: string;
  name?: string;
  email?: string;
  role: string;
  accessLevel: number;
  provider: string;
}

export class ProjectManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listProjects(provider?: string, filters?: Record<string, unknown>): Promise<Project[]> {
    const projects: Project[] = [];

    if (provider) {
      const providerInstance = this.providerManager.getProvider(provider);

      if (!providerInstance) {
        throw new Error(`Provider ${provider} not found`);
      }

      const possibleTools = [
        `${provider}_list_organizations`,
        `${provider}_list_groups`,
        `${provider}_list_projects`,
        `${provider}_list_orgs`,
      ];

      for (const toolName of possibleTools) {
        if (providerInstance.tools.has(toolName)) {
          try {
            const result = await this.providerManager.callTool(toolName, filters ?? {});

            if (hasTextContent(result)) {
              const projectsJson = result.content[0].text;
              const parsedProjects: unknown = JSON.parse(projectsJson);

              if (Array.isArray(parsedProjects)) {
                for (const project of parsedProjects) {
                  projects.push(this.normalizeProject(project as ProviderProject, provider));
                }
              }
            }
            break;
          } catch (error) {
            console.error(
              `Error listing projects from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
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
          return await this.listProjects(providerInstance.id, filters);
        } catch (error) {
          console.error(
            `Error listing projects from ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });

      const results = await Promise.allSettled(promises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          projects.push(...result.value);
        }
      }
    }

    return projects;
  }

  async getProject(project: string): Promise<Project | null> {
    const provider = this.detectProviderFromProject(project);
    const projectId = project.split(':')[1];
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_get_organization`,
      `${provider}_get_group`,
      `${provider}_get_project`,
      `${provider}_get_org`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            org: projectId,
            group: projectId,
            project: projectId,
            organization: projectId,
          });

          if (hasTextContent(result)) {
            const projectJson = result.content[0].text;
            const parsedProject = JSON.parse(projectJson) as ProviderProject;
            return this.normalizeProject(parsedProject, provider);
          }
        } catch (error) {
          console.error(
            `Error getting project ${projectId} from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async listProjectMembers(project: string): Promise<ProjectMember[]> {
    const provider = this.detectProviderFromProject(project);
    const projectId = project.split(':')[1];
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_organization_members`,
      `${provider}_list_group_members`,
      `${provider}_list_project_members`,
      `${provider}_list_org_members`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            org: projectId,
            group: projectId,
            project: projectId,
            organization: projectId,
          });

          if (hasTextContent(result)) {
            const membersJson = result.content[0].text;
            const parsedMembers: unknown = JSON.parse(membersJson);

            if (Array.isArray(parsedMembers)) {
              return parsedMembers.map((member: ProviderMember) =>
                this.normalizeProjectMember(member, provider),
              );
            }
          }
        } catch (error) {
          console.error(
            `Error listing members for ${projectId} from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  async addProjectMember(project: string, username: string, role: string): Promise<boolean> {
    const provider = this.detectProviderFromProject(project);
    const projectId = project.split(':')[1];
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_add_organization_member`,
      `${provider}_add_group_member`,
      `${provider}_add_project_member`,
      `${provider}_invite_org_member`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            org: projectId,
            group: projectId,
            project: projectId,
            organization: projectId,
            username: username,
            user: username,
            role: role,
            access_level: this.roleToAccessLevel(role),
          });

          return hasTextContent(result);
        } catch (error) {
          console.error(
            `Error adding member ${username} to ${projectId} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return false;
  }

  async removeProjectMember(project: string, username: string): Promise<boolean> {
    const provider = this.detectProviderFromProject(project);
    const projectId = project.split(':')[1];
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_remove_organization_member`,
      `${provider}_remove_group_member`,
      `${provider}_remove_project_member`,
      `${provider}_remove_org_member`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            org: projectId,
            group: projectId,
            project: projectId,
            organization: projectId,
            username: username,
            user: username,
          });

          return hasTextContent(result);
        } catch (error) {
          console.error(
            `Error removing member ${username} from ${projectId} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return false;
  }

  private normalizeProject(project: ProviderProject, provider: string): Project {
    const projectData = project as Record<string, unknown>;
    return {
      id:
        typeof projectData.id === 'string' || typeof projectData.id === 'number'
          ? String(projectData.id)
          : typeof projectData.name === 'string'
            ? projectData.name
            : '',
      name:
        typeof projectData.name === 'string'
          ? projectData.name
          : typeof projectData.login === 'string'
            ? projectData.login
            : '',
      fullName:
        typeof projectData.full_name === 'string'
          ? projectData.full_name
          : typeof projectData.name_with_namespace === 'string'
            ? projectData.name_with_namespace
            : typeof projectData.name === 'string'
              ? projectData.name
              : '',
      description: typeof projectData.description === 'string' ? projectData.description : '',
      url:
        typeof projectData.html_url === 'string'
          ? projectData.html_url
          : typeof projectData.web_url === 'string'
            ? projectData.web_url
            : typeof projectData.url === 'string'
              ? projectData.url
              : '',
      visibility: this.normalizeVisibility(projectData.visibility ?? projectData.private),
      provider,
      createdAt:
        typeof projectData.created_at === 'string'
          ? projectData.created_at
          : typeof projectData.createdAt === 'string'
            ? projectData.createdAt
            : undefined,
      updatedAt:
        typeof projectData.updated_at === 'string'
          ? projectData.updated_at
          : typeof projectData.updatedAt === 'string'
            ? projectData.updatedAt
            : undefined,
      defaultBranch:
        typeof projectData.default_branch === 'string'
          ? projectData.default_branch
          : typeof projectData.defaultBranch === 'string'
            ? projectData.defaultBranch
            : undefined,
      repositoryCount:
        typeof projectData.public_repos === 'number'
          ? projectData.public_repos
          : typeof projectData.repository_count === 'number'
            ? projectData.repository_count
            : undefined,
      memberCount:
        typeof projectData.member_count === 'number' ? projectData.member_count : undefined,
    };
  }

  private normalizeProjectMember(member: ProviderMember, provider: string): ProjectMember {
    return {
      id:
        typeof member.id === 'string' || typeof member.id === 'number'
          ? String(member.id)
          : typeof member.username === 'string'
            ? member.username
            : '',
      username:
        typeof member.login === 'string'
          ? member.login
          : typeof member.username === 'string'
            ? member.username
            : typeof member.name === 'string'
              ? member.name
              : '',
      name: typeof member.name === 'string' ? member.name : undefined,
      email: typeof member.email === 'string' ? member.email : undefined,
      role: this.normalizeRole(member.role ?? member.permission ?? member.access_level),
      accessLevel:
        typeof member.access_level === 'number'
          ? member.access_level
          : this.roleToAccessLevel(
              typeof member.role === 'string'
                ? member.role
                : typeof member.permission === 'string'
                  ? member.permission
                  : 'member',
            ),
      provider,
    };
  }

  private normalizeVisibility(visibility: unknown): 'public' | 'private' | 'internal' {
    if (typeof visibility === 'boolean') {
      return visibility ? 'private' : 'public';
    }
    if (typeof visibility === 'string') {
      const vis = visibility.toLowerCase();
      if (['private', 'internal'].includes(vis)) return vis as 'private' | 'internal';
    }
    return 'public';
  }

  private normalizeRole(role: unknown): string {
    if (typeof role === 'number') {
      // GitLab access levels
      if (role >= 50) return 'owner';
      if (role >= 40) return 'maintainer';
      if (role >= 30) return 'developer';
      if (role >= 20) return 'reporter';
      return 'guest';
    }
    if (typeof role === 'string') {
      return role.toLowerCase();
    }
    return 'member';
  }

  private roleToAccessLevel(role: string): number {
    const roleMap: Record<string, number> = {
      guest: 10,
      reporter: 20,
      developer: 30,
      maintainer: 40,
      owner: 50,
      admin: 50,
    };
    return roleMap[role.toLowerCase()] || 20;
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_list_projects',
        description: 'List projects, organizations, or groups across all providers',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              description: 'Optional provider filter (github, gitlab, azure)',
            },
            visibility: {
              type: 'string',
              description: 'Filter by visibility',
              enum: ['public', 'private', 'internal', 'all'],
            },
            limit: {
              type: 'number',
              description: 'Maximum number of projects to return',
            },
          },
        },
      },
      {
        name: 'nexus_get_project',
        description: 'Get detailed information about a specific project/organization',
        inputSchema: {
          type: 'object',
          required: ['project'],
          properties: {
            project: {
              type: 'string',
              description:
                'Project identifier (e.g., "github:microsoft", "gitlab:gitlab-org", "azure:myorg")',
            },
          },
        },
      },
      {
        name: 'nexus_list_project_members',
        description: 'List members of a project/organization',
        inputSchema: {
          type: 'object',
          required: ['project'],
          properties: {
            project: {
              type: 'string',
              description:
                'Project identifier (e.g., "github:microsoft", "gitlab:gitlab-org", "azure:myorg")',
            },
            role: {
              type: 'string',
              description: 'Filter by role',
              enum: ['owner', 'admin', 'maintainer', 'developer', 'reporter', 'guest'],
            },
          },
        },
      },
      {
        name: 'nexus_add_project_member',
        description: 'Add a member to a project/organization',
        inputSchema: {
          type: 'object',
          required: ['project', 'username', 'role'],
          properties: {
            project: {
              type: 'string',
              description:
                'Project identifier (e.g., "github:microsoft", "gitlab:gitlab-org", "azure:myorg")',
            },
            username: {
              type: 'string',
              description: 'Username to add',
            },
            role: {
              type: 'string',
              description: 'Role to assign',
              enum: ['owner', 'admin', 'maintainer', 'developer', 'reporter', 'guest'],
            },
          },
        },
      },
      {
        name: 'nexus_remove_project_member',
        description: 'Remove a member from a project/organization',
        inputSchema: {
          type: 'object',
          required: ['project', 'username'],
          properties: {
            project: {
              type: 'string',
              description:
                'Project identifier (e.g., "github:microsoft", "gitlab:gitlab-org", "azure:myorg")',
            },
            username: {
              type: 'string',
              description: 'Username to remove',
            },
          },
        },
      },
    ];
  }
}
