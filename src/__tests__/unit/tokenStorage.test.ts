import * as fs from 'fs/promises';
import * as path from 'path';
import { TokenStorage, StoredTokens } from '../../utils/tokenStorage';

// Mock fs module
jest.mock('fs/promises');
const mockFs = jest.mocked(fs);

describe('TokenStorage', () => {
  let tokenStorage: TokenStorage;
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = path.join(process.cwd(), 'test-tokens.json');
    tokenStorage = new TokenStorage(testFilePath);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use provided token file path', () => {
      const customPath = '/custom/path/tokens.json';
      const storage = new TokenStorage(customPath);
      expect(storage.getTokensFilePath()).toBe(customPath);
    });

    it('should use default token file path when none provided', () => {
      const storage = new TokenStorage();
      const expectedPath = path.join(process.cwd(), '.tokens.json');
      expect(storage.getTokensFilePath()).toBe(expectedPath);
    });
  });

  describe('loadTokens', () => {
    it('should load tokens from file successfully', async () => {
      const mockTokens: StoredTokens = {
        github: 'github-token',
        gitlab: 'gitlab-token',
        lastUpdated: '2025-01-01T00:00:00.000Z',
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockTokens));

      const result = await tokenStorage.loadTokens();

      expect(mockFs.readFile).toHaveBeenCalledWith(testFilePath, 'utf-8');
      expect(result).toEqual(mockTokens);
    });

    it('should return empty object when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await tokenStorage.loadTokens();

      expect(result).toEqual({});
    });

    it('should return empty object when file contains invalid JSON', async () => {
      mockFs.readFile.mockResolvedValue('invalid json');

      const result = await tokenStorage.loadTokens();

      expect(result).toEqual({});
    });
  });

  describe('saveTokens', () => {
    it('should save tokens with timestamp and set permissions', async () => {
      const tokens: StoredTokens = {
        github: 'github-token',
        gitlab: 'gitlab-token',
      };
      const mockDate = '2025-01-01T00:00:00.000Z';
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(mockDate);

      await tokenStorage.saveTokens(tokens);

      const expectedContent = JSON.stringify(
        {
          ...tokens,
          lastUpdated: mockDate,
        },
        null,
        2,
      );

      expect(mockFs.writeFile).toHaveBeenCalledWith(testFilePath, expectedContent, 'utf-8');
      expect(mockFs.chmod).toHaveBeenCalledWith(testFilePath, 0o600);
    });

    it('should handle write errors gracefully', async () => {
      const tokens: StoredTokens = { github: 'token' };
      const mockError = new Error('Permission denied');
      mockFs.writeFile.mockRejectedValue(mockError);

      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation();

      await tokenStorage.saveTokens(tokens);

      expect(stderrSpy).toHaveBeenCalledWith(
        `Warning: Could not save tokens to ${testFilePath}: Permission denied\n`,
      );

      stderrSpy.mockRestore();
    });

    it('should handle chmod errors gracefully', async () => {
      const tokens: StoredTokens = { github: 'token' };
      mockFs.writeFile.mockResolvedValue();
      mockFs.chmod.mockRejectedValue(new Error('Chmod failed'));

      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation();

      await tokenStorage.saveTokens(tokens);

      expect(stderrSpy).toHaveBeenCalledWith(
        `Warning: Could not save tokens to ${testFilePath}: Chmod failed\n`,
      );

      stderrSpy.mockRestore();
    });
  });

  describe('getToken', () => {
    it('should return token for existing provider', async () => {
      const mockTokens: StoredTokens = {
        github: 'github-token',
        gitlab: 'gitlab-token',
        azure: 'azure-token',
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockTokens));

      const result = await tokenStorage.getToken('github');

      expect(result).toBe('github-token');
    });

    it('should return undefined for non-existing provider', async () => {
      const mockTokens: StoredTokens = {
        gitlab: 'gitlab-token',
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockTokens));

      const result = await tokenStorage.getToken('github');

      expect(result).toBeUndefined();
    });

    it('should return undefined when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

      const result = await tokenStorage.getToken('github');

      expect(result).toBeUndefined();
    });
  });

  describe('setToken', () => {
    it('should set token for provider and save', async () => {
      const existingTokens: StoredTokens = {
        gitlab: 'existing-gitlab-token',
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));
      const mockDate = '2025-01-01T00:00:00.000Z';
      jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(mockDate);

      await tokenStorage.setToken('github', 'new-github-token');

      const expectedTokens = {
        gitlab: 'existing-gitlab-token',
        github: 'new-github-token',
        lastUpdated: mockDate,
      };

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        testFilePath,
        JSON.stringify(expectedTokens, null, 2),
        'utf-8',
      );
    });

    it('should overwrite existing token for provider', async () => {
      const existingTokens: StoredTokens = {
        github: 'old-github-token',
        gitlab: 'gitlab-token',
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingTokens));

      await tokenStorage.setToken('github', 'new-github-token');

      expect(mockFs.writeFile).toHaveBeenCalled();
      const writeCall = mockFs.writeFile.mock.calls[0];
      const savedData = JSON.parse(writeCall[1] as string);
      expect(savedData.github).toBe('new-github-token');
      expect(savedData.gitlab).toBe('gitlab-token');
    });
  });

  describe('clearTokens', () => {
    it('should delete token file', async () => {
      await tokenStorage.clearTokens();

      expect(mockFs.unlink).toHaveBeenCalledWith(testFilePath);
    });

    it('should handle file not existing gracefully', async () => {
      mockFs.unlink.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await expect(tokenStorage.clearTokens()).resolves.not.toThrow();
    });
  });

  describe('getTokensFilePath', () => {
    it('should return the token file path', () => {
      expect(tokenStorage.getTokensFilePath()).toBe(testFilePath);
    });
  });
});
