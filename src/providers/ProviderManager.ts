import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { ProviderConfig, ProviderInstance } from '../types/index.js';
import { classifyError, shouldAttemptReconnection } from '../utils/errorClassifier.js';
import { EventEmitter } from 'events';

export class ProviderManager extends EventEmitter {
  private providers: Map<string, ProviderInstance> = new Map();
  private updateCheckInterval?: NodeJS.Timeout;
  private reconnectionTimers: Map<string, NodeJS.Timeout> = new Map();

  async initializeProvider(config: ProviderConfig): Promise<ProviderInstance> {
    // Validate tokens before attempting to initialize
    const hasRequiredTokens = this.validateProviderTokens(config);
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
    };

    try {
      if (config.type === 'stdio' && config.command) {
        instance.client = await this.createStdioClient(config);
      } else if (config.type === 'sse' && config.url) {
        instance.client = await this.createSSEClient(config);
      } else if (config.type === 'http' && config.url) {
        instance.client = await this.createHTTPClient(config);
      }

      if (instance.client) {
        process.stderr.write(`  Connecting to ${config.name}...\n`);
        await this.connectAndLoadCapabilities(instance);
        process.stderr.write(`  Loaded capabilities from ${config.name}\n`);
      }

      instance.status = 'connected';
      instance.reconnectAttempts = 0; // Reset on successful connection
      this.setupProviderMonitoring(instance);
      this.providers.set(config.id, instance);
      this.emit('provider:connected', instance);
    } catch (error) {
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

  private async createStdioClient(config: ProviderConfig): Promise<Client> {
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

    process.stderr.write(`  Spawning: ${command} ${args.join(' ')}\n`);

    const transport = new StdioClientTransport({
      command,
      args,
      env,
    });

    await client.connect(transport);

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

  private createHTTPClient(_config: ProviderConfig): Promise<Client> {
    // HTTP transport is not yet available in the SDK
    // For now, we'll throw an error for HTTP providers
    return Promise.reject(new Error('HTTP transport not yet implemented'));
  }

  private async connectAndLoadCapabilities(instance: ProviderInstance): Promise<void> {
    const client = instance.client;

    if (!client) {
      throw new Error('Client not initialized');
    }

    try {
      const listToolsResult = await client.listTools();
      for (const tool of listToolsResult.tools) {
        const prefixedName = `${instance.id}_${tool.name}`;
        instance.tools.set(prefixedName, {
          ...tool,
          name: prefixedName,
          description: `[${instance.config.name}] ${tool.description ?? ''}`,
        });
      }
    } catch (error) {
      process.stderr.write(
        `Could not list tools for ${instance.id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

    try {
      const listResourcesResult = await client.listResources();
      for (const resource of listResourcesResult.resources) {
        const prefixedUri = `${instance.id}:${resource.uri}`;
        instance.resources.set(prefixedUri, {
          ...resource,
          uri: prefixedUri,
          name: `[${instance.config.name}] ${resource.name}`,
        });
      }
    } catch (error) {
      process.stderr.write(
        `Could not list resources for ${instance.id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

    try {
      const listPromptsResult = await client.listPrompts();
      for (const prompt of listPromptsResult.prompts) {
        const prefixedName = `${instance.id}_${prompt.name}`;
        instance.prompts.set(prefixedName, {
          ...prompt,
          name: prefixedName,
          description: `[${instance.config.name}] ${prompt.description ?? ''}`,
        });
      }
    } catch (error) {
      process.stderr.write(
        `Could not list prompts for ${instance.id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  async reloadProvider(providerId: string): Promise<void> {
    const existingProvider = this.providers.get(providerId);
    if (!existingProvider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    process.stdout.write(`Reloading provider: ${providerId}\n`);

    await this.disconnectProvider(providerId);

    // Reset reconnection attempts when manually reloading
    existingProvider.reconnectAttempts = 0;
    existingProvider.lastReconnectTime = undefined;
    existingProvider.error = undefined;
    existingProvider.errorType = undefined;
    existingProvider.shouldReconnect = undefined;

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await this.initializeProvider(existingProvider.config);
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
        allTools.push(...Array.from(provider.tools.values()));
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
    if (!provider || provider.status !== 'connected') {
      throw new Error(`Provider ${providerId} not available`);
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
    if (!provider || provider.status !== 'connected') {
      throw new Error(`Provider ${providerId} not available`);
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
    if (!provider || provider.status !== 'connected') {
      throw new Error(`Provider ${providerId} not available`);
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
  private validateProviderTokens(config: ProviderConfig): boolean {
    switch (config.id) {
      case 'github':
        return Boolean(process.env.GITHUB_TOKEN);
      case 'gitlab':
        return Boolean(process.env.GITLAB_TOKEN);
      case 'azure':
        return Boolean(process.env.AZURE_DEVOPS_PAT && process.env.AZURE_ORG);
      default:
        // For unknown providers, assume tokens are not required
        return true;
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
   * Clear all reconnection timers on shutdown
   */
  private clearReconnectionTimers(): void {
    for (const [id, timer] of this.reconnectionTimers.entries()) {
      clearTimeout(timer);
      this.reconnectionTimers.delete(id);
    }
  }
}
