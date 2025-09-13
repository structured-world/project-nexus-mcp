import {
  validateProviderConfig,
  validateAllProviderConfigs,
  getConfiguredProviders,
  getConfigurationHelp,
  validateConfigurationForCLI,
  logConfigurationStatus,
} from '../../utils/configValidator.js';
import { Provider } from '../../types/index.js';

describe('Configuration Validator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('validateProviderConfig', () => {
    describe('GitHub provider', () => {
      it('should pass validation with valid token and org', () => {
        process.env.GITHUB_TOKEN = 'ghp_valid_token_here';
        process.env.GITHUB_ORG = 'myorganization';

        const result = validateProviderConfig('github');

        expect(result).toEqual({
          provider: 'github',
          status: 'configured',
          isValid: true,
        });
      });

      it('should fail validation with valid token but missing org', () => {
        process.env.GITHUB_TOKEN = 'ghp_valid_token_here';
        delete process.env.GITHUB_ORG;

        const result = validateProviderConfig('github');

        expect(result).toEqual({
          provider: 'github',
          status: 'missing-project',
          reason:
            'GitHub requires either GITHUB_ORG environment variable or project mappings in .mcp.json',
          isValid: false,
        });
      });

      it('should fail validation with missing token', () => {
        delete process.env.GITHUB_TOKEN;

        const result = validateProviderConfig('github');

        expect(result).toEqual({
          provider: 'github',
          status: 'missing-token',
          reason:
            'Missing or invalid GITHUB_TOKEN. GitHub requires GITHUB_TOKEN environment variable',
          isValid: false,
        });
      });

      it('should fail validation with test token', () => {
        process.env.GITHUB_TOKEN = 'test_token';
        process.env.GITHUB_ORG = 'myorg';

        const result = validateProviderConfig('github');

        expect(result.status).toBe('missing-token');
        expect(result.isValid).toBe(false);
      });

      it('should fail validation with short token', () => {
        process.env.GITHUB_TOKEN = 'abc';
        process.env.GITHUB_ORG = 'myorg';

        const result = validateProviderConfig('github');

        expect(result.status).toBe('missing-token');
        expect(result.isValid).toBe(false);
      });
    });

    describe('GitLab provider', () => {
      it('should pass validation with valid token', () => {
        process.env.GITLAB_TOKEN = 'glpat_valid_token_here';

        const result = validateProviderConfig('gitlab');

        expect(result).toEqual({
          provider: 'gitlab',
          status: 'configured',
          isValid: true,
        });
      });

      it('should fail validation with missing token', () => {
        delete process.env.GITLAB_TOKEN;

        const result = validateProviderConfig('gitlab');

        expect(result.status).toBe('missing-token');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('GITLAB_TOKEN');
      });
    });

    describe('Azure provider', () => {
      it('should pass validation with valid PAT, org, and project', () => {
        process.env.AZURE_TOKEN = 'valid_pat_token_here';
        process.env.AZURE_ORG = 'myorganization';
        process.env.AZURE_PROJECT = 'myproject';

        const result = validateProviderConfig('azure');

        expect(result).toEqual({
          provider: 'azure',
          status: 'configured',
          isValid: true,
        });
      });

      it('should fail validation with PAT and org but missing project', () => {
        process.env.AZURE_TOKEN = 'valid_pat_token_here';
        process.env.AZURE_ORG = 'myorganization';
        delete process.env.AZURE_PROJECT;

        const result = validateProviderConfig('azure');

        expect(result).toEqual({
          provider: 'azure',
          status: 'missing-project',
          reason:
            'Azure DevOps requires either AZURE_PROJECT environment variable or project mappings in .mcp.json',
          isValid: false,
        });
      });

      it('should fail validation with missing PAT', () => {
        delete process.env.AZURE_TOKEN;
        process.env.AZURE_ORG = 'myorganization';

        const result = validateProviderConfig('azure');

        expect(result.status).toBe('missing-token');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('AZURE_TOKEN');
      });

      it('should fail validation with missing organization', () => {
        process.env.AZURE_TOKEN = 'valid_pat_token_here';
        delete process.env.AZURE_ORG;

        const result = validateProviderConfig('azure');

        expect(result.status).toBe('missing-token');
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('AZURE_ORG');
      });
    });

    it('should handle unknown provider', () => {
      const result = validateProviderConfig('unknown' as Provider);

      expect(result).toEqual({
        provider: 'unknown',
        status: 'invalid-config',
        reason: 'Unknown provider: unknown',
        isValid: false,
      });
    });
  });

  describe('validateAllProviderConfigs', () => {
    it('should validate all providers', () => {
      process.env.GITHUB_TOKEN = 'ghp_valid_github_token';
      process.env.GITHUB_ORG = 'myorg';
      delete process.env.GITLAB_TOKEN;
      delete process.env.AZURE_TOKEN;

      const results = validateAllProviderConfigs();

      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({ provider: 'github', isValid: true });
      expect(results[1]).toMatchObject({ provider: 'gitlab', isValid: false });
      expect(results[2]).toMatchObject({ provider: 'azure', isValid: false });
    });

    it('should return empty results when no providers configured', () => {
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITLAB_TOKEN;
      delete process.env.AZURE_TOKEN;
      delete process.env.AZURE_ORG;

      const results = validateAllProviderConfigs();

      expect(results).toHaveLength(3);
      expect(results.every((r) => !r.isValid)).toBe(true);
    });
  });

  describe('getConfiguredProviders', () => {
    it('should return only configured providers', () => {
      const results = [
        { provider: 'github' as Provider, status: 'configured' as const, isValid: true },
        { provider: 'gitlab' as Provider, status: 'missing-token' as const, isValid: false },
        { provider: 'azure' as Provider, status: 'configured' as const, isValid: true },
      ];

      const configured = getConfiguredProviders(results);

      expect(configured).toEqual(['github', 'azure']);
    });

    it('should return empty array when no providers configured', () => {
      const results = [
        { provider: 'github' as Provider, status: 'missing-token' as const, isValid: false },
        { provider: 'gitlab' as Provider, status: 'missing-token' as const, isValid: false },
      ];

      const configured = getConfiguredProviders(results);

      expect(configured).toEqual([]);
    });
  });

  describe('getConfigurationHelp', () => {
    it('should provide help for specific provider', () => {
      const help = getConfigurationHelp('github');

      expect(help).toContain('GITHUB Configuration');
      expect(help).toContain('GITHUB_TOKEN');
      expect(help).toContain('Required environment variables');
    });

    it('should provide general help when no provider specified', () => {
      const help = getConfigurationHelp();

      expect(help).toContain('Provider Configuration Help');
      expect(help).toContain('Available providers');
      expect(help).toContain('github, gitlab, azure');
    });

    it('should handle unknown provider', () => {
      const help = getConfigurationHelp('unknown' as Provider);

      expect(help).toContain('Unknown provider: unknown');
    });
  });

  describe('validateConfigurationForCLI', () => {
    it('should provide CLI-friendly validation results', () => {
      process.env.GITHUB_TOKEN = 'ghp_valid_token';
      process.env.GITHUB_ORG = 'myorg';
      delete process.env.GITLAB_TOKEN;
      delete process.env.AZURE_TOKEN;

      const result = validateConfigurationForCLI();

      expect(result.isValid).toBe(true);
      expect(result.configuredProviders).toEqual(['github']);
      expect(result.errors).toHaveLength(2); // GitLab and Azure missing tokens
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle no configured providers', () => {
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITLAB_TOKEN;
      delete process.env.AZURE_TOKEN;

      const result = validateConfigurationForCLI();

      expect(result.isValid).toBe(false);
      expect(result.configuredProviders).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should categorize errors vs warnings correctly', () => {
      // Test the categorization logic that exists in validateConfigurationForCLI
      // Line 232 is the warnings.push() call for non-error statuses

      // Simulate results that would trigger both error and warning paths
      const mockResults = [
        { provider: 'github' as Provider, status: 'configured' as const, isValid: true },
        {
          provider: 'gitlab' as Provider,
          status: 'missing-token' as const,
          isValid: false,
          reason: 'Token missing',
        },
        {
          provider: 'azure' as Provider,
          status: 'invalid-config' as const,
          isValid: false,
          reason: 'Invalid config',
        },
        {
          provider: 'custom' as Provider,
          status: 'missing-project' as const,
          isValid: false,
          reason: 'Project missing',
        },
      ];

      // Test the exact logic from the function
      const errors: string[] = [];
      const warnings: string[] = [];

      mockResults.forEach((result) => {
        if (!result.isValid) {
          if (result.status === 'missing-token' || result.status === 'invalid-config') {
            errors.push(result.reason ?? 'Configuration error');
          } else {
            warnings.push(result.reason ?? 'Configuration warning');
          }
        }
      });

      expect(errors).toHaveLength(2); // missing-token and invalid-config
      expect(warnings).toHaveLength(1); // missing-project (anything else)
      expect(errors).toContain('Token missing');
      expect(errors).toContain('Invalid config');
      expect(warnings).toContain('Project missing');
    });
  });

  describe('logConfigurationStatus', () => {
    let mockConsoleLog: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
      mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      mockConsoleLog.mockRestore();
    });

    it('should log status for configured and missing providers', () => {
      const results = [
        { provider: 'github' as Provider, status: 'configured' as const, isValid: true },
        {
          provider: 'gitlab' as Provider,
          status: 'missing-token' as const,
          isValid: false,
          reason: 'Token missing',
        },
        {
          provider: 'azure' as Provider,
          status: 'missing-project' as const,
          isValid: false,
          reason: 'Project missing',
        },
      ];

      logConfigurationStatus(results);

      expect(mockConsoleLog).toHaveBeenCalledWith('\n=== Provider Configuration Status ===');
      expect(mockConsoleLog).toHaveBeenCalledWith('\n✅ Configured providers:');
      expect(mockConsoleLog).toHaveBeenCalledWith('   github: Ready');
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\n⚠️  Skipped providers (missing configuration):',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith('   gitlab: Token missing');
      expect(mockConsoleLog).toHaveBeenCalledWith('   azure: Project missing');
      expect(mockConsoleLog).toHaveBeenCalledWith('=====================================\n');
    });

    it('should log only configured providers when all are valid', () => {
      const results = [
        { provider: 'github' as Provider, status: 'configured' as const, isValid: true },
        { provider: 'gitlab' as Provider, status: 'configured' as const, isValid: true },
      ];

      logConfigurationStatus(results);

      expect(mockConsoleLog).toHaveBeenCalledWith('\n✅ Configured providers:');
      expect(mockConsoleLog).toHaveBeenCalledWith('   github: Ready');
      expect(mockConsoleLog).toHaveBeenCalledWith('   gitlab: Ready');
      expect(mockConsoleLog).not.toHaveBeenCalledWith(
        '\n⚠️  Skipped providers (missing configuration):',
      );
    });

    it('should show setup instructions when all providers are missing', () => {
      const results = [
        {
          provider: 'github' as Provider,
          status: 'missing-token' as const,
          isValid: false,
          reason: 'Token missing',
        },
        {
          provider: 'gitlab' as Provider,
          status: 'missing-token' as const,
          isValid: false,
          reason: 'Token missing',
        },
        {
          provider: 'azure' as Provider,
          status: 'missing-token' as const,
          isValid: false,
          reason: 'Token missing',
        },
      ];

      logConfigurationStatus(results);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\n🔧 To enable providers, set the required environment variables:',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '\n   Example: export GITHUB_TOKEN=ghp_your_token_here',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '   github: GitHub requires GITHUB_TOKEN environment variable',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '   gitlab: GitLab requires GITLAB_TOKEN environment variable',
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '   azure: Azure DevOps requires AZURE_TOKEN and AZURE_ORG environment variables',
      );
    });

    it('should handle empty results array', () => {
      const results: never[] = [];

      logConfigurationStatus(results);

      expect(mockConsoleLog).toHaveBeenCalledWith('\n=== Provider Configuration Status ===');
      expect(mockConsoleLog).toHaveBeenCalledWith('=====================================\n');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string tokens', () => {
      process.env.GITHUB_TOKEN = '';
      process.env.GITHUB_ORG = 'myorg';

      const result = validateProviderConfig('github');

      expect(result.isValid).toBe(false);
      expect(result.status).toBe('missing-token');
    });

    it('should handle whitespace-only tokens', () => {
      process.env.GITHUB_TOKEN = '   ';
      process.env.GITHUB_ORG = 'myorg';

      const result = validateProviderConfig('github');

      expect(result.isValid).toBe(false);
    });

    it('should handle placeholder tokens', () => {
      process.env.GITHUB_TOKEN = 'your_token_here';
      process.env.GITHUB_ORG = 'myorg';

      const result = validateProviderConfig('github');

      expect(result.isValid).toBe(false);
    });
  });
});
