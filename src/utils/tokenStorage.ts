import * as fs from 'fs/promises';
import * as path from 'path';

export interface StoredTokens {
  github?: string;
  gitlab?: string;
  azure?: string;
  lastUpdated?: string;
}

export class TokenStorage {
  private readonly tokenFilePath: string;

  constructor(tokenFilePath?: string) {
    this.tokenFilePath = tokenFilePath ?? path.join(process.cwd(), '.tokens.json');
  }

  async loadTokens(): Promise<StoredTokens> {
    try {
      const data = await fs.readFile(this.tokenFilePath, 'utf-8');
      return JSON.parse(data) as StoredTokens;
    } catch {
      // File doesn't exist or is invalid, return empty tokens
      return {};
    }
  }

  async saveTokens(tokens: StoredTokens): Promise<void> {
    const tokensWithTimestamp: StoredTokens = {
      ...tokens,
      lastUpdated: new Date().toISOString(),
    };

    try {
      await fs.writeFile(this.tokenFilePath, JSON.stringify(tokensWithTimestamp, null, 2), 'utf-8');

      // Set restrictive permissions (readable only by owner)
      await fs.chmod(this.tokenFilePath, 0o600);
    } catch (error) {
      process.stderr.write(
        `Warning: Could not save tokens to ${this.tokenFilePath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  async getToken(provider: 'github' | 'gitlab' | 'azure'): Promise<string | undefined> {
    const tokens = await this.loadTokens();
    return tokens[provider];
  }

  async setToken(provider: 'github' | 'gitlab' | 'azure', token: string): Promise<void> {
    const tokens = await this.loadTokens();
    tokens[provider] = token;
    await this.saveTokens(tokens);
  }

  async clearTokens(): Promise<void> {
    try {
      await fs.unlink(this.tokenFilePath);
    } catch {
      // File doesn't exist, which is fine
    }
  }

  getTokensFilePath(): string {
    return this.tokenFilePath;
  }
}
