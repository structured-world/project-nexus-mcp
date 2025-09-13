import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ProviderManager } from '../providers/ProviderManager.js';
import { WorkItemsManager } from '../abstraction/WorkItemsManager.js';
import { NexusConfig } from '../types/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createServer } from 'http';
import express from 'express';
import { TokenStorage } from '../utils/tokenStorage.js';
import { logger } from '../utils/logger.js';

export class NexusProxyServer {
  private server: Server;
  private providerManager: ProviderManager;
  private workItemsManager: WorkItemsManager;
  private config: NexusConfig;
  private httpServer?: ReturnType<typeof createServer>;
  private expressApp?: express.Application;
  private tokenStorage: TokenStorage;

  constructor() {
    this.server = new Server(
      {
        name: 'project-nexus-mcp',
        version: '1.0.0',
        description: 'Unified MCP proxy for DevOps platforms',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    this.providerManager = new ProviderManager();
    this.workItemsManager = new WorkItemsManager(this.providerManager);
    this.tokenStorage = new TokenStorage();

    this.config = {
      providers: [],
      projects: {},
    };

    this.setupHandlers();
    this.setupProviderEventHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, () => {
      const providerTools = this.providerManager.getAllTools();
      const unifiedTools = this.workItemsManager.createUnifiedTools();
      const additionalTools = this.createAdditionalTools();

      return {
        tools: [...providerTools, ...unifiedTools, ...additionalTools],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const safeArgs = args ?? {};

      if (name.startsWith('nexus_')) {
        return await this.handleNexusTool(name, safeArgs);
      }

      const result = await this.providerManager.callTool(name, safeArgs);
      return result as { [x: string]: unknown; _meta?: { [x: string]: unknown } | undefined };
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, () => {
      const resources = this.providerManager.getAllResources();
      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const result = await this.providerManager.readResource(uri);
      return result as { [x: string]: unknown; _meta?: { [x: string]: unknown } | undefined };
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, () => {
      const prompts = this.providerManager.getAllPrompts();
      return { prompts };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const result = await this.providerManager.getPrompt(name, args);
      return result as { [x: string]: unknown; _meta?: { [x: string]: unknown } | undefined };
    });
  }

  private setupProviderEventHandlers(): void {
    this.providerManager.on('provider:connected', (provider: { id: string }) => {
      logger.log(`🔗 Provider connected: ${provider.id}`);
    });

    this.providerManager.on('provider:disconnected', (provider: { id: string }) => {
      logger.log(`🔌 Provider disconnected: ${provider.id}`);
    });

    this.providerManager.on(
      'provider:error',
      ({ provider, error }: { provider: { id: string }; error: unknown }) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Provider error (${provider.id}): ${errorMessage}`);
      },
    );

    this.providerManager.on('provider:auth_failed', (provider: { id: string; error?: string }) => {
      const missingTokensInfo = this.getMissingTokensInfo(provider.id);
      logger.error(
        `🔑 Provider authentication failed (${provider.id}): ${provider.error ?? 'Missing authentication tokens'}`,
      );
      if (missingTokensInfo) {
        logger.log(`💡 ${missingTokensInfo}`);
      }
    });

    this.providerManager.on('provider:update-check', (provider: { id: string }) => {
      logger.log(`🔄 Checking updates for provider: ${provider.id}`);
    });
  }

  /**
   * Get information about missing tokens for a specific provider
   */
  private getMissingTokensInfo(providerId: string): string | null {
    switch (providerId) {
      case 'github':
        if (!process.env.GITHUB_TOKEN) {
          return 'Set GITHUB_TOKEN environment variable with your GitHub personal access token';
        }
        break;
      case 'gitlab':
        if (!process.env.GITLAB_TOKEN) {
          return 'Set GITLAB_TOKEN environment variable with your GitLab personal access token';
        }
        break;
      case 'azure': {
        const missingAzure: string[] = [];
        if (!process.env.AZURE_TOKEN) {
          missingAzure.push('AZURE_TOKEN');
        }
        if (!process.env.AZURE_ORG) {
          missingAzure.push('AZURE_ORG');
        }
        if (missingAzure.length > 0) {
          return `Set environment variables: ${missingAzure.join(', ')}`;
        }
        break;
      }
    }
    return null;
  }

  /**
   * Get information about all missing tokens
   */
  private getAllMissingTokensInfo(): Record<string, string> {
    const missing: Record<string, string> = {};

    const providers = ['github', 'gitlab', 'azure'];
    for (const providerId of providers) {
      const info = this.getMissingTokensInfo(providerId);
      if (info) {
        missing[providerId] = info;
      }
    }

    return missing;
  }

  private async handleNexusTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    switch (name) {
      case 'nexus_list_work_items': {
        const project = typeof args.project === 'string' ? args.project : undefined;
        const items = await this.workItemsManager.listWorkItems(project, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      }

      case 'nexus_create_work_item': {
        if (typeof args.project !== 'string') {
          throw new Error('Project parameter must be a string');
        }
        const created = await this.workItemsManager.createWorkItem(args.project, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(created, null, 2),
            },
          ],
        };
      }

      case 'nexus_update_work_item': {
        if (typeof args.id !== 'string') {
          throw new Error('ID parameter must be a string');
        }
        const updated = await this.workItemsManager.updateWorkItem(args.id, args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(updated, null, 2),
            },
          ],
        };
      }

      case 'nexus_transfer_work_item': {
        if (typeof args.source_id !== 'string' || typeof args.target_project !== 'string') {
          throw new Error('source_id and target_project parameters must be strings');
        }
        const transferred = await this.workItemsManager.transferWorkItem(
          args.source_id,
          args.target_project,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(transferred, null, 2),
            },
          ],
        };
      }

      case 'nexus_reload_provider': {
        if (typeof args.provider_id !== 'string') {
          throw new Error('provider_id parameter must be a string');
        }
        await this.providerManager.reloadProvider(args.provider_id);
        return {
          content: [
            {
              type: 'text',
              text: `Provider ${args.provider_id} reloaded successfully`,
            },
          ],
        };
      }

      case 'nexus_provider_status': {
        const providers = this.providerManager.getAllProviders();
        const status = providers.map((p) => ({
          id: p.id,
          name: p.config.name,
          status: p.status,
          tools: p.tools.size,
          resources: p.resources.size,
          error: p.error,
          errorType: p.errorType,
          shouldReconnect: p.shouldReconnect,
          reconnectAttempts: p.reconnectAttempts ?? 0,
          lastUpdated: p.lastUpdated?.toISOString(),
        }));

        // Add helpful information about missing tokens
        const statusWithHelp = {
          providers: status,
          missingTokens: this.getAllMissingTokensInfo(),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(statusWithHelp, null, 2),
            },
          ],
        };
      }

      case 'nexus_restart_all_providers': {
        // Check if debug tools are enabled
        if (process.env.NEXUS_DEBUG_TOOLS !== 'true') {
          throw new Error('Debug tools are not enabled. Set NEXUS_DEBUG_TOOLS=true to enable.');
        }

        await this.providerManager.restartAllProviders();
        return {
          content: [
            {
              type: 'text',
              text: 'All providers have been restarted',
            },
          ],
        };
      }

      case 'nexus_exit_server': {
        // Check if debug tools are enabled
        if (process.env.NEXUS_DEBUG_TOOLS !== 'true') {
          throw new Error('Debug tools are not enabled. Set NEXUS_DEBUG_TOOLS=true to enable.');
        }

        // Initiate graceful shutdown
        logger.log('Debug exit requested - shutting down server...');

        // Return response first
        const response = {
          content: [
            {
              type: 'text',
              text: 'Server shutdown initiated',
            },
          ],
        };

        // Schedule shutdown after response is sent
        setTimeout(() => {
          void (async () => {
            try {
              await this.shutdown();
              process.exit(0);
            } catch (error) {
              logger.error(
                `Error during shutdown: ${error instanceof Error ? error.message : String(error)}`,
              );
              process.exit(1);
            }
          })();
        }, 100);

        return response;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private createAdditionalTools(): Tool[] {
    const tools: Tool[] = [
      {
        name: 'nexus_reload_provider',
        description: 'Reload a specific provider (useful for updating to new versions)',
        inputSchema: {
          type: 'object',
          required: ['provider_id'],
          properties: {
            provider_id: {
              type: 'string',
              description: 'Provider ID to reload (e.g., "github", "gitlab", "azure")',
            },
          },
        },
      },
      {
        name: 'nexus_provider_status',
        description: 'Get status of all configured providers',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];

    // Add debug tools only if environment variable is set
    if (process.env.NEXUS_DEBUG_TOOLS === 'true') {
      tools.push(
        {
          name: 'nexus_restart_all_providers',
          description: '[DEBUG] Restart all child MCP server providers',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'nexus_exit_server',
          description: '[DEBUG] Shut down the Nexus proxy server (allows restart from Claude Code)',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      );
    }

    return tools;
  }

  async loadConfig(configPath?: string): Promise<void> {
    const defaultPath = path.join(process.cwd(), '.mcp.json');
    const finalPath = configPath ?? defaultPath;

    try {
      const configData = await fs.readFile(finalPath, 'utf-8');
      const rawConfig: unknown = JSON.parse(configData);

      if (rawConfig && typeof rawConfig === 'object') {
        this.config = await this.parseConfig(rawConfig as Record<string, unknown>);
        process.stdout.write(`Loaded configuration from ${finalPath}\n`);
      } else {
        throw new Error('Invalid configuration format');
      }
    } catch {
      logger.log(`Could not load config from ${finalPath}, using environment variables`);
      this.config = this.loadConfigFromEnv();
    }
  }

  private async parseConfig(rawConfig: Record<string, unknown>): Promise<NexusConfig> {
    const config: NexusConfig = {
      providers: [],
      projects:
        typeof rawConfig.projects === 'object' && rawConfig.projects !== null
          ? (rawConfig.projects as Record<string, string>)
          : {},
    };

    // Load stored tokens
    await this.tokenStorage.loadTokens();

    if (process.env.DEFAULT_REPOSITORY) {
      config.defaultRepository = process.env.DEFAULT_REPOSITORY;
    }
    if (process.env.DEFAULT_TASK) {
      config.defaultTask = process.env.DEFAULT_TASK;
    }

    const providers = [];

    if (process.env.GITHUB_TOKEN) {
      providers.push({
        id: 'github',
        name: 'GitHub',
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        },
        enabled: true,
        autoUpdate: true,
      });
    }

    if (process.env.GITLAB_TOKEN) {
      providers.push({
        id: 'gitlab',
        name: 'GitLab',
        type: 'stdio' as const,
        command: 'uv',
        args: [
          'run',
          '--python',
          '3.13',
          '--with',
          'git+https://github.com/polaz/gitlab-mcp.git',
          'python',
          '-m',
          'gitlab_mcp',
        ],
        env: {
          GITLAB_PERSONAL_ACCESS_TOKEN: process.env.GITLAB_TOKEN,
          GITLAB_API_URL: process.env.GITLAB_URL ?? 'https://gitlab.com/api/v4',
        },
        enabled: true,
        autoUpdate: true,
      });
    }

    if (process.env.AZURE_TOKEN) {
      providers.push({
        id: 'azure',
        name: 'Azure DevOps',
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@azure-devops/mcp', process.env.AZURE_ORG ?? 'your-org'],
        env: {
          AZURE_DEVOPS_PAT: process.env.AZURE_TOKEN,
        },
        enabled: true,
        autoUpdate: true,
      });
    }

    config.providers = providers;

    return config;
  }

  private loadConfigFromEnv(): NexusConfig {
    const config: NexusConfig = {
      providers: [],
      projects: {},
    };

    if (process.env.DEFAULT_REPOSITORY) {
      config.defaultRepository = process.env.DEFAULT_REPOSITORY;
      config.projects[''] = process.env.DEFAULT_REPOSITORY;
    }
    if (process.env.DEFAULT_TASK) {
      config.defaultTask = process.env.DEFAULT_TASK;
    }

    const providers = [];

    if (process.env.GITHUB_TOKEN) {
      providers.push({
        id: 'github',
        name: 'GitHub',
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        },
        enabled: true,
        autoUpdate: true,
      });
    }

    if (process.env.GITLAB_TOKEN) {
      providers.push({
        id: 'gitlab',
        name: 'GitLab',
        type: 'stdio' as const,
        command: 'uv',
        args: [
          'run',
          '--python',
          '3.13',
          '--with',
          'git+https://github.com/polaz/gitlab-mcp.git',
          'python',
          '-m',
          'gitlab_mcp',
        ],
        env: {
          GITLAB_PERSONAL_ACCESS_TOKEN: process.env.GITLAB_TOKEN,
          GITLAB_API_URL: process.env.GITLAB_URL ?? 'https://gitlab.com/api/v4',
        },
        enabled: true,
        autoUpdate: true,
      });
    }

    if (process.env.AZURE_TOKEN) {
      providers.push({
        id: 'azure',
        name: 'Azure DevOps',
        type: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@azure-devops/mcp', process.env.AZURE_ORG ?? 'your-org'],
        env: {
          AZURE_DEVOPS_PAT: process.env.AZURE_TOKEN,
        },
        enabled: true,
        autoUpdate: true,
      });
    }

    config.providers = providers;

    return config;
  }

  async initialize(): Promise<void> {
    await this.loadConfig();

    logger.log(`\n=== Project Nexus MCP Server Initialization ===`);
    logger.log(`Found ${this.config.providers.length} provider(s) in configuration`);

    // Initialize all providers asynchronously without blocking
    const initPromises = this.config.providers.map(async (providerConfig) => {
      if (providerConfig.enabled) {
        logger.log(`Initializing provider: ${providerConfig.name} (${providerConfig.id})...`);
        try {
          await this.providerManager.initializeProvider(providerConfig);
          logger.log(`✓ ${providerConfig.name} initialized successfully`);
        } catch (error) {
          logger.error(
            `✗ Failed to initialize provider ${providerConfig.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else {
        logger.log(`- ${providerConfig.name} is disabled`);
      }
    });

    // Wait for all providers to attempt initialization (but don't fail if they error)
    await Promise.allSettled(initPromises);

    // Print final status
    this.printProviderStatus();

    this.providerManager.startAutoUpdate(3600000); // 1 hour
  }

  async runStdio(): Promise<void> {
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.log('\n🚀 Project Nexus MCP Server running in STDIO mode');
    logger.log('📡 Ready to receive MCP requests\n');
  }

  async runHttp(port: number = 3000): Promise<void> {
    await this.initialize();

    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');

    this.expressApp = express();
    this.expressApp.use(express.json());

    this.expressApp.get('/sse', async (_req, res) => {
      const transport = new SSEServerTransport('/message', res);
      await this.server.connect(transport);
    });

    this.expressApp.post('/message', (_req, res) => {
      // HTTP transport not yet available
      res.status(501).json({ error: 'HTTP transport not yet implemented' });
    });

    this.expressApp.get('/health', (_req, res) => {
      const providers = this.providerManager.getAllProviders();
      res.json({
        status: 'healthy',
        providers: providers.map((p) => ({
          id: p.id,
          status: p.status,
          tools: p.tools.size,
        })),
      });
    });

    this.httpServer = createServer(this.expressApp);
    this.httpServer.listen(port, () => {
      process.stdout.write(`Project Nexus MCP Server running on http://localhost:${port}\n`);
      process.stdout.write(`SSE endpoint: http://localhost:${port}/sse\n`);
      process.stdout.write(`HTTP endpoint: http://localhost:${port}/message\n`);
      process.stdout.write(`Health check: http://localhost:${port}/health\n`);
    });
  }

  private printProviderStatus(): void {
    const providers = this.providerManager.getAllProviders();

    logger.log(`\\n=== Provider Status Summary ===`);

    if (providers.length === 0) {
      logger.warn(`⚠️  No providers configured. Set environment variables:`);
      logger.log(`   GITHUB_TOKEN - for GitHub integration`);
      logger.log(`   GITLAB_TOKEN - for GitLab integration`);
      logger.log(`   AZURE_TOKEN - for Azure DevOps integration\\n`);
      return;
    }

    let connectedCount = 0;
    for (const provider of providers) {
      const status =
        provider.status === 'connected' ? '🟢' : provider.status === 'error' ? '🔴' : '🟡';

      logger.log(`${status} ${provider.config.name} (${provider.id}): ${provider.status}`);

      if (provider.status === 'connected') {
        connectedCount++;
        logger.log(
          `   Tools: ${provider.tools.size}, Resources: ${provider.resources.size}, Prompts: ${provider.prompts.size}`,
        );
      } else if (provider.status === 'error' && provider.error) {
        logger.error(`   Error: ${provider.error}`);
      }
    }

    logger.log(`\\n✨ ${connectedCount}/${providers.length} providers connected successfully`);

    if (connectedCount > 0) {
      const totalTools = this.providerManager.getAllTools().length;
      const unifiedTools = this.workItemsManager.createUnifiedTools().length;
      const additionalTools = this.createAdditionalTools().length;

      logger.log(`📋 Available tools: ${totalTools + unifiedTools + additionalTools} total`);
      logger.log(`   - Provider tools: ${totalTools}`);
      logger.log(`   - Unified work item tools: ${unifiedTools}`);
      logger.log(`   - Management tools: ${additionalTools}`);
    }

    logger.log(`=====================================`);
  }

  async shutdown(): Promise<void> {
    logger.log(`\\n🛑 Shutting down Project Nexus MCP Server...`);

    await this.providerManager.shutdown();

    if (this.httpServer) {
      this.httpServer.close();
    }

    await this.server.close();

    logger.log(`✅ Server shutdown complete`);
  }
}
