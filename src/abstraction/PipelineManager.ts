import { ProviderManager } from '../providers/ProviderManager.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasTextContent } from '../utils/typeGuards.js';

export interface Pipeline {
  id: string;
  name: string;
  status: 'success' | 'failure' | 'running' | 'pending' | 'cancelled' | 'skipped';
  url: string;
  branch: string;
  commit: string;
  author: string;
  provider: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
}

export interface PipelineJob {
  id: string;
  name: string;
  status: 'success' | 'failure' | 'running' | 'pending' | 'cancelled' | 'skipped';
  stage?: string;
  url?: string;
  provider: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
}

export interface PipelineArtifact {
  id: string;
  name: string;
  size?: number;
  url?: string;
  downloadUrl?: string;
  provider: string;
  createdAt?: string;
  expiresAt?: string;
}

export class PipelineManager {
  constructor(protected providerManager: ProviderManager) {}

  protected detectProviderFromProject(project: string): string {
    const [provider] = project.split(':');
    return provider;
  }

  async listPipelines(
    project: string,
    repositoryName: string,
    filters?: Record<string, unknown>,
  ): Promise<Pipeline[]> {
    const provider = this.detectProviderFromProject(project);

    if (provider && provider !== '') {
      // Single provider operation
      return this.listPipelinesFromProvider(
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
          return await this.listPipelinesFromProvider(
            providerInstance.id,
            repositoryName, // Use repo name as owner for multi-provider search
            repositoryName,
            filters,
          );
        } catch (error) {
          console.error(
            `Error listing pipelines from ${providerInstance.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return [];
        }
      });

      const results = await Promise.allSettled(promises);
      const pipelines: Pipeline[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          pipelines.push(...result.value);
        }
      }

      return pipelines;
    }
  }

  private async listPipelinesFromProvider(
    provider: string,
    owner: string,
    repositoryName: string,
    filters?: Record<string, unknown>,
  ): Promise<Pipeline[]> {
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_workflow_runs`,
      `${provider}_list_pipelines`,
      `${provider}_list_builds`,
      `${provider}_list_actions`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            ...filters,
            owner,
            repo: repositoryName,
            repository: repositoryName,
            project: `${owner}/${repositoryName}`,
          });

          if (hasTextContent(result)) {
            const pipelinesJson = result.content[0].text;
            const parsedPipelines: unknown = JSON.parse(pipelinesJson);

            if (Array.isArray(parsedPipelines)) {
              return parsedPipelines.map((pipeline: any) =>
                this.normalizePipeline(pipeline, provider),
              );
            }
          }
        } catch (error) {
          console.error(
            `Error listing pipelines from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  async getPipeline(
    project: string,
    repositoryName: string,
    pipelineId: string,
  ): Promise<Pipeline | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_get_workflow_run`,
      `${provider}_get_pipeline`,
      `${provider}_get_build`,
      `${provider}_get_action_run`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            project: `${project.split(':')[1]}/${repositoryName}`,
            run_id: pipelineId,
            pipeline_id: pipelineId,
            build_id: pipelineId,
            id: pipelineId,
          });

          if (hasTextContent(result)) {
            const pipelineJson = result.content[0].text;
            const parsedPipeline: unknown = JSON.parse(pipelineJson);
            return this.normalizePipeline(parsedPipeline, provider);
          }
        } catch (error) {
          console.error(
            `Error getting pipeline ${pipelineId} from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async triggerPipeline(
    project: string,
    repositoryName: string,
    options: {
      ref?: string;
      workflow?: string;
      inputs?: Record<string, unknown>;
    },
  ): Promise<Pipeline | null> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_run_workflow`,
      `${provider}_trigger_pipeline`,
      `${provider}_start_build`,
      `${provider}_dispatch_workflow`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            project: `${project.split(':')[1]}/${repositoryName}`,
            ref: options.ref || 'main',
            workflow_id: options.workflow,
            workflow: options.workflow,
            inputs: options.inputs || {},
          });

