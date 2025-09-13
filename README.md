# Project Nexus – Unified MCP Server for DevOps Platforms

![npm version](https://img.shields.io/npm/v/@structured-world/project-nexus-mcp)
![npm downloads](https://img.shields.io/npm/dm/@structured-world/project-nexus-mcp)
![Release](https://github.com/structured-world/project-nexus-mcp/workflows/Release/badge.svg)
![Codecov](https://codecov.io/gh/structured-world/project-nexus-mcp/branch/main/graph/badge.svg)
[![Coverage Report](https://img.shields.io/badge/Coverage-Live%20Report-brightgreen?logo=github)](https://structured-world.github.io/project-nexus-mcp/coverage/)

Project Nexus is a Model Context Protocol (MCP) server that provides fine-grained, unified access to your development tasks, source code, and CI/CD pipelines across multiple platforms. It enables AI assistants to seamlessly interact with GitLab, GitHub, Azure DevOps, and more through one unified interface.

## Current Implementation Status

**✅ Implemented:**

- Core MCP proxy server with STDIO and HTTP/SSE transport support
- Provider manager for spawning and managing multiple MCP servers (GitHub, GitLab, Azure)
- Unified work items abstraction layer for cross-platform operations
- Tool aggregation with provider-prefixed naming
- Hot-reload capability for updating providers without restart
- Configuration via environment variables
- Basic routing of tool calls, resources, and prompts to appropriate providers

**🚧 In Progress:**

- Full testing with actual provider tokens
- Error handling and recovery mechanisms
- Performance optimizations for large-scale operations

**📋 Planned (see ROADMAP.md):**

- Additional provider support (Jira, Jenkins, Trello)
- Cross-platform entity linking and transfer
- OAuth/OIDC authentication flows
- Caching layer for improved performance

## Overview

The Model Context Protocol has rapidly gained traction as an open standard for connecting AI agents with external tools and data. By early 2025, developers had created over 1,000+ MCP servers for various services, with major players like OpenAI, Anthropic (Claude), Google DeepMind, and Microsoft embracing MCP as a new industry standard. However, organizations today face a fragmented landscape of one-off MCP integrations for each platform. There is no universal solution, and integrating multiple systems remains complex – integration challenges are cited as a key barrier to scaling AI solutions (around one-third of organizations). Security and data privacy are likewise top concerns when connecting AI to development infrastructure (with a majority of developers listing it as a primary worry).

Project Nexus is built to address these gaps. Instead of running separate MCP servers for GitLab, GitHub, Azure, etc., Project Nexus offers a single unified server that can interface with all your major DevOps platforms. This unified approach reduces integration overhead and eliminates duplicated effort across multiple APIs. By standardizing how AI agents access code repositories, issue trackers, and CI/CD tools, Project Nexus improves security and consistency (one controlled gateway) and simplifies configuration for end users. In short, Project Nexus aims to be the “universal adapter” for AI-driven DevOps workflows – connecting your AI copilot to everything it needs with minimal setup.

## Features

- **Multi-Platform Support:** Connects to GitLab, GitHub, and Azure DevOps out-of-the-box (initial release). Project Nexus acts as a proxy to official MCP services where available (e.g. GitHub, Azure) and provides native adapters for others (e.g. GitLab). This means your AI assistant can work with repositories, issues, and pipelines on all these platforms through one server.
- **Reduced Tool Complexity:** Dramatically reduces the number of tools exposed to AI agents by consolidating 100+ provider-specific tools into ~40 unified commands. This is crucial for AI assistants with tool limits (like GitHub Copilot's 128 tool maximum) and simplifies the cognitive load for AI agents working across multiple DevOps platforms simultaneously.
- **Unified Task & Issue Management:** Exposes a common set of tools to list, create, update, and transfer tasks or issues. For example, an AI agent can fetch or create issues regardless of whether the project is on GitLab or Azure Boards, using a unified command set. (Cross-ecosystem task delegation is conceptually supported – laying the groundwork to move or sync tasks between systems in the future.)
- **Repository Operations:** Supports reading and editing code across different source control systems with a uniform interface. Tools cover retrieving repository files, diffs, committing changes, branch management, and merge requests / pull requests handling, abstracting the differences between GitLab, GitHub, etc.
- **Pipeline & CI/CD Control:** Provides tools to interact with build pipelines and CI/CD runs. For example, trigger or monitor Jenkins or Azure DevOps pipelines via a single protocol. (Jenkins support is on the roadmap – see Roadmap below.) The design anticipates integration with CI servers so an AI agent could trigger builds or report pipeline status through Nexus.
- **Standard MCP Protocols:** Fully supports all MCP transport protocols – STDIO, HTTP, and HTTP(S) streaming (Server-Sent Events). You can run Project Nexus as a local CLI (STDIO) for editors that spawn it, or as a long-running HTTP server (with optional SSE for streaming responses) to serve multiple clients. This flexibility allows integration with a variety of AI tools and environments.
- **Unified Resource Schema:** Resources (like files, issues, pipelines) are identified by a uniform schema prefixed with the provider, e.g. `gitlab:mygroup/myrepo` or `azure:Org/Project`. This consistent naming allows AI agents to reference and navigate to the correct system easily. A single project mapping configuration lets the server know which remote project corresponds to your current workspace.
- **Secure Authentication Management:** All provider credentials are handled in one place. Project Nexus supports personal access tokens (PAT) and API keys for each service. For example, use a GitLab PAT for all GitLab operations and an Azure DevOps PAT for Azure – the server isolates and uses these securely per provider. (Future updates will explore OAuth flows and more fine-grained access controls as MCP evolves.)
- **Extensible & Pluggable:** Built with a modular TypeScript architecture – additional provider adapters can be added as plugins. The core uses the official `@modelcontextprotocol/sdk` and a plugin system to accommodate new systems (e.g. Jira, Trello, Jenkins) without altering the core engine. This makes the project easily extensible as new MCP integrations emerge or custom enterprise systems need support.
- **Enterprise-Ready Sessions:** _(Planned)_ When running in server mode, Project Nexus is designed to handle multiple user sessions. Each user can connect with their own credentials and set of platform integrations, enabling a multi-tenant deployment (e.g. a team-wide Nexus server). This ensures that user contexts (like which projects and tokens they use) remain isolated and persistent across AI assistant sessions.

## Installation & Usage

**Quick Start:**
```sh
yarn dlx @structured-world/project-nexus-mcp@latest
```

For detailed installation instructions, MCP client configuration, and Docker setup, see [INSTALLATION.md](./INSTALLATION.md).

**Recommended:** Always use `@latest` to get the newest version with bug fixes and features.

## Configuration

Before using Project Nexus, you need to provide authentication credentials for each platform you want to use. Configuration is done entirely via environment variables:

## Authentication

You will need to provide access tokens or credentials for each platform you use:

- **GitLab:** Set the environment variable `GITLAB_TOKEN` to a Personal Access Token with API access to your GitLab project. For self-hosted GitLab instances, also set `GITLAB_URL` to your instance’s API endpoint (e.g., `https://gitlab.example.com/api/v4`).
- **GitHub:** Set `GITHUB_TOKEN` to a GitHub PAT (or fine-grained token) that has access to your repo and issues. By default, Nexus will connect to GitHub’s official MCP server using this token. (No custom API URL is needed for github.com; GitHub Enterprise support is planned via configuration of an API URL.)
- **Azure DevOps:** Set `AZURE_TOKEN` (Personal Access Token) for Azure DevOps. This token should have rights to the project (e.g., work item read/write, code read/write as needed). Also set `AZURE_ORG` (the organization name) and `AZURE_PROJECT` (project name) if not already part of the mapping string. If using Azure's official MCP, an alternate auth method might be used, but PAT is the simplest to start.
- **Other Providers:** For future integrations like Jira or Trello, expect to provide similar tokens or API keys (e.g., `JIRA_TOKEN`, `TRELLO_KEY` and `TRELLO_TOKEN`). See provider-specific docs as those adapters become available.

You can supply these environment variables in your shell (or `.env` file) when running Project Nexus. For Docker, use the `-e` flags as shown earlier to inject these variables. For local CLI, ensure your environment is set up (for example, export the variables in your terminal or configure in your system's environment settings).

> **Security tip:** Never hard-code credentials in any file that might be checked into source control. Project Nexus uses environment variables exclusively for authentication, ensuring your tokens remain secure and are never exposed to the AI client (the AI sees only the high-level results, not your tokens).

## Tool Description Overrides

Project Nexus supports customization of tool descriptions via environment variables for better integration with your specific workflows.

### Project Mapping via Environment Variables

- **DEFAULT_REPOSITORY**: Sets the default remote repository for code operations (e.g., `gitlab:my-group/my-project`, `github:owner/repo`).
- **DEFAULT_TASK**: Sets the default issue/task tracker (e.g., `gitlab:my-group/my-project`, `azure:Org/Project`).
- For monorepos or multi-project workspaces, use variables like `FRONTEND_REPOSITORY`, `BACKEND_REPOSITORY`, etc., or follow a naming convention for subprojects.
- These variables allow you to configure Nexus without a JSON mapping file, making it easier to deploy in cloud or container environments.

**Note:** For GitLab, epics are only available at the group level. When using `DEFAULT_TASK` or similar variables to define your project, any epic-related operations will be addressed to the parent group of the specified project. For example, if your task project is `gitlab:my-group/my-project`, epics will be managed under `my-group`.

**Example:**

```sh
export DEFAULT_REPOSITORY="github:myorg/myrepo"
export DEFAULT_TASK="github:myorg/myrepo"
```

Or for subprojects:

```sh
export FRONTEND_REPOSITORY="github:myorg/my-frontend"
export BACKEND_REPOSITORY="azure:MyOrg/BackendProject"
```

### Tool Description Overrides

You can customize the descriptions of individual tools using environment variables. This is useful for clarifying platform-specific behaviors or tailoring the UI for your team.

Supported override variables include:

- `TOOL_ADD_ISSUE_COMMENT_DESCRIPTION`
- `TOOL_CREATE_ISSUE_DESCRIPTION`
- `TOOL_LIST_PIPELINES_DESCRIPTION`
- `TOOL_MERGE_REQUEST_DESCRIPTION`
- ...and more as new tools are added.

**Example:**

```sh
export TOOL_ADD_ISSUE_COMMENT_DESCRIPTION="Add a comment to an issue or task on the configured platform."
export TOOL_CREATE_ISSUE_DESCRIPTION="Create a new issue in the default repository."
```

If set, these variables will override the default tool descriptions shown to AI assistants and users.

### Rationale & Compatibility

This environment variable approach is compatible with the GitHub MCP server and other modern MCP implementations. It simplifies configuration, especially for ephemeral or cloud-based deployments, and allows for easy customization of tool behavior and documentation.

For more details, see [GitHub MCP Server](https://github.com/github/github-mcp-server).

## Integration with AI Assistant Platforms

Project Nexus is compatible with popular AI coding assistants and chat platforms that support MCP. Below are steps to configure some common tools (Anthropic Claude, Cursor IDE, and GitHub Copilot) to use Project Nexus as a server:

### Anthropic Claude (Claude Desktop)

Claude Desktop supports MCP servers via its configuration file. To connect Claude to Project Nexus:

1. **Open Claude Desktop Settings:** In Claude Desktop, go to Settings > Developer, then click “Edit Config”. This will open the JSON config file (commonly located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or a similar path on Windows/Linux).
2. **Add the MCP server entry:** Insert a new entry under the `mcpServers` section for Project Nexus. For example:
   ```json
   {
     "mcpServers": {
       "nexus": {
         "command": "npx",
         "args": ["-y", "@structured-world/project-nexus-mcp"],
         "env": {
           "GITLAB_TOKEN": "YOUR_GITLAB_TOKEN",
           "GITHUB_TOKEN": "YOUR_GITHUB_TOKEN",
           "AZURE_TOKEN": "YOUR_AZURE_PAT"
         }
       }
     }
   }
   ```
   Choose a key name (here "nexus") for the server – this is how you will refer to it in Claude. The config above tells Claude to launch Project Nexus by calling npx `@structured-world/project-nexus-mcp`. We pass the needed environment variables so that the server has credentials. (Alternatively, you can omit the env here if you have those variables set globally on your system. Including them explicitly in the config can be convenient on desktop apps.)
3. **Save and Restart Claude:** After editing the config, save the file and restart Claude Desktop. Once restarted, Claude will load the new MCP server.
4. **Verify in Claude:** In a Claude conversation (in a project context), you can use a command like `#nexus.list_issues` or simply ask Claude to perform an action that would require Nexus (e.g., “List my GitLab issues”). If everything is configured, Claude will invoke the Project Nexus server to fulfill the request. Make sure the server is running – Claude will automatically launch it via the npx command when needed.

> _Note: Claude Desktop also offers a one-click installation for some reviewed servers. Project Nexus may be added to their extension marketplace in the future, but until then manual config as above works._

### Cursor IDE

Cursor (an AI-assisted code editor) supports MCP servers similar to VS Code. You can configure Project Nexus for Cursor by editing its MCP settings file:

1. **Locate Cursor’s MCP settings:** Cursor (and Roo CLI) typically use a config file named `cline_mcp_settings.json` in the application data. For example, on macOS the path might be: `~/Library/Application Support/Cursor/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json`. (You can also search Cursor’s documentation for “MCP settings” for the exact location on your OS.)
2. **Add Project Nexus:** Open that file and add an entry under `mcpServers` just like in the Claude example. For instance:
   ```json
   {
     "mcpServers": {
       "nexus": {
         "command": "npx",
         "args": ["-y", "@structured-world/project-nexus-mcp"],
         "env": {
           "GITLAB_TOKEN": "YOUR_GITLAB_TOKEN",
           "GITHUB_TOKEN": "YOUR_GITHUB_TOKEN"
         }
       }
     }
   }
   ```
   Include whichever tokens you need (for platforms you plan to use in that project). If your current project is mapped to only one platform (say just GitHub), you can include just that token.
3. **Use in Cursor:** After saving the config, restart or open Cursor. In the AI chat panel or command palette, you should now have the “nexus” server available. For example, you might see tools from Nexus listed, or you can prompt the assistant with tasks like “Open the file README.md from the repository” and it will call Nexus. Ensure that Cursor is running in an environment where Node.js is accessible (since it will call npx). Cursor will launch the server as needed when you invoke a tool.

### GitHub Copilot (VS Code - Agent Mode)

GitHub Copilot (especially the Copilot Chat in VS Code with Agent mode) supports MCP servers. To integrate Project Nexus:

1. **Open or create the workspace MCP config:** In VS Code, open your project folder. Create a file `.vscode/mcp.json` in the workspace (or you can configure globally via user settings, but workspace config is convenient per project).
2. **Add Project Nexus to mcp.json:** Use the VS Code IntelliSense or manually add an entry. For example:
   ```json
   {
     "servers": {
       "nexus": {
         "command": "npx",
         "args": ["-y", "@structured-world/project-nexus-mcp"],
         "env": {
           "AZURE_TOKEN": "${env:AZURE_DEVOPS_PAT}"
         }
       }
     }
   }
   ```
   This declares a server named "nexus". We specify to run via npx (you could also use a path to the installed project-nexus-mcp binary if you installed globally). Here, we demonstrate using an environment variable for the Azure token – VS Code’s MCP config supports `${env:VAR_NAME}` to reference environment variables. You can do the same for GitLab or GitHub tokens, or hardcode them (not recommended). Save the file.
3. **Enable Copilot Agent mode:** Make sure you have GitHub Copilot enabled and switch to Agent mode in the Copilot Chat view. Your organization admin must have enabled MCP usage in Copilot (as of mid-2025, MCP in VS Code moved out of preview and is generally available[2]).
4. **Use Nexus tools in Copilot:** Once the server is configured, VS Code will automatically start it when you enter Agent mode. Click on the “Tools” button in the Copilot Chat sidebar to see available tools. You should see tools provided by Project Nexus (they may be under categories like repository, issues, pipelines, etc., depending on the configured providers). You can now ask Copilot to perform actions. For example, if you have GitLab configured, you might type: `#nexus.list_projects` or simply ask “Find all TODO comments in the repository” – Copilot will utilize the Nexus server’s Git tools.
5. **Troubleshooting:** If you don’t see the Nexus server tools, check the MCP Servers view in VS Code (Command Palette → “MCP: Show Installed Servers”). Ensure the nexus server is listed and running. If not, you might need to run “MCP: Add Server” and point it to the config, or double-check that Node and npx are accessible to VS Code. Also verify your environment variables are set (if using them in the config).

With this setup, GitHub Copilot’s AI can leverage Project Nexus to access your projects on different platforms. For instance, Copilot can now list Azure DevOps work items or GitLab merge requests directly from VS Code chat, using the unified interface provided by Nexus.

## Roadmap

See the [Roadmap](./ROADMAP.md) for upcoming features and plans.

## Testing & Coverage

Project Nexus includes comprehensive test coverage to ensure reliability and maintainability.

### Running Tests

```bash
# Run all tests
yarn test

# Run tests with coverage
yarn test:cov

# Run tests in watch mode
yarn test:watch
```

### Coverage Reports

Test coverage reports are automatically generated and published to GitHub Pages:

📊 **[Live Coverage Report](https://structured-world.github.io/project-nexus-mcp/coverage/)** - Interactive HTML coverage report

The coverage reports include:

- **Statement coverage** - Which lines of code are executed
- **Branch coverage** - Which code branches are tested
- **Function coverage** - Which functions are called
- **Line coverage** - Overall line-by-line coverage

Coverage is also reported to [Codecov](https://codecov.io/gh/structured-world/project-nexus-mcp) for trend analysis and PR integration.

### Coverage Goals

- **Target**: 80%+ overall coverage
- **Critical paths**: 95%+ coverage for core functionality
- **New features**: Must include comprehensive tests

## Contributing

See the [Contributing Guide](./CONTRIBUTING.md) for how to get involved.

## License

Project Nexus is open-source software, released under the MIT License. See the LICENSE file for details. By using this project, you agree that it comes with no warranty – but we hope it will be useful to your workflows!

---

Project Nexus is part of the Structured World initiative to bring structured, AI-driven productivity to developers. Together, we can streamline how AI works with all the tools we use every day.

## Support the Project

If you find Project Nexus useful, consider supporting its development. Your contributions help keep this project maintained and evolving.

<div align="center">
  <img src="assets/usdt-qr.svg" alt="USDT TRC-20 Donation QR Code" width="150" height="150">
  <br>
  <small>📱 <strong>USDT (TRC-20)</strong></small><br>
  <code>TFDsezHa1cBkoeZT5q2T49Wp66K8t2DmdA</code>
  <br><br>
  <em>Scan with any TRC-20 compatible wallet (TronLink, Trust Wallet, Exodus, etc.)</em>
</div>
