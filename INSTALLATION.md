# Installation & Usage

Project Nexus can be installed as an NPM package or run via Docker. It requires Node.js 16+. Choose one of the following installation methods:

## Using npx (one-shot execution)
For a quick start without explicit install, use npx (comes with npm):
```sh
npx @structured-world/project-nexus-mcp
```
This will download and run Project Nexus in one go. The server will start in STDIO mode by default, ready to be invoked by an AI client. You can also pass flags to npx for specific modes (see below).

## Using Yarn dlx
If you prefer Yarn:
```sh
yarn dlx @structured-world/project-nexus-mcp
```
This similarly fetches and runs the package immediately.

## Using PNPM
dlx equivalent:
```sh
pnpm dlx @structured-world/project-nexus-mcp
```
All the above methods ensure you always run the latest version without global installation. They are great for editor integrations (which often spawn the MCP server process on demand).

## Global Install (optional)
For frequent use, you may install Project Nexus globally:
```sh
npm install -g @structured-world/project-nexus-mcp
# or: yarn global add @structured-world/project-nexus-mcp
# or: pnpm add -g @structured-world/project-nexus-mcp
```
After global install, you can start the server simply by running `project-nexus-mcp` in your terminal.

## Running as a Docker Container
We provide a Docker image for easy deployment. This is useful if you want to run Project Nexus as a persistent service (HTTP server) or in environments where Node.js isn’t directly available.

1. **Fetch the image:** (Docker Hub and GHCR images are available)
   ```sh
   docker pull ghcr.io/structured-world/project-nexus-mcp:latest
   # Or for Docker Hub:
   docker pull structuredworld/project-nexus-mcp:latest
   ```
2. **Run the container:**
   ```sh
   docker run -d -p 4000:4000 \
     -e GITLAB_TOKEN=<your-gitlab-token> \
     -e GITHUB_TOKEN=<your-github-token> \
     -e AZURE_DEVOPS_PAT=<your-azure-pat> \
     ghcr.io/structured-world/project-nexus-mcp:latest --http --port 4000
   ```
   This launches Project Nexus in HTTP mode listening on port 4000 (with SSE streaming enabled). The environment variables in the command above provide the necessary credentials (see Configuration below). The `--http` and `--port 4000` flags instruct Nexus to run as a server. Now multiple AI clients can connect to `http://<docker-host>:4000` as an MCP endpoint.
3. **Verify:** Check logs with `docker logs` to see that the server started and is ready. It should advertise available tools for each configured provider.

You can also integrate this into a Docker Compose setup or Kubernetes for a more permanent service in your infrastructure.

## Persistent Server Mode (self-hosted)
If you want to run Project Nexus continually (e.g., on a server or as a background process on your machine), you can start it in HTTP server mode without Docker:
```sh
project-nexus-mcp --http --port 4000
```
This will keep the process running, accepting MCP requests via HTTP (and upgrading to SSE for streaming responses). You might use a process manager or system service (like PM2, systemd) to keep it alive. Each connected client (AI agent) should initiate a session; Project Nexus will manage sessions so that user-specific context (tokens, project mappings) remain separate. In this mode, you can serve multiple developers or tools at once through a single endpoint.

> **Note:** When running as a service, ensure to secure the endpoint (e.g., run behind a firewall or require an API key) if exposing beyond localhost, as the MCP server can execute actions on your dev platforms.