          if (hasTextContent(result)) {
            const pipelineJson = result.content[0].text;
            const parsedPipeline: unknown = JSON.parse(pipelineJson);
            return this.normalizePipeline(parsedPipeline, provider);
          }
        } catch (error) {
          console.error(
            `Error triggering pipeline in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return null;
  }

  async cancelPipeline(
    project: string,
    repositoryName: string,
    pipelineId: string,
  ): Promise<boolean> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_cancel_workflow_run`,
      `${provider}_cancel_pipeline`,
      `${provider}_cancel_build`,
      `${provider}_stop_workflow`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            project: `${project.split(':')[1]}/${repositoryName}`,
            run_id: pipelineId,
            pipeline_id: pipelineId,
            build_id: pipelineId,
            id: pipelineId,
          });

          return hasTextContent(result);
        } catch (error) {
          console.error(
            `Error cancelling pipeline ${pipelineId} in ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return false;
  }

  async getPipelineJobs(
    project: string,
    repositoryName: string,
    pipelineId: string,
  ): Promise<PipelineJob[]> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_workflow_jobs`,
      `${provider}_list_pipeline_jobs`,
      `${provider}_list_build_jobs`,
      `${provider}_get_workflow_run_jobs`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            project: `${project.split(':')[1]}/${repositoryName}`,
            run_id: pipelineId,
            pipeline_id: pipelineId,
            build_id: pipelineId,
            id: pipelineId,
          });

          if (hasTextContent(result)) {
            const jobsJson = result.content[0].text;
            const parsedJobs: unknown = JSON.parse(jobsJson);

            if (Array.isArray(parsedJobs)) {
              return parsedJobs.map((job: any) => this.normalizePipelineJob(job, provider));
            }
          }
        } catch (error) {
          console.error(
            `Error getting pipeline jobs from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  async getPipelineLogs(
    project: string,
    repositoryName: string,
    pipelineId: string,
    jobId?: string,
  ): Promise<string> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_get_workflow_run_logs`,
      `${provider}_get_job_logs`,
      `${provider}_get_pipeline_logs`,
      `${provider}_get_build_logs`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            project: `${project.split(':')[1]}/${repositoryName}`,
            run_id: pipelineId,
            pipeline_id: pipelineId,
            build_id: pipelineId,
            job_id: jobId,
            id: pipelineId,
          });

          if (hasTextContent(result)) {
            return result.content[0].text;
          }
        } catch (error) {
          console.error(
            `Error getting pipeline logs from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return '';
  }

  async getPipelineArtifacts(
    project: string,
    repositoryName: string,
    pipelineId: string,
  ): Promise<PipelineArtifact[]> {
    const provider = this.detectProviderFromProject(project);
    const providerInstance = this.providerManager.getProvider(provider);

    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    const possibleTools = [
      `${provider}_list_workflow_run_artifacts`,
      `${provider}_list_pipeline_artifacts`,
      `${provider}_list_build_artifacts`,
      `${provider}_get_artifacts`,
    ];

    for (const toolName of possibleTools) {
      if (providerInstance.tools.has(toolName)) {
        try {
          const result = await this.providerManager.callTool(toolName, {
            owner: project.split(':')[1],
            repo: repositoryName,
            repository: repositoryName,
            project: `${project.split(':')[1]}/${repositoryName}`,
            run_id: pipelineId,
            pipeline_id: pipelineId,
            build_id: pipelineId,
            id: pipelineId,
          });

          if (hasTextContent(result)) {
            const artifactsJson = result.content[0].text;
            const parsedArtifacts: unknown = JSON.parse(artifactsJson);

            if (Array.isArray(parsedArtifacts)) {
              return parsedArtifacts.map((artifact: any) =>
                this.normalizePipelineArtifact(artifact, provider),
              );
            }
          }
        } catch (error) {
          console.error(
            `Error getting pipeline artifacts from ${provider}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return [];
  }

  private normalizePipeline(pipeline: any, provider: string): Pipeline {
    return {
      id: pipeline.id?.toString() || pipeline.run_id?.toString() || '',
      name: pipeline.name || pipeline.workflow?.name || pipeline.display_name || '',
      status: this.normalizeStatus(pipeline.status || pipeline.conclusion || pipeline.state),
      url: pipeline.html_url || pipeline.web_url || pipeline.url || '',
      branch: pipeline.head_branch || pipeline.ref || pipeline.branch || '',
      commit: pipeline.head_sha || pipeline.sha || pipeline.commit?.id || '',
      author:
        pipeline.actor?.login || pipeline.user?.username || pipeline.triggering_actor?.login || '',
      provider: provider,
      createdAt: pipeline.created_at || pipeline.createdAt,
      startedAt: pipeline.run_started_at || pipeline.started_at || pipeline.startedAt,
      finishedAt: pipeline.updated_at || pipeline.finished_at || pipeline.finishedAt,
      duration: this.calculateDuration(
        pipeline.run_started_at || pipeline.started_at,
        pipeline.updated_at || pipeline.finished_at,
      ),
    };
  }

  private normalizePipelineJob(job: any, provider: string): PipelineJob {
    return {
      id: job.id?.toString() || '',
      name: job.name || job.job_name || '',
      status: this.normalizeStatus(job.status || job.conclusion || job.state),
      stage: job.stage || job.workflow_name,
      url: job.html_url || job.web_url || job.url,
      provider: provider,
      createdAt: job.created_at || job.createdAt,
      startedAt: job.started_at || job.startedAt,
      finishedAt: job.completed_at || job.finished_at || job.finishedAt,
      duration: this.calculateDuration(
        job.started_at || job.startedAt,
        job.completed_at || job.finished_at,
      ),
    };
  }

  private normalizePipelineArtifact(artifact: any, provider: string): PipelineArtifact {
    return {
      id: artifact.id?.toString() || '',
      name: artifact.name || '',
      size: artifact.size_in_bytes || artifact.size,
      url: artifact.url || artifact.web_url,
      downloadUrl: artifact.archive_download_url || artifact.download_url,
      provider: provider,
      createdAt: artifact.created_at || artifact.createdAt,
      expiresAt: artifact.expires_at || artifact.expiresAt,
    };
  }

  private normalizeStatus(
    status: string,
  ): 'success' | 'failure' | 'running' | 'pending' | 'cancelled' | 'skipped' {
    const lowStatus = status?.toLowerCase() || '';
    if (['success', 'successful', 'passed', 'completed'].includes(lowStatus)) return 'success';
    if (['failure', 'failed', 'error'].includes(lowStatus)) return 'failure';
    if (['running', 'in_progress', 'pending'].includes(lowStatus)) return 'running';
    if (['queued', 'waiting'].includes(lowStatus)) return 'pending';
    if (['cancelled', 'canceled'].includes(lowStatus)) return 'cancelled';
    if (['skipped'].includes(lowStatus)) return 'skipped';
    return 'pending';
  }

  private calculateDuration(startedAt?: string, finishedAt?: string): number | undefined {
    if (!startedAt || !finishedAt) return undefined;
    const start = new Date(startedAt);
    const finish = new Date(finishedAt);
    return Math.floor((finish.getTime() - start.getTime()) / 1000); // seconds
  }

  createUnifiedTools(): Tool[] {
    return [
      {
        name: 'nexus_list_pipelines',
        description: 'List CI/CD pipelines (workflows/builds) for a repository',
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
            status: {
              type: 'string',
              description: 'Filter by status',
              enum: ['success', 'failure', 'running', 'pending', 'cancelled', 'all'],
            },
            branch: {
              type: 'string',
              description: 'Filter by branch',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of pipelines to return',
            },
          },
        },
      },
      {
        name: 'nexus_get_pipeline',
        description: 'Get detailed information about a specific pipeline run',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'pipeline_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            pipeline_id: {
              type: 'string',
              description: 'Pipeline run ID',
            },
          },
        },
      },
      {
        name: 'nexus_trigger_pipeline',
        description: 'Trigger a new pipeline run',
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
            ref: {
              type: 'string',
              description: 'Branch, tag, or commit SHA (default: main)',
            },
            workflow: {
              type: 'string',
              description: 'Workflow/pipeline name (if multiple exist)',
            },
            inputs: {
              type: 'object',
              description: 'Workflow inputs/parameters',
            },
          },
        },
      },
      {
        name: 'nexus_cancel_pipeline',
        description: 'Cancel a running pipeline',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'pipeline_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            pipeline_id: {
              type: 'string',
              description: 'Pipeline run ID to cancel',
            },
          },
        },
      },
      {
        name: 'nexus_get_pipeline_jobs',
        description: 'List jobs within a pipeline run',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'pipeline_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            pipeline_id: {
              type: 'string',
              description: 'Pipeline run ID',
            },
          },
        },
      },
      {
        name: 'nexus_get_pipeline_logs',
        description: 'Get logs from a pipeline run or specific job',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'pipeline_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            pipeline_id: {
              type: 'string',
              description: 'Pipeline run ID',
            },
            job_id: {
              type: 'string',
              description: 'Optional: specific job ID to get logs for',
            },
          },
        },
      },
      {
        name: 'nexus_get_pipeline_artifacts',
        description: 'List artifacts produced by a pipeline run',
        inputSchema: {
          type: 'object',
          required: ['project', 'repository', 'pipeline_id'],
          properties: {
            project: {
              type: 'string',
              description: 'Project identifier (e.g., "github:owner", "gitlab:group", "azure:org")',
            },
            repository: {
              type: 'string',
              description: 'Repository name',
            },
            pipeline_id: {
              type: 'string',
              description: 'Pipeline run ID',
            },
          },
        },
      },
    ];
  }
}
