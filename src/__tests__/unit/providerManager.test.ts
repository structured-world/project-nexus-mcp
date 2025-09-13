import { jest } from '@jest/globals';
import { ProviderManager } from '../../providers/ProviderManager.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ProviderConfig, ProviderInstance } from '../../types/index.js';
import * as errorClassifier from '../../utils/errorClassifier.js';

// Mock MCP SDK
jest.mock('@modelcontextprotocol/sdk/client/index.js');
jest.mock('@modelcontextprotocol/sdk/client/stdio.js');
jest.mock('@modelcontextprotocol/sdk/client/sse.js');
jest.mock('../../utils/errorClassifier.js');

const MockedClient = Client as jest.MockedClass<typeof Client>;
const MockedStdioClientTransport = StdioClientTransport as jest.MockedClass<
  typeof StdioClientTransport
>;
const MockedSSEClientTransport = SSEClientTransport as jest.MockedClass<typeof SSEClientTransport>;
const mockedClassifyError = errorClassifier.classifyError as jest.MockedFunction<
  typeof errorClassifier.classifyError
>;
const mockedShouldAttemptReconnection =
  errorClassifier.shouldAttemptReconnection as jest.MockedFunction<
    typeof errorClassifier.shouldAttemptReconnection
  >;

describe('ProviderManager', () => {
  let providerManager: ProviderManager;
  let mockClient: jest.Mocked<Client>;
  let mockStdioTransport: jest.Mocked<StdioClientTransport>;
  let mockSSETransport: jest.Mocked<SSEClientTransport>;
  let originalStderrWrite: typeof process.stderr.write;
  let originalStdoutWrite: typeof process.stdout.write;
  let mockStderrWrite: jest.Mock;
  let mockStdoutWrite: jest.Mock;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock process.stderr and stdout
    originalStderrWrite = process.stderr.write;
    originalStdoutWrite = process.stdout.write;
    mockStderrWrite = jest.fn().mockReturnValue(true);
    mockStdoutWrite = jest.fn().mockReturnValue(true);
    process.stderr.write = mockStderrWrite as any;
    process.stdout.write = mockStdoutWrite as any;

    // Save original environment
    originalEnv = { ...process.env };

    // Create mocked instances
    mockClient = {
      connect: jest.fn(),
      close: jest.fn(),
      listTools: jest.fn(),
      listResources: jest.fn(),
      listPrompts: jest.fn(),
      callTool: jest.fn(),
      readResource: jest.fn(),
      getPrompt: jest.fn(),
    } as any;

    mockStdioTransport = {
      connect: jest.fn(),
      close: jest.fn(),
    } as any;

    mockSSETransport = {
      connect: jest.fn(),
      close: jest.fn(),
    } as any;

    // Mock constructors
    MockedClient.mockImplementation(() => mockClient);
    MockedStdioClientTransport.mockImplementation(() => mockStdioTransport);
    MockedSSEClientTransport.mockImplementation(() => mockSSETransport);

    // Mock error classifier
    mockedClassifyError.mockReturnValue({
      type: 'network',
      shouldReconnect: true,
      message: 'Network error',
    });

    mockedShouldAttemptReconnection.mockReturnValue(true);

    providerManager = new ProviderManager();
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    process.env = originalEnv;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('initializeProvider', () => {
    const validStdioConfig: ProviderConfig = {
      id: 'test-provider',
      name: 'Test Provider',
      type: 'stdio',
      command: 'test-command',
      args: ['--test'],
      enabled: true,
      env: { TEST_VAR: 'test-value' },
    };

    it('should initialize STDIO provider successfully', async () => {
      // Setup mocks
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: 'test_tool',
            description: 'Test tool',
            inputSchema: {
              type: 'object' as const,
              properties: {},
              required: [] as string[],
            },
          },
        ],
      });
      mockClient.listResources.mockResolvedValue({
        resources: [{ uri: 'test://resource', name: 'Test Resource' }],
      });
      mockClient.listPrompts.mockResolvedValue({
        prompts: [
          {
            name: 'test_prompt',
            description: 'Test prompt',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      });

      const result = await providerManager.initializeProvider(validStdioConfig);

      expect(MockedClient).toHaveBeenCalledWith(
        {
          name: 'nexus-proxy-test-provider',
          version: '1.0.0',
        },
        {
          capabilities: {},
        },
      );

      expect(MockedStdioClientTransport).toHaveBeenCalledWith({
        command: 'test-command',
        args: ['--test'],
        env: expect.objectContaining({
          TEST_VAR: 'test-value',
        }),
      });

      expect(mockClient.connect).toHaveBeenCalledWith(mockStdioTransport);
      expect(result.status).toBe('connected');
      expect(result.tools.has('test-provider_test_tool')).toBe(true);
      expect(result.resources.has('test-provider:test://resource')).toBe(true);
      expect(result.prompts.has('test-provider_test_prompt')).toBe(true);
    });

    it('should handle missing required tokens (GitHub)', async () => {
      const githubConfig: ProviderConfig = {
        id: 'github',
        name: 'GitHub Provider',
        type: 'stdio',
        command: 'github-mcp',
        enabled: true,
      };

      // Ensure no GITHUB_TOKEN
      delete process.env.GITHUB_TOKEN;

      const result = await providerManager.initializeProvider(githubConfig);

      expect(result.status).toBe('auth_failed');
      expect(result.error).toBe('Required authentication tokens are missing');
      expect(result.shouldReconnect).toBe(false);
    });

    it('should handle missing required tokens (GitLab)', async () => {
      const gitlabConfig: ProviderConfig = {
        id: 'gitlab',
        name: 'GitLab Provider',
        type: 'stdio',
        command: 'gitlab-mcp',
        enabled: true,
      };

      delete process.env.GITLAB_TOKEN;

      const result = await providerManager.initializeProvider(gitlabConfig);

      expect(result.status).toBe('auth_failed');
    });

    it('should handle missing required tokens (Azure)', async () => {
      const azureConfig: ProviderConfig = {
        id: 'azure',
        name: 'Azure Provider',
        type: 'stdio',
        command: 'azure-mcp',
        enabled: true,
      };

      delete process.env.AZURE_DEVOPS_PAT;
      delete process.env.AZURE_ORG;

      const result = await providerManager.initializeProvider(azureConfig);

      expect(result.status).toBe('auth_failed');
    });

    it('should handle STDIO connection errors', async () => {
      const error = new Error('Connection failed');
      mockClient.connect.mockRejectedValue(error);

      mockedClassifyError.mockReturnValue({
        type: 'network',
        shouldReconnect: true,
        message: 'Connection failed',
      });

      const result = await providerManager.initializeProvider(validStdioConfig);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Connection failed');
      expect(result.shouldReconnect).toBe(true);
    });

    it('should handle authentication errors', async () => {
      const error = new Error('Auth failed');
      mockClient.connect.mockRejectedValue(error);

      mockedClassifyError.mockReturnValue({
        type: 'auth',
        shouldReconnect: false,
        message: 'Authentication failed',
      });

      const result = await providerManager.initializeProvider(validStdioConfig);

      expect(result.status).toBe('auth_failed');
      expect(result.error).toBe('Authentication failed');
      expect(result.shouldReconnect).toBe(false);
    });

    it('should handle listTools errors gracefully', async () => {
      mockClient.listTools.mockRejectedValue(new Error('Tools listing failed'));
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      const result = await providerManager.initializeProvider(validStdioConfig);

      expect(result.status).toBe('connected');
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Could not list tools for test-provider'),
      );
    });

    it('should filter undefined environment variables', async () => {
      const configWithUndefinedEnv: ProviderConfig = {
        ...validStdioConfig,
        env: {
          DEFINED_VAR: 'value',
          UNDEFINED_VAR: undefined as any,
          NULL_VAR: null as any,
          EMPTY_VAR: '',
        },
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      await providerManager.initializeProvider(configWithUndefinedEnv);

      expect(MockedStdioClientTransport).toHaveBeenCalledWith({
        command: 'test-command',
        args: ['--test'],
        env: expect.objectContaining({
          DEFINED_VAR: 'value',
          EMPTY_VAR: '',
        }),
      });

      expect(MockedStdioClientTransport).toHaveBeenCalledWith({
        command: 'test-command',
        args: ['--test'],
        env: expect.not.objectContaining({
          UNDEFINED_VAR: expect.anything(),
          NULL_VAR: expect.anything(),
        }),
      });
    });
  });

  describe('callTool', () => {
    let provider: ProviderInstance;

    beforeEach(async () => {
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      provider = await providerManager.initializeProvider(config);
    });

    it('should call tool successfully', async () => {
      const toolResult = { content: [{ type: 'text', text: 'Tool result' }] };
      mockClient.callTool.mockResolvedValue(toolResult);

      const result = await providerManager.callTool('test_tool_name', { arg1: 'value1' });

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'tool_name',
        arguments: { arg1: 'value1' },
      });
      expect(result).toEqual(toolResult);
    });

    it('should throw error for unknown provider', async () => {
      await expect(providerManager.callTool('unknown_tool_name', {})).rejects.toThrow(
        'Provider unknown not found',
      );
    });

    it('should throw error for disconnected provider', async () => {
      provider.status = 'disconnected';

      await expect(providerManager.callTool('test_tool_name', {})).rejects.toThrow(
        'Provider test not available (status: disconnected)',
      );
    });

    it('should queue request when provider is updating', async () => {
      jest.useFakeTimers();

      provider.isUpdating = true;
      provider.requestQueue = [];

      const toolPromise = providerManager.callTool('test_tool_name', { arg1: 'value1' });

      // Verify request was queued
      expect(provider.requestQueue).toHaveLength(1);
      expect(provider.requestQueue[0].type).toBe('tool');
      expect(provider.requestQueue[0].data.name).toBe('tool_name');

      // Simulate provider coming back online
      provider.isUpdating = false;
      provider.status = 'connected';
      mockClient.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'Queued result' }] });

      // Process the queue
      await providerManager.setProviderUpdating('test', false);

      const result = await toolPromise;
      expect(result).toEqual({ content: [{ type: 'text', text: 'Queued result' }] });
    });

    it('should handle tool call errors', async () => {
      const error = new Error('Tool call failed');
      mockClient.callTool.mockRejectedValue(error);

      await expect(providerManager.callTool('test_tool_name', {})).rejects.toThrow(
        'Tool call failed',
      );
      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Error calling tool test_tool_name'),
      );
    });
  });

  describe('readResource', () => {
    let provider: ProviderInstance;

    beforeEach(async () => {
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      provider = await providerManager.initializeProvider(config);
    });

    it('should read resource successfully', async () => {
      const resourceResult = {
        contents: [
          {
            type: 'text' as const,
            text: 'Resource content',
            _meta: {},
          },
        ],
      };
      mockClient.readResource.mockResolvedValue(resourceResult as any);

      const result = await providerManager.readResource('test:resource://example');

      expect(mockClient.readResource).toHaveBeenCalledWith({
        uri: 'resource://example',
      });
      expect(result).toEqual(resourceResult);
    });

    it('should queue resource request when provider is updating', async () => {
      jest.useFakeTimers();

      provider.isUpdating = true;
      provider.requestQueue = [];

      const resourcePromise = providerManager.readResource('test:resource://example');

      expect(provider.requestQueue).toHaveLength(1);
      expect(provider.requestQueue[0].type).toBe('resource');
      expect(provider.requestQueue[0].data.uri).toBe('resource://example');

      // Simulate completion
      provider.isUpdating = false;
      mockClient.readResource.mockResolvedValue({ contents: [] });
      await providerManager.setProviderUpdating('test', false);

      await resourcePromise;
    });
  });

  describe('getPrompt', () => {
    // provider is set up for test context but not directly tested

    beforeEach(async () => {
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      await providerManager.initializeProvider(config);
    });

    it('should get prompt successfully', async () => {
      const promptResult = {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: 'Prompt content',
              _meta: {},
            },
          },
        ],
      };
      mockClient.getPrompt.mockResolvedValue(promptResult as any);

      const result = await providerManager.getPrompt('test_prompt_name');

      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: 'prompt_name',
        arguments: undefined,
      });
      expect(result).toEqual(promptResult);
    });

    it('should convert arguments to strings', async () => {
      const promptResult = { messages: [] };
      mockClient.getPrompt.mockResolvedValue(promptResult as any);

      await providerManager.getPrompt('test_prompt_name', {
        stringArg: 'string',
        numberArg: 42,
        booleanArg: true,
        nullArg: null,
        undefinedArg: undefined,
        objectArg: { nested: 'value' },
      });

      expect(mockClient.getPrompt).toHaveBeenCalledWith({
        name: 'prompt_name',
        arguments: {
          stringArg: 'string',
          numberArg: '42',
          booleanArg: 'true',
          nullArg: '',
          undefinedArg: '',
          objectArg: '{"nested":"value"}',
        },
      });
    });
  });

  describe('reloadProvider', () => {
    let provider: ProviderInstance;

    beforeEach(async () => {
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      provider = await providerManager.initializeProvider(config);
    });

    it('should reload provider successfully', async () => {
      await providerManager.reloadProvider('test');

      expect(mockClient.close).toHaveBeenCalled();
      expect(mockStdoutWrite).toHaveBeenCalledWith('Reloading provider: test\n');
    });

    it('should throw error for unknown provider', async () => {
      await expect(providerManager.reloadProvider('unknown')).rejects.toThrow(
        'Provider unknown not found',
      );
    });

    it('should handle reload failures', async () => {
      // Queue a request first
      const mockReject = jest.fn();
      provider.isUpdating = true;
      provider.requestQueue = [
        {
          id: 'test-request',
          type: 'tool',
          data: { name: 'test' },
          resolve: jest.fn(),
          reject: mockReject,
          timestamp: new Date(),
          timeoutId: setTimeout(() => {}, 1000),
        },
      ];

      // Make reconnection fail
      const reloadError = new Error('Reload failed');
      jest.spyOn(providerManager, 'initializeProvider').mockRejectedValueOnce(reloadError);

      await expect(providerManager.reloadProvider('test')).rejects.toThrow('Reload failed');

      // Verify the reject function was called before queue was cleared
      expect(mockReject).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Provider reload failed'),
        }),
      );
    });
  });

  describe('disconnectProvider', () => {
    let provider: ProviderInstance;

    beforeEach(async () => {
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      provider = await providerManager.initializeProvider(config);
    });

    it('should disconnect provider successfully', async () => {
      await providerManager.disconnectProvider('test');

      expect(mockClient.close).toHaveBeenCalled();
      expect(provider.status).toBe('disconnected');
    });

    it('should handle client close errors', async () => {
      mockClient.close.mockRejectedValue(new Error('Close failed'));

      await providerManager.disconnectProvider('test');

      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Error closing client for test'),
      );
      expect(provider.status).toBe('disconnected');
    });

    it('should clear reconnection timers', async () => {
      jest.useFakeTimers();
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

      // Set up a reconnection timer
      const timer = setTimeout(() => {}, 5000);
      (providerManager as any).reconnectionTimers.set('test', timer);

      await providerManager.disconnectProvider('test');

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    });
  });

  describe('getAllTools', () => {
    it('should return tools from connected providers only', async () => {
      const config1: ProviderConfig = {
        id: 'provider1',
        name: 'Provider 1',
        type: 'stdio',
        command: 'cmd1',
        enabled: true,
      };

      const config2: ProviderConfig = {
        id: 'provider2',
        name: 'Provider 2',
        type: 'stdio',
        command: 'cmd2',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValueOnce({
        tools: [
          {
            name: 'tool1',
            description: 'Tool 1',
            inputSchema: {
              type: 'object' as const,
              properties: {},
              required: [] as string[],
            },
          },
        ],
      });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      await providerManager.initializeProvider(config1);

      mockClient.listTools.mockResolvedValueOnce({
        tools: [
          {
            name: 'tool2',
            description: 'Tool 2',
            inputSchema: {
              type: 'object' as const,
              properties: {},
              required: [] as string[],
            },
          },
        ],
      });

      const provider2 = await providerManager.initializeProvider(config2);
      provider2.status = 'error'; // Disconnect one provider

      const tools = providerManager.getAllTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('provider1_tool1');
    });
  });

  describe('scheduleReconnection', () => {
    let provider: ProviderInstance;

    beforeEach(async () => {
      jest.useFakeTimers();
      mockedShouldAttemptReconnection.mockReturnValue(true);

      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      // Make initial connection fail
      mockClient.connect.mockRejectedValueOnce(new Error('Initial connection failed'));
      mockedClassifyError.mockReturnValue({
        type: 'network',
        shouldReconnect: true,
        message: 'Network error',
      });

      provider = await providerManager.initializeProvider(config);
    });

    it('should schedule reconnection with exponential backoff', async () => {
      expect(provider.status).toBe('error');

      // Fast forward past the reconnection delay
      jest.advanceTimersByTime(10000); // More than base delay (5000ms)

      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Scheduling reconnection for test'),
      );
    });

    it('should not reconnect when shouldAttemptReconnection returns false', async () => {
      mockedShouldAttemptReconnection.mockReturnValue(false);

      // Trigger another failure
      await providerManager.handleProviderFailure('test', new Error('Another error'));

      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Skipping reconnection for test'),
      );
    });
  });

  describe('startAutoUpdate and stopAutoUpdate', () => {
    it('should start and stop auto update interval', () => {
      jest.useFakeTimers();

      providerManager.startAutoUpdate(5000);

      jest.advanceTimersByTime(5000);
      // The auto-update checks each provider
      // Since no providers are initialized, nothing happens
      // This is correct behavior - no updates to check without providers

      // Stop the auto-update
      providerManager.stopAutoUpdate();

      // Advancing time should not trigger any more checks
      const callCountBeforeStop = mockStdoutWrite.mock.calls.length;
      jest.advanceTimersByTime(5000);
      expect(mockStdoutWrite).toHaveBeenCalledTimes(callCountBeforeStop);

      jest.useRealTimers();
    });
  });

  describe('shutdown', () => {
    it('should shutdown all providers and clear resources', async () => {
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      await providerManager.initializeProvider(config);
      providerManager.startAutoUpdate();

      await providerManager.shutdown();

      expect(mockClient.close).toHaveBeenCalled();
      expect(providerManager.getAllProviders()).toHaveLength(0);
    });
  });

  describe('request timeout handling', () => {
    let provider: ProviderInstance;

    beforeEach(async () => {
      jest.useFakeTimers();

      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      provider = await providerManager.initializeProvider(config);
      provider.isUpdating = true;
    });

    it('should timeout queued requests after REQUEST_TIMEOUT_MS', async () => {
      const toolPromise = providerManager.callTool('test_tool_name', {});

      // Fast forward past timeout
      jest.advanceTimersByTime(30001); // More than REQUEST_TIMEOUT_MS (30000)

      await expect(toolPromise).rejects.toThrow(
        'Request timed out after 30000ms while provider test was updating',
      );
    });
  });

  describe('transport monitoring', () => {
    it('should handle transport close events', async () => {
      jest.clearAllMocks();
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      // Mock transport with onclose callback
      const mockTransport = {
        onclose: (() => {}) as () => void,
        onerror: ((_error: unknown) => {}) as (error: unknown) => void,
      };

      // Mock the client to have a _transport property
      // Update the existing mockClient with transport
      (mockClient as any)._transport = mockTransport;

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      await providerManager.initializeProvider(config);

      // The onclose handler should be set by the initialization
      expect(mockTransport.onclose).toBeDefined();

      // Simulate transport close
      mockTransport.onclose!();

      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Provider test disconnected unexpectedly'),
      );
    });

    it('should handle transport error events', async () => {
      jest.clearAllMocks();
      const config: ProviderConfig = {
        id: 'test',
        name: 'Test Provider',
        type: 'stdio',
        command: 'test-command',
        enabled: true,
      };

      const mockTransport = {
        onclose: (() => {}) as () => void,
        onerror: ((_error: unknown) => {}) as (error: unknown) => void,
      };

      // Update the existing mockClient with transport
      (mockClient as any)._transport = mockTransport;

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      await providerManager.initializeProvider(config);

      // The onerror handler should be set by the initialization
      expect(mockTransport.onerror).toBeDefined();

      // Simulate transport error
      const transportError = new Error('Transport error');
      mockTransport.onerror!(transportError);

      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Provider test error: Transport error'),
      );
    });
  });

  describe('restartAllProviders', () => {
    it('should restart all providers and report results', async () => {
      const config1: ProviderConfig = {
        id: 'provider1',
        name: 'Provider 1',
        type: 'stdio',
        command: 'cmd1',
        enabled: true,
      };

      const config2: ProviderConfig = {
        id: 'provider2',
        name: 'Provider 2',
        type: 'stdio',
        command: 'cmd2',
        enabled: true,
      };

      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.listResources.mockResolvedValue({ resources: [] });
      mockClient.listPrompts.mockResolvedValue({ prompts: [] });

      await providerManager.initializeProvider(config1);
      await providerManager.initializeProvider(config2);

      // Mock one success and one failure
      jest
        .spyOn(providerManager, 'reloadProvider')
        .mockResolvedValueOnce(undefined) // provider1 success
        .mockRejectedValueOnce(new Error('Reload failed')); // provider2 failure

      await providerManager.restartAllProviders();

      expect(mockStderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Provider restart complete: 1 successful, 1 failed'),
      );
      expect(mockStderrWrite).toHaveBeenCalledWith(expect.stringContaining('Failed providers:'));
    });
  });
});
