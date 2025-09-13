import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { ProviderConfig, ProviderInstance, QueuedRequest } from '../types/index.js';
import { classifyError, shouldAttemptReconnection } from '../utils/errorClassifier.js';
import { hasTextContent } from '../utils/typeGuards.js';
import { ProjectCacheData, UserRole } from '../cache/CacheManager.js';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export class ProviderManager extends EventEmitter {
  private providers: Map<string, ProviderInstance> = new Map();
  private updateCheckInterval?: NodeJS.Timeout;
  private reconnectionTimers: Map<string, NodeJS.Timeout> = new Map();

  // Cache structure: [provider -> projects] and [provider -> project -> users]
  private projectsCache: Map<string, ProjectCacheData[]> = new Map();
  private usersCache: Map<string, Map<string, UserRole[]>> = new Map();

  // Request queuing constants
  private static readonly REQUEST_TIMEOUT_MS = 30000; // 30 seconds

  async initializeProvider(config: ProviderConfig): Promise<ProviderInstance> {
    const { logger } = await import('../utils/logger.js');
    logger.debug(`=== Initializing ${config.id} Provider ===`);
    logger.debug(`  Provider: ${config.name}`);
    logger.debug(`  Type: ${config.type}`);
    logger.debug(`  Command: ${config.command}`);
    logger.debug(`  Args: [${config.args?.join(', ') ?? 'none'}]`);

    // Validate tokens before attempted to initialize
    const hasRequiredTokens = this.validateProviderTokens(config, logger);
    logger.debug(`  Token validation: ${hasRequiredTokens ? 'PASSED' : 'FAILED'}`);

    if (!hasRequiredTokens) {
      const instance: ProviderInstance = {
        id: config.id,
        config,
        tools: new Map(),
        resources: new Map(),
        prompts: new Map(),
        status: 'auth_failed',
        error: 'Required authentication tokens are missing',
        errorType: 'auth',
        shouldReconnect: false,
        lastUpdated: new Date(),
      };
      logger.warn(`  ❌ Skipping initialization - missing required tokens`);
      this.providers.set(config.id, instance);
      this.emit('provider:auth_failed', instance);
      return instance;
    }

    const instance: ProviderInstance = {
      id: config.id,
      config,
      tools: new Map(),
      resources: new Map(),
      prompts: new Map(),
      status: 'starting',
      reconnectAttempts: 0,
      lastUpdated: new Date(),
      isUpdating: false,
      requestQueue: [],
    };

    try {
      logger.debug(`  Creating client transport...`);

      if (config.type === 'stdio' && config.command) {
        instance.client = await this.createStdioClient(config, logger);
        logger.debug(`  ✓ STDIO client created successfully`);
      } else if (config.type === 'sse' && config.url) {
        instance.client = await this.createSSEClient(config);
        logger.debug(`  ✓ SSE client created successfully`);
      } else if (config.type === 'http' && config.url) {
        instance.client = await this.createHTTPClient(config);
        logger.debug(`  ✓ HTTP client created successfully`);
      }

      if (instance.client) {
        logger.debug(`  Loading capabilities from ${config.name}...`);
        await this.connectAndLoadCapabilities(instance, logger);
        logger.debug(`  ✓ Capabilities loaded from ${config.name}`);
      } else {
        throw new Error(`Failed to create client for ${config.id}`);
      }

      instance.status = 'connected';
      instance.reconnectAttempts = 0; // Reset on successful connection
      this.setupProviderMonitoring(instance);
      this.providers.set(config.id, instance);
      logger.log(`  ✅ Provider ${config.id} initialized successfully`);
      this.emit('provider:connected', instance);
    } catch (error) {
      logger.error(
        `  ❌ Provider ${config.id} initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      const classification = classifyError(error);

      instance.status = classification.type === 'auth' ? 'auth_failed' : 'error';
      instance.error = classification.message;
      instance.errorType = classification.type;
      instance.shouldReconnect = classification.shouldReconnect;
      instance.lastUpdated = new Date();

      this.providers.set(config.id, instance);

      if (classification.type === 'auth') {
        this.emit('provider:auth_failed', instance);
      } else {
        this.emit('provider:error', { provider: instance, error });

        // Schedule reconnection for non-auth errors if appropriate
        if (classification.shouldReconnect) {
          this.scheduleReconnection(instance);
        }
      }

      process.stderr.write(
        `Failed to initialize provider ${config.id}: ${classification.message}\n`,
      );
    }

    return instance;
  }

  private async createStdioClient(
    config: ProviderConfig,
    logger: { debug: (msg: string) => void },
  ): Promise<Client> {
    const client = new Client(
      {
        name: `nexus-proxy-${config.id}`,
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    const command = config.command;
    if (!command) {
      throw new Error('Command is required for STDIO transport');
    }
    const args = config.args ?? [];
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...config.env })
        .filter(([, value]) => value !== undefined && typeof value === 'string')
        .map(([key, value]) => [key, value as string]),
    );

    logger.debug(`  Spawning: ${command} ${args.join(' ')}`);

    // Add debug logging for Azure specifically
    if (config.id === 'azure') {
      logger.debug(`  Azure environment variables:`);
      for (const [key, value] of Object.entries(env)) {
        if (key.includes('AZURE')) {
          logger.debug(`    ${key}: ${value ? '[SET]' : '[NOT SET]'}`);
        }
      }
    }

    const transport = new StdioClientTransport({
      command,
      args,
      env,
    });

    try {
      await client.connect(transport);
      if (config.id === 'azure') {
        logger.debug(`  Azure MCP client connected successfully`);
      }
    } catch (error) {
      if (config.id === 'azure') {
        logger.debug(
          `  Azure MCP connection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }

    return client;
  }

  private async createSSEClient(config: ProviderConfig): Promise<Client> {
    const client = new Client(
      {
        name: `nexus-proxy-${config.id}`,
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    if (!config.url) {
      throw new Error('URL is required for SSE transport');
    }
    const transport = new SSEClientTransport(new URL(config.url));

    await client.connect(transport);

    return client;
  }

  private async createHTTPClient(config: ProviderConfig): Promise<Client> {
    if (!config.url) {
      throw new Error('URL is required for HTTP transport');
    }

    const client = new Client(
      {
        name: 'nexus-proxy-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    // Use Streamable HTTP transport for MCP communication
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers ?? {},
      },
    });
    await client.connect(transport);
    return client;
  }

  private async connectAndLoadCapabilities(
    instance: ProviderInstance,
    logger: { debug: (msg: string) => void },
  ): Promise<void> {
    const client = instance.client;

    if (!client) {
      throw new Error('Client not initialized');
    }

    logger.debug(`    Listing tools...`);
    try {
      const listToolsResult = await client.listTools();
      logger.debug(`    ✓ Found ${listToolsResult.tools.length} tools`);
      for (const tool of listToolsResult.tools) {
        const prefixedName = `${instance.id}_${tool.name}`;
        instance.tools.set(prefixedName, {
          ...tool,
          name: prefixedName,
          description: `[${instance.config.name}] ${tool.description ?? ''}`,
        });
      }
    } catch (error) {
      logger.debug(
        `    ❌ Could not list tools for ${instance.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    logger.debug(`    Listing resources...`);
    try {
      const listResourcesResult = await client.listResources();
      logger.debug(`    ✓ Found ${listResourcesResult.resources.length} resources`);
      for (const resource of listResourcesResult.resources) {
        const prefixedUri = `${instance.id}:${resource.uri}`;
        instance.resources.set(prefixedUri, {
          ...resource,
          uri: prefixedUri,
          name: `[${instance.config.name}] ${resource.name}`,
        });
      }
    } catch (error) {
      logger.debug(
        `    ❌ Could not list resources for ${instance.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    logger.debug(`    Listing prompts...`);
    try {
      const listPromptsResult = await client.listPrompts();
      logger.debug(`    ✓ Found ${listPromptsResult.prompts.length} prompts`);
      for (const prompt of listPromptsResult.prompts) {
        const prefixedName = `${instance.id}_${prompt.name}`;
        instance.prompts.set(prefixedName, {
          ...prompt,
          name: prefixedName,
          description: `[${instance.config.name}] ${prompt.description ?? ''}`,
        });
      }
    } catch (error) {
      logger.debug(
        `    ❌ Could not list prompts for ${instance.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async reloadProvider(providerId: string): Promise<void> {
    const existingProvider = this.providers.get(providerId);
    if (!existingProvider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    process.stdout.write(`Reloading provider: ${providerId}\n`);

    // Set updating state to queue incoming requests
    await this.setProviderUpdating(providerId, true);

    try {
      await this.disconnectProvider(providerId);

      // Reset reconnection attempts when manually reloading
      existingProvider.reconnectAttempts = 0;
      existingProvider.lastReconnectTime = undefined;
      existingProvider.error = undefined;
      existingProvider.errorType = undefined;
      existingProvider.shouldReconnect = undefined;

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await this.initializeProvider(existingProvider.config);

      // Clear updating state and process queued requests
      await this.setProviderUpdating(providerId, false);
    } catch (error) {
      // If reload failed, still clear updating state but don't process queue
      const provider = this.providers.get(providerId);
      if (provider) {
        provider.isUpdating = false;
        provider.status = 'error';
        provider.updateStartTime = undefined;
        // Clear the request queue with errors
        if (provider.requestQueue) {
          for (const request of provider.requestQueue) {
            if (request.timeoutId) {
              clearTimeout(request.timeoutId);
            }
            request.reject(
              new Error(
                `Provider reload failed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            );
          }
          provider.requestQueue = [];
        }
      }
      throw error;
    }
  }

  async disconnectProvider(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return;
    }

    // Clear any pending reconnection timer
    const existingTimer = this.reconnectionTimers.get(providerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectionTimers.delete(providerId);
    }

    if (provider.client) {
      try {
        await provider.client.close();
      } catch (error) {
        process.stderr.write(
          `Error closing client for ${providerId}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }

    provider.status = 'disconnected';
    provider.lastUpdated = new Date();
    this.emit('provider:disconnected', provider);
  }

  getAllTools(): Tool[] {
    const allTools: Tool[] = [];
    for (const provider of this.providers.values()) {
      if (provider.status === 'connected') {
        const filteredTools = Array.from(provider.tools.values()).filter((tool) => {
          // Hide internal GitLab tools that should not be exposed to clients
          if (tool.name === 'gitlab_list_user_projects') {
            return false;
          }
          return true;
        });
        allTools.push(...filteredTools);
      }
    }
    return allTools;
  }

  getAllResources(): Resource[] {
    const allResources: Resource[] = [];
    for (const provider of this.providers.values()) {
      if (provider.status === 'connected') {
        allResources.push(...Array.from(provider.resources.values()));
      }
    }
    return allResources;
  }

  getAllPrompts(): Prompt[] {
    const allPrompts: Prompt[] = [];
    for (const provider of this.providers.values()) {
      if (provider.status === 'connected') {
        allPrompts.push(...Array.from(provider.prompts.values()));
      }
    }
    return allPrompts;
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const providerId = toolName.split('_')[0];
    const originalToolName = toolName.substring(providerId.length + 1);

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // If provider is updating, queue the request
    if (provider.isUpdating || provider.status === 'updating') {
      return this.queueRequest(provider, 'tool', {
        name: originalToolName,
        arguments: args,
      });
    }

    if (provider.status !== 'connected') {
      throw new Error(`Provider ${providerId} not available (status: ${provider.status})`);
    }

    if (!provider.client) {
      throw new Error(`Client not initialized for provider ${providerId}`);
    }

    try {
      const result = await provider.client.callTool({
        name: originalToolName,
        arguments: args,
      });

      return result;
    } catch (error) {
      process.stderr.write(
        `Error calling tool ${toolName}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      throw error;
    }
  }

  async readResource(uri: string): Promise<unknown> {
    const providerId = uri.split(':')[0];
    const originalUri = uri.substring(providerId.length + 1);

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // If provider is updating, queue the request
    if (provider.isUpdating || provider.status === 'updating') {
      return this.queueRequest(provider, 'resource', {
        uri: originalUri,
      });
    }

    if (provider.status !== 'connected') {
      throw new Error(`Provider ${providerId} not available (status: ${provider.status})`);
    }

    if (!provider.client) {
      throw new Error(`Client not initialized for provider ${providerId}`);
    }

    try {
      const result = await provider.client.readResource({
        uri: originalUri,
      });

      return result;
    } catch (error) {
      process.stderr.write(
        `Error reading resource ${uri}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      throw error;
    }
  }

  async getPrompt(promptName: string, args?: Record<string, unknown>): Promise<unknown> {
    const providerId = promptName.split('_')[0];
    const originalPromptName = promptName.substring(providerId.length + 1);

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    // If provider is updating, queue the request
    if (provider.isUpdating || provider.status === 'updating') {
      return this.queueRequest(provider, 'prompt', {
        name: originalPromptName,
        arguments: args,
      });
    }

    if (provider.status !== 'connected') {
      throw new Error(`Provider ${providerId} not available (status: ${provider.status})`);
    }

    if (!provider.client) {
      throw new Error(`Client not initialized for provider ${providerId}`);
    }

    try {
      const promptArgs: Record<string, string> | undefined = args
        ? Object.fromEntries(
            Object.entries(args).map(([key, value]) => [
              key,
              typeof value === 'string'
                ? value
                : value === null || value === undefined
                  ? ''
                  : typeof value === 'object'
                    ? JSON.stringify(value)
                    : typeof value === 'number' || typeof value === 'boolean'
                      ? String(value)
                      : '',
            ]),
          )
        : undefined;

      const result = await provider.client.getPrompt({
        name: originalPromptName,
        arguments: promptArgs,
      });

      return result;
    } catch (error) {
      process.stderr.write(
        `Error getting prompt ${promptName}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      throw error;
    }
  }

  startAutoUpdate(intervalMs: number = 60000): void {
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMs);
  }

  stopAutoUpdate(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = undefined;
    }
  }

  private checkForUpdates(): void {
    for (const provider of this.providers.values()) {
      if (provider.config.autoUpdate) {
        try {
          process.stdout.write(`Checking for updates for ${provider.id}...\n`);
          // Update check logic would go here
          // For now, we'll just emit an event
          this.emit('provider:update-check', provider);
        } catch (error) {
          process.stderr.write(
            `Error checking updates for ${provider.id}: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stopAutoUpdate();
    this.clearReconnectionTimers();

    // Clear provider caches
    this.projectsCache.clear();
    this.usersCache.clear();

    for (const providerId of this.providers.keys()) {
      await this.disconnectProvider(providerId);
    }

    this.providers.clear();
  }

  getProvider(id: string): ProviderInstance | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): ProviderInstance[] {
    return Array.from(this.providers.values());
  }

  /**
   * Validate that required tokens are available for the provider
   */
  private validateProviderTokens(
    config: ProviderConfig,
    logger: { debug: (msg: string) => void },
  ): boolean {
    switch (config.id) {
      case 'github': {
        const hasGithubToken = Boolean(process.env.GITHUB_TOKEN);
        logger.debug(`    GITHUB_TOKEN: ${hasGithubToken ? 'SET' : 'MISSING'}`);
        return hasGithubToken;
      }
      case 'gitlab': {
        const hasGitlabToken = Boolean(process.env.GITLAB_TOKEN);
        logger.debug(`    GITLAB_TOKEN: ${hasGitlabToken ? 'SET' : 'MISSING'}`);
        return hasGitlabToken;
      }
      case 'azure': {
        const hasAzureToken = Boolean(process.env.AZURE_TOKEN);
        const hasAzureOrg = Boolean(process.env.AZURE_ORG);
        logger.debug(`    AZURE_TOKEN: ${hasAzureToken ? 'SET' : 'MISSING'}`);
        logger.debug(`    AZURE_ORG: ${hasAzureOrg ? 'SET' : 'MISSING'}`);
        return hasAzureToken && hasAzureOrg;
      }
      default: {
        // For unknown providers, assume tokens are not required
        logger.debug(`    No validation required for ${config.id}`);
        return true;
      }
    }
  }

  /**
   * Schedule reconnection attempt for a provider
   */
  private scheduleReconnection(instance: ProviderInstance): void {
    const { id } = instance;
    const attempts = instance.reconnectAttempts ?? 0;
    const lastReconnectTime = instance.lastReconnectTime;

    if (!shouldAttemptReconnection(attempts, lastReconnectTime)) {
      process.stderr.write(
        `Skipping reconnection for ${id}: too many attempts or cooldown period not met\n`,
      );
      return;
    }

    // Clear existing timer if any
    const existingTimer = this.reconnectionTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Calculate delay: exponential backoff starting at 5 seconds
    const baseDelay = 5000; // 5 seconds
    const delay = baseDelay * Math.pow(2, attempts);

    process.stderr.write(
      `Scheduling reconnection for ${id} in ${delay}ms (attempt ${attempts + 1})\n`,
    );

    const timer = setTimeout(() => {
      void (async () => {
        this.reconnectionTimers.delete(id);

        try {
          process.stderr.write(`Attempting reconnection for ${id}...\n`);

          // Update reconnection tracking
          instance.reconnectAttempts = (instance.reconnectAttempts ?? 0) + 1;
          instance.lastReconnectTime = new Date();
          instance.status = 'starting';

          // Attempt to reinitialize
          await this.initializeProvider(instance.config);
        } catch (error) {
          process.stderr.write(
            `Reconnection failed for ${id}: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      })();
    }, delay);

    this.reconnectionTimers.set(id, timer);
  }

  /**
   * Handle provider process failure (e.g., killed externally)
   */
  handleProviderFailure(providerId: string, error?: Error): void {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return;
    }

    const classification = error
      ? classifyError(error)
      : {
          type: 'network' as const,
          shouldReconnect: true,
          message: 'Provider process terminated unexpectedly',
        };

    provider.status = classification.type === 'auth' ? 'auth_failed' : 'error';
    provider.error = classification.message;
    provider.errorType = classification.type;
    provider.shouldReconnect = classification.shouldReconnect;
    provider.lastUpdated = new Date();

    if (classification.type === 'auth') {
      process.stderr.write(
        `Provider ${providerId} failed with authentication error, will not reconnect\n`,
      );
      this.emit('provider:auth_failed', provider);
    } else {
      process.stderr.write(`Provider ${providerId} failed: ${classification.message}\n`);
      this.emit('provider:error', { provider, error: error ?? new Error(classification.message) });

      if (classification.shouldReconnect) {
        this.scheduleReconnection(provider);
      }
    }
  }

  /**
   * Monitor provider processes for unexpected failures
   */
  private setupProviderMonitoring(instance: ProviderInstance): void {
    if (!instance.client) {
      return;
    }

    // Listen for transport errors/disconnections if available
    // Note: Not all MCP client transports expose these events
    try {
      const transport = (
        instance.client as unknown as {
          _transport?: { onclose?: () => void; onerror?: (error: unknown) => void };
        }
      )._transport;
      if (transport && typeof transport.onclose === 'function') {
        transport.onclose = () => {
          if (instance.status === 'connected') {
            process.stderr.write(`Provider ${instance.id} disconnected unexpectedly\n`);
            this.handleProviderFailure(instance.id);
          }
        };
      }

      if (transport && typeof transport.onerror === 'function') {
        transport.onerror = (error: unknown) => {
          process.stderr.write(
            `Provider ${instance.id} error: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          this.handleProviderFailure(instance.id, error instanceof Error ? error : undefined);
        };
      }
    } catch {
      // Transport monitoring not available, that's okay
      process.stderr.write(`Transport monitoring not available for ${instance.id}\n`);
    }
  }

  /**
   * Queue a request during provider update
   */
  private async queueRequest(
    provider: ProviderInstance,
    type: 'tool' | 'resource' | 'prompt',
    data: {
      name?: string;
      uri?: string;
      arguments?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const queuedRequest: QueuedRequest = {
        id: requestId,
        type,
        data,
        resolve,
        reject,
        timestamp: new Date(),
      };

      // Initialize queue if not exists
      provider.requestQueue ??= [];

      provider.requestQueue.push(queuedRequest);

      process.stderr.write(
        `Request queued for provider ${provider.id} (${type}): ${data.name ?? data.uri ?? 'prompt'}\n`,
      );

      // Set timeout for the request
      const timeoutId = setTimeout(() => {
        // Remove from queue and reject with timeout error
        if (provider.requestQueue) {
          const index = provider.requestQueue.findIndex((req) => req.id === requestId);
          if (index !== -1) {
            provider.requestQueue.splice(index, 1);
            reject(
              new Error(
                `Request timed out after ${ProviderManager.REQUEST_TIMEOUT_MS}ms while provider ${provider.id} was updating`,
              ),
            );
          }
        }
      }, ProviderManager.REQUEST_TIMEOUT_MS);

      // Store timeout ID in the request for cleanup
      queuedRequest.timeoutId = timeoutId;
    });
  }

  /**
   * Process queued requests after provider is back online
   */
  private async processQueuedRequests(provider: ProviderInstance): Promise<void> {
    if (!provider.requestQueue || provider.requestQueue.length === 0) {
      return;
    }

    process.stderr.write(
      `Processing ${provider.requestQueue.length} queued requests for provider ${provider.id}\n`,
    );

    const requestsToProcess = [...provider.requestQueue];
    provider.requestQueue = []; // Clear queue

    for (const request of requestsToProcess) {
      // Clear timeout
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }

      try {
        let result: unknown;

        switch (request.type) {
          case 'tool':
            if (request.data.name && provider.client) {
              result = await provider.client.callTool({
                name: request.data.name,
                arguments: request.data.arguments ?? {},
              });
            }
            break;
          case 'resource':
            if (request.data.uri && provider.client) {
              result = await provider.client.readResource({
                uri: request.data.uri,
              });
            }
            break;
          case 'prompt':
            if (request.data.name && provider.client) {
              const promptArgs: Record<string, string> | undefined = request.data.arguments
                ? Object.fromEntries(
                    Object.entries(request.data.arguments).map(([key, value]) => [
                      key,
                      typeof value === 'string'
                        ? value
                        : value === null || value === undefined
                          ? ''
                          : typeof value === 'object'
                            ? JSON.stringify(value)
                            : typeof value === 'number' || typeof value === 'boolean'
                              ? String(value)
                              : '',
                    ]),
                  )
                : undefined;

              result = await provider.client.getPrompt({
                name: request.data.name,
                arguments: promptArgs,
              });
            }
            break;
        }

        request.resolve(result);
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  /**
   * Set provider updating state and queue incoming requests
   */
  async setProviderUpdating(providerId: string, updating: boolean): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return;
    }

    provider.isUpdating = updating;
    provider.status = updating ? 'updating' : 'connected';

    if (updating) {
      provider.updateStartTime = new Date();
      process.stderr.write(`Provider ${providerId} is now updating - queueing new requests\n`);
    } else {
      provider.updateStartTime = undefined;
      process.stderr.write(`Provider ${providerId} update complete - processing queued requests\n`);
      await this.processQueuedRequests(provider);
    }
  }

  /**
   * Restart all providers (for debugging)
   */
  async restartAllProviders(): Promise<void> {
    process.stderr.write(`Restarting all ${this.providers.size} providers...\n`);

    const providerIds = Array.from(this.providers.keys());
    const results = await Promise.allSettled(
      providerIds.map((providerId) => this.reloadProvider(providerId)),
    );

    const successful = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - successful;

    process.stderr.write(`Provider restart complete: ${successful} successful, ${failed} failed\n`);

    if (failed > 0) {
      const failures = results
        .map((result, index) => ({ result, id: providerIds[index] }))
        .filter(({ result }) => result.status === 'rejected')
        .map(({ result, id }) => `${id}: ${(result as PromiseRejectedResult).reason}`);

      process.stderr.write(`Failed providers:\n${failures.join('\n')}\n`);
    }
  }

  /**
   * Clear all reconnection timers on shutdown
   */
  private clearReconnectionTimers(): void {
    for (const [id, timer] of this.reconnectionTimers.entries()) {
      clearTimeout(timer);
      this.reconnectionTimers.delete(id);
    }
  }

  /**
   * Warm up caches for all connected providers
   */
  async warmupCaches(): Promise<void> {
    const { logger } = await import('../utils/logger.js');
    logger.debug('[cache] Starting provider-level cache warmup...');

    const providers = Array.from(this.providers.values()).filter((p) => p.status === 'connected');

    // Warm up projects and users sequentially for each provider (to avoid race conditions)
    for (const provider of providers) {
      try {
        logger.debug(`[cache] Warming up projects for ${provider.id}...`);
        const projects = await this.fetchProjectsFromProvider(provider.id);
        this.projectsCache.set(provider.id, projects);

        logger.debug(`[cache] Warming up users for ${provider.id}...`);
        const users = this.fetchUsersFromProvider(provider.id);
        this.usersCache.set(provider.id, users);

        logger.debug(
          `[cache] Warmup completed for ${provider.id}: ${projects.length} projects, ${Array.from(users.values()).reduce((total, projectUsers) => total + projectUsers.length, 0)} users`,
        );
      } catch (error) {
        logger.debug(`[cache] Warmup failed for ${provider.id}: ${String(error)}`);
        // Continue with next provider even if this one fails
      }
    }
    logger.debug('[cache] Provider-level cache warmup completed for all providers');
  }

  /**
   * Fetch projects from a specific provider (used for cache warming)
   */
  private async fetchProjectsFromProvider(providerId: string): Promise<ProjectCacheData[]> {
    const provider = this.providers.get(providerId);
    if (!provider || provider.status !== 'connected') {
      return [];
    }

    const projects: ProjectCacheData[] = [];

    // Try different project listing tools based on provider
    const projectTools =
      providerId === 'gitlab'
        ? [
            'list_user_projects', // GitLab user projects (internal tool)
            'search_globally', // GitLab global search for projects
            'list_projects', // GitLab projects
            'list_groups', // GitLab groups
          ]
        : providerId === 'azure'
          ? [
              'core_list_projects', // Azure DevOps projects (correct tool name)
              'list_projects', // Legacy fallback
              'get_projects', // Alternative fallback
            ]
          : [
              'list_repositories', // GitHub direct repo listing (preferred)
              'list_user_repositories', // GitHub user's repos
              'search_repositories', // GitHub search with user:username
              'list_organizations', // GitHub organizations
            ];

    for (const toolSuffix of projectTools) {
      const toolName = `${providerId}_${toolSuffix}`;
      if (provider.tools.has(toolName)) {
        try {
          const { logger } = await import('../utils/logger.js');
          logger.debug(`[cache] Trying tool: ${toolName}`);

          // Prepare parameters based on tool type
          let toolParams = {};
          if (toolName.includes('search_globally')) {
            // GitLab search_globally with scope=projects and active=true
            toolParams = { scope: 'projects', active: 'true' };
          } else if (toolName.includes('search_repositories')) {
            // For GitHub search, we need to get the authenticated username first
            let username = '';
            if (providerId === 'github') {
              // Try to get username from get_me tool
              const getMeTool = `${providerId}_get_me`;
              if (provider.tools.has(getMeTool)) {
                try {
                  const meResult = await this.callTool(getMeTool, {});
                  if (hasTextContent(meResult)) {
                    const meJson = meResult.content[0].text;
                    const meData = JSON.parse(meJson) as Record<string, unknown>;
                    username = typeof meData.login === 'string' ? meData.login : '';
                  }
                } catch {
                  // Skip search if we can't get username
                  continue;
                }
              }
            } else {
              // Skip search if we can't get username
              continue;
            }
            toolParams = { query: `user:${username}` };
          }

          logger.debug(`[cache] Calling tool: ${toolName} with params:`, toolParams);
          const result = await this.callTool(toolName, toolParams);
          logger.debug(`[cache] Tool call successful: ${toolName}`);

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

                    // Determine project URL based on provider
                    let projectUrl: string | undefined;
                    if (typeof proj.html_url === 'string') {
                      projectUrl = proj.html_url; // GitHub
                    } else if (typeof proj.web_url === 'string') {
                      projectUrl = proj.web_url; // GitLab
                    } else if (typeof proj.url === 'string') {
                      projectUrl = proj.url; // Azure
                    }

                    projects.push({
                      id: projectId,
                      name: projectName,
                      provider: providerId,
                      description:
                        typeof proj.description === 'string' ? proj.description : undefined,
                      url: projectUrl,
                      members: members,
                    });
                  }
                }
              }

              // Return after first successful tool
              break;
            }
          }
        } catch {
          // Continue with next tool if current one fails
          continue;
        }
      }
    }

    return projects;
  }

  /**
   * Fetch project members from a specific provider
   */
  private async fetchProjectMembers(providerId: string, projectId: string): Promise<UserRole[]> {
    const provider = this.providers.get(providerId);
    if (!provider || provider.status !== 'connected') {
      return [];
    }

    const memberTools = [
      'list_project_members', // GitLab
      'list_repository_collaborators', // GitHub
      'list_collaborators', // GitHub alternative
      'list_contributors', // GitHub contributors
      'get_project_members', // Azure DevOps
      'list_team_members', // Azure DevOps alternative
    ];

    for (const toolSuffix of memberTools) {
      const toolName = `${providerId}_${toolSuffix}`;
      if (provider.tools.has(toolName)) {
        try {
          const result = await this.callTool(toolName, {
            project_id: projectId,
            id: projectId,
            repo: projectId,
            owner: projectId.split('/')[0], // For GitHub owner/repo format
            repository: projectId,
          });

          if (hasTextContent(result)) {
            const membersJson = result.content[0].text;
            const parsedMembers: unknown = JSON.parse(membersJson);

            if (Array.isArray(parsedMembers)) {
              const members: UserRole[] = [];
              for (const member of parsedMembers) {
                if (typeof member === 'object' && member !== null) {
                  const mem = member as Record<string, unknown>;
                  const userId =
                    typeof mem.id === 'string' || typeof mem.id === 'number'
                      ? String(mem.id)
                      : typeof mem.login === 'string'
                        ? mem.login
                        : '';
                  const username =
                    typeof mem.username === 'string'
                      ? mem.username
                      : typeof mem.login === 'string'
                        ? mem.login
                        : userId;
                  const displayName =
                    typeof mem.name === 'string'
                      ? mem.name
                      : typeof mem.display_name === 'string'
                        ? mem.display_name
                        : username;

                  // Extract role information based on provider
                  let role = 'member'; // default role
                  let accessLevel: number | undefined;

                  if (typeof mem.role === 'string') {
                    role = mem.role; // GitLab
                  } else if (typeof mem.permissions === 'string') {
                    role = mem.permissions; // GitHub
                  } else if (typeof mem.access_level === 'number') {
                    accessLevel = mem.access_level; // GitLab access levels
                    // Convert GitLab access levels to roles
                    if (accessLevel >= 50) role = 'maintainer';
                    else if (accessLevel >= 40) role = 'developer';
                    else if (accessLevel >= 30) role = 'developer';
                    else if (accessLevel >= 20) role = 'reporter';
                    else role = 'guest';
                  }

                  if (userId && username) {
                    members.push({
                      userId,
                      username,
                      displayName,
                      email: typeof mem.email === 'string' ? mem.email : undefined,
                      role,
                      accessLevel,
                    });
                  }
                }
              }
              return members;
            }
          }
        } catch {
          // Continue with next tool if current one fails
          continue;
        }
      }
    }

    return [];
  }

  /**
   * Fetch users from a specific provider (used for cache warming)
   */
  private fetchUsersFromProvider(providerId: string): Map<string, UserRole[]> {
    const usersByProject = new Map<string, UserRole[]>();

    // Get projects first to populate users per project structure
    const projects = this.projectsCache.get(providerId) ?? [];

    for (const project of projects) {
      if (project.members) {
        usersByProject.set(project.id, project.members);
      }
    }

    return usersByProject;
  }

  /**
   * Get cached projects for a provider
   */
  getCachedProjects(providerId: string): ProjectCacheData[] {
    return this.projectsCache.get(providerId) ?? [];
  }

  /**
   * Get cached users for a provider and project
   */
  getCachedUsers(providerId: string, projectId?: string): UserRole[] {
    const providerUsers = this.usersCache.get(providerId);
    if (!providerUsers) return [];

    if (projectId) {
      return providerUsers.get(projectId) ?? [];
    }

    // Return all users from all projects
    const allUsers: UserRole[] = [];
    for (const projectUsers of providerUsers.values()) {
      allUsers.push(...projectUsers);
    }

    // Deduplicate by userId
    const uniqueUsers = new Map<string, UserRole>();
    for (const user of allUsers) {
      uniqueUsers.set(user.userId, user);
    }

    return Array.from(uniqueUsers.values());
  }
}
