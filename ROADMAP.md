# Roadmap

Project Nexus is at an early stage. We have ambitious plans to expand its capabilities and platform support:

- **Additional Providers:** Develop adapters (or proxy connectors) for other popular DevOps and project management tools:
  - Jira – Integration with Atlassian Jira for issue and project tracking.
  - Jenkins – MCP server for Jenkins to manage jobs, triggers, and pipeline status.
  - Trello – Adapter for Trello boards, cards, and checklists (popular lightweight project management).
  - ([Bonus] Potentially: Bitbucket support to cover Atlassian’s code hosting, if there is demand).
- **Cross-Platform Linking:** Enable linking and transferring of entities between systems. For example, linking a GitHub commit to a Jira ticket, or migrating tasks from Trello to Azure DevOps. This will likely be delivered as high-level tools (e.g., a “relay” command or multi-step automation).
- **Enhanced Security & Auth:** Implement OAuth/OIDC flows for platforms that support it, to avoid PAT usage. Also, improve fine-grained permission controls (perhaps allowing read-only mode, or limiting certain tools for safer usage with untrusted AI). Work closely with evolving MCP security best practices.
- **Performance & Scaling:** Optimize the server for large repositories and high request volumes. Possibly add caching for frequently accessed resources (to speed up file reads or issue queries) while respecting cache invalidation.
- **Official MCP Registry Listing:** Prepare Project Nexus for inclusion in the official Model Context Protocol registry and VS Code’s curated list of MCP servers. This involves rigorous security audits and meeting validation criteria so users can one-click install Nexus in tools like Claude and VS Code.
- **Community Plugins:** Define a plugin interface for third-party developers to add custom tools or integrations. For instance, an internal team might plugin a proprietary system (like an internal ticketing system) into Project Nexus without modifying core code.
- **Documentation & Examples:** Continuously improve documentation. Provide example configs for various scenarios (multi-project monorepos, enterprise setups) and publish walkthroughs (blog posts or videos) on using Nexus with different AI agents.

Each release will be documented in the CHANGELOG. We welcome feedback on prioritizing these items – feel free to open issues or join discussions in the GitHub repo.

