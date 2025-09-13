## [2.1.1](https://github.com/structured-world/project-nexus-mcp/compare/v2.1.0...v2.1.1) (2025-09-13)


### Bug Fixes

* resolve project search and cache warming issues with improved tool descriptions ([1b3eee1](https://github.com/structured-world/project-nexus-mcp/commit/1b3eee18f0c349c3a87e28ca5cbc58e3599201e5))

# [2.1.0](https://github.com/structured-world/project-nexus-mcp/compare/v2.0.0...v2.1.0) (2025-09-13)


### Bug Fixes

* resolve linting errors in cache implementation ([708bcb0](https://github.com/structured-world/project-nexus-mcp/commit/708bcb0b6930979970c2546d69543baff1d27ec1))


### Features

* implement cache system for projects and users with auto-warming ([1c75469](https://github.com/structured-world/project-nexus-mcp/commit/1c75469952f6b23a8bff2305033ac496867f15b7))

# [2.0.0](https://github.com/structured-world/project-nexus-mcp/compare/v1.6.2...v2.0.0) (2025-09-13)


### Features

* implement aggregated async operations across all DevOps providers ([c113866](https://github.com/structured-world/project-nexus-mcp/commit/c113866e0ba215fce644f0565e1b138a3be8d7c2))


### BREAKING CHANGES

* Complete redesign of tool interface from provider-specific to unified operations

- Add 8 unified manager classes for comprehensive DevOps operations:
  * WorkItemsManager: Issue/task management across platforms
  * RepositoryManager: Repository operations (GitHub/GitLab/Azure)
  * ProjectManager: Organization/group management
  * MergeRequestManager: PR/MR operations with parallel support
  * PipelineManager: CI/CD pipeline management
  * SearchManager: Universal search across all platforms
  * BranchManager: Branch operations with type safety
  * CommitManager: Commit history with proper TypeScript typing

- Implement parallel async execution pattern using Promise.allSettled():
  * Multi-provider operations execute simultaneously (3x faster)
  * Fault-tolerant with graceful degradation
  * Error isolation prevents single provider failures from affecting others

- Hide all provider-specific tools from MCP clients:
  * Tool count reduced from ~130 to 36 (3.6x reduction)
  * Only unified 'nexus_*' tools exposed to AI agents
  * Compatible with GitHub Copilot's 128 tool limit
  * Complete provider abstraction

- Replace all 'any' types with proper TypeScript interfaces:
  * Type guards for discriminated unions
  * Provider-specific interfaces with normalization
  * Type-safe error handling throughout

- Add comprehensive testing and documentation:
  * End-to-end testing of aggregated operations
  * Tool hiding validation
  * Implementation guide with performance metrics

Performance improvements:
- Tool complexity: 130+ → 36 tools (3.6x reduction)
- Multi-provider speed: 3x faster execution
- AI agent compatibility: Well within tool limits
- Error resilience: Individual provider fault tolerance

The unified interface enables seamless DevOps operations across GitHub, GitLab,
and Azure DevOps through a single consistent API while maintaining high
performance and reliability standards.

## [1.6.2](https://github.com/structured-world/project-nexus-mcp/compare/v1.6.1...v1.6.2) (2025-09-13)


### Bug Fixes

* suppress Yarn progress output causing MCP JSON parsing errors ([283d4d9](https://github.com/structured-world/project-nexus-mcp/commit/283d4d9b194f05196e35e7a9452b9f3ac7027067))

## [1.6.1](https://github.com/structured-world/project-nexus-mcp/compare/v1.6.0...v1.6.1) (2025-09-13)


### Bug Fixes

* add YARN_NODE_LINKER=node-modules for Azure MCP compatibility ([758c8ec](https://github.com/structured-world/project-nexus-mcp/commit/758c8ec6362897d250d63b5235d1839b3f503f6a))

# [1.6.0](https://github.com/structured-world/project-nexus-mcp/compare/v1.5.3...v1.6.0) (2025-09-13)


### Features

* add version logging from package.json at startup ([48fe980](https://github.com/structured-world/project-nexus-mcp/commit/48fe98080ddfcf03371323da63db1b44de54dbca))

## [1.5.3](https://github.com/structured-world/project-nexus-mcp/compare/v1.5.2...v1.5.3) (2025-09-13)


### Bug Fixes

* convert debug logging from stderr to unified logger system ([19541fc](https://github.com/structured-world/project-nexus-mcp/commit/19541fc449444e6508bcf51bf13d6e3d8efa420b))

## [1.5.2](https://github.com/structured-world/project-nexus-mcp/compare/v1.5.1...v1.5.2) (2025-09-13)


### Bug Fixes

* enhance Azure MCP startup debugging and improve logging system ([39ebaf3](https://github.com/structured-world/project-nexus-mcp/commit/39ebaf3110d37021b122599245996ca98d187451))

## [1.5.1](https://github.com/structured-world/project-nexus-mcp/compare/v1.5.0...v1.5.1) (2025-09-13)


### Bug Fixes

* replace npx with yarn dlx to resolve npm/yarn conflicts ([0bbaf98](https://github.com/structured-world/project-nexus-mcp/commit/0bbaf98f654eb7b1a6858aaee4065aa0e8f0c5fe))

# [1.5.0](https://github.com/structured-world/project-nexus-mcp/compare/v1.4.0...v1.5.0) (2025-09-13)


### Features

* add environment-controlled logging mode and fix npm/yarn conflicts ([3f07388](https://github.com/structured-world/project-nexus-mcp/commit/3f073881f3143de452ea201ed832ed01e36fd1b2))

# [1.4.0](https://github.com/structured-world/project-nexus-mcp/compare/v1.3.5...v1.4.0) (2025-09-13)


### Features

* implement file-based logging and standardize environment variables ([1d2cb53](https://github.com/structured-world/project-nexus-mcp/commit/1d2cb5339c3aa8a07acb1f454fbd8bc4452c5948))

## [1.3.5](https://github.com/structured-world/project-nexus-mcp/compare/v1.3.4...v1.3.5) (2025-09-13)


### Bug Fixes

* resolve brace-expansion security vulnerability ([cf99fd8](https://github.com/structured-world/project-nexus-mcp/commit/cf99fd80cf2a038df5cbf76d693a9ce0ba8ee0d7))

## [1.3.4](https://github.com/structured-world/project-nexus-mcp/compare/v1.3.3...v1.3.4) (2025-09-13)

### Bug Fixes

- correct coverage URL structure to match expected /coverage/ path ([8282555](https://github.com/structured-world/project-nexus-mcp/commit/8282555254b2f83a0799f7ff246ce21d4e17c13b))

## [1.3.3](https://github.com/structured-world/project-nexus-mcp/compare/v1.3.2...v1.3.3) (2025-09-13)

### Bug Fixes

- add authentication to security scan for GHCR access ([f15aa96](https://github.com/structured-world/project-nexus-mcp/commit/f15aa96f7430bc45979c37d4a3d138d9d2d0d21d))

## [1.3.2](https://github.com/structured-world/project-nexus-mcp/compare/v1.3.1...v1.3.2) (2025-09-13)

### Bug Fixes

- resolve GitHub Actions workflow issues and language detection ([1606005](https://github.com/structured-world/project-nexus-mcp/commit/160600582a76f7ea777b9988c3488abe9e3023a3))

## [1.3.1](https://github.com/structured-world/project-nexus-mcp/compare/v1.3.0...v1.3.1) (2025-09-13)

### Bug Fixes

- improve GitHub Pages workflow permissions and error handling ([4c53c86](https://github.com/structured-world/project-nexus-mcp/commit/4c53c868f4d7094eae5e0be08f0b28c2c647d89e))

# [1.3.0](https://github.com/structured-world/project-nexus-mcp/compare/v1.2.0...v1.3.0) (2025-09-13)

### Features

- add GitHub Pages deployment for coverage reports ([1185a86](https://github.com/structured-world/project-nexus-mcp/commit/1185a868d406c3759621292727ba4117f1bd467b))

# [1.2.0](https://github.com/structured-world/project-nexus-mcp/compare/v1.1.0...v1.2.0) (2025-09-13)

### Features

- add comprehensive Docker support with minimal footprint ([354c331](https://github.com/structured-world/project-nexus-mcp/commit/354c3312358f7149cfce46a6ae9c37bf2ea94834))

# [1.1.0](https://github.com/structured-world/project-nexus-mcp/compare/v1.0.2...v1.1.0) (2025-09-13)

### Features

- enhance MCP server update system with queuing and debug tools ([3b45c5a](https://github.com/structured-world/project-nexus-mcp/commit/3b45c5a9270917093aac6a8b8105bd1ef9043cdb))

## [1.0.2](https://github.com/structured-world/project-nexus-mcp/compare/v1.0.1...v1.0.2) (2025-09-13)

### Bug Fixes

- add publishConfig for scoped package publishing ([1731426](https://github.com/structured-world/project-nexus-mcp/commit/173142607680adc18a8eb0b21abf26f83e6dd925))

## [1.0.1](https://github.com/structured-world/project-nexus-mcp/compare/v1.0.0...v1.0.1) (2025-09-13)

### Bug Fixes

- add public access for scoped package publishing ([cf05e46](https://github.com/structured-world/project-nexus-mcp/commit/cf05e469eb5e647d0496d3f2878569156bcd0902))

# 1.0.0 (2025-09-13)

### Bug Fixes

- remove invalid yarn path reference in .yarnrc.yml ([c7dfd7a](https://github.com/structured-world/project-nexus-mcp/commit/c7dfd7afd7d8207d4348ca34b3a258610e4d6cfd))
- update yarn.lock for scoped package name ([9232013](https://github.com/structured-world/project-nexus-mcp/commit/92320135d3dc0e6a2334ada5401aa00a27aaf718))

### Features

- setup automated semantic versioning and npm publishing ([5104fd4](https://github.com/structured-world/project-nexus-mcp/commit/5104fd451948b039ec68435f716542d78f64dc54))

### BREAKING CHANGES

- Package now requires Node.js 22+ and uses automated versioning

# 1.0.0 (2025-09-13)

### Bug Fixes

- remove invalid yarn path reference in .yarnrc.yml ([c7dfd7a](https://github.com/structured-world/project-nexus-mcp/commit/c7dfd7afd7d8207d4348ca34b3a258610e4d6cfd))
- update yarn.lock for scoped package name ([9232013](https://github.com/structured-world/project-nexus-mcp/commit/92320135d3dc0e6a2334ada5401aa00a27aaf718))

### Features

- setup automated semantic versioning and npm publishing ([5104fd4](https://github.com/structured-world/project-nexus-mcp/commit/5104fd451948b039ec68435f716542d78f64dc54))

### BREAKING CHANGES

- Package now requires Node.js 22+ and uses automated versioning
