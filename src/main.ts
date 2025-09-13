#!/usr/bin/env node

import { NexusProxyServer } from './server/NexusProxyServer.js';
import { defineCommand, runMain } from 'citty';
import { logger } from './utils/logger.js';

const stdio = defineCommand({
  meta: {
    name: 'stdio',
    description: 'Run in STDIO mode (default)',
  },
  args: {
    config: {
      type: 'string',
      description: 'Path to configuration file',
      alias: 'c',
      required: false,
    },
  },
  async run() {
    // Enable file logging for STDIO mode to keep stderr clean for MCP protocol
    logger.setStdioMode(true);
    logger.log(`Starting Project Nexus MCP Server in STDIO mode. Log file: ${logger.getLogFile()}`);

    const server = new NexusProxyServer();

    process.on('SIGINT', () => {
      void (async () => {
        logger.log('Received SIGINT, shutting down gracefully');
        await server.shutdown();
        process.exit(0);
      })();
    });

    process.on('SIGTERM', () => {
      void (async () => {
        logger.log('Received SIGTERM, shutting down gracefully');
        await server.shutdown();
        process.exit(0);
      })();
    });

    try {
      await server.runStdio();
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.stderr.write(
        `Failed to start server: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }
  },
});

const http = defineCommand({
  meta: {
    name: 'http',
    description: 'Run as HTTP/SSE server',
  },
  args: {
    port: {
      type: 'string',
      description: 'Port to listen on',
      default: '3000',
      alias: 'p',
    },
    config: {
      type: 'string',
      description: 'Path to configuration file',
      alias: 'c',
      required: false,
    },
  },
  async run(ctx) {
    const server = new NexusProxyServer();
    const port = parseInt(ctx.args.port, 10);

    process.on('SIGINT', () => {
      void (async () => {
        await server.shutdown();
        process.exit(0);
      })();
    });

    process.on('SIGTERM', () => {
      void (async () => {
        await server.shutdown();
        process.exit(0);
      })();
    });

    try {
      await server.runHttp(port);
    } catch (error) {
      process.stderr.write(
        `Failed to start server: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }
  },
});

const main = defineCommand({
  meta: {
    name: 'project-nexus-mcp',
    description: 'Unified MCP proxy for DevOps platforms',
    version: '1.0.0',
  },
  subCommands: {
    stdio,
    http,
  },
});

runMain(main).catch((error: unknown) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
