import { spawn } from 'child_process';

// Test GitHub MCP server
const github = spawn('yarn', ['dlx', '-q', '@modelcontextprotocol/server-github'], {
  env: { ...process.env, GITHUB_TOKEN: 'test_token' }
});

github.stdin.write(JSON.stringify({
  jsonrpc: "2.0", 
  id: 1, 
  method: "tools/list"
}) + '\n');

github.stdout.on('data', (data) => {
  console.log('GitHub tools:', data.toString());
  github.kill();
});

github.stderr.on('data', (data) => {
  console.log('GitHub stderr:', data.toString());
});
