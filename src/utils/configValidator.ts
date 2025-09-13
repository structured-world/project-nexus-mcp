import { Provider } from '../types/index.js';

/**
 * Configuration validation results
 */
export interface ConfigValidationResult {
  provider: Provider;
  status: 'configured' | 'missing-token' | 'missing-project' | 'invalid-config' | 'skipped';
  reason?: string;
  isValid: boolean;
}

/**
 * Provider configuration requirements
 */
interface ProviderRequirements {
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  requiredConfigFields: string[];
  description: string;
}

const PROVIDER_REQUIREMENTS: Record<string, ProviderRequirements | undefined> = {
  github: {
    requiredEnvVars: ['GITHUB_TOKEN'],
    optionalEnvVars: ['GITHUB_ORG'],
    requiredConfigFields: [],
    description: 'GitHub requires GITHUB_TOKEN environment variable',
  },
  gitlab: {
    requiredEnvVars: ['GITLAB_TOKEN'],
    optionalEnvVars: ['GITLAB_URL', 'GITLAB_GROUP'],
    requiredConfigFields: [],
    description: 'GitLab requires GITLAB_TOKEN environment variable',
  },
  azure: {
    requiredEnvVars: ['AZURE_TOKEN', 'AZURE_ORG'],
    optionalEnvVars: ['AZURE_PROJECT'],
    requiredConfigFields: [],
    description: 'Azure DevOps requires AZURE_TOKEN and AZURE_ORG environment variables',
  },
};

/**
 * Validates configuration for a specific provider
 */
export function validateProviderConfig(provider: string): ConfigValidationResult {
  const requirements = PROVIDER_REQUIREMENTS[provider];

  if (!requirements) {
    return {
      provider: provider as Provider,
      status: 'invalid-config',
      reason: `Unknown provider: ${provider}`,
      isValid: false,
    };
  }

  // Check for required environment variables
  for (const envVar of requirements.requiredEnvVars) {
    const value = process.env[envVar];

    if (!value || value === 'test_token' || value === 'your_token_here' || value.length < 5) {
      return {
        provider: provider as Provider,
        status: 'missing-token',
        reason: `Missing or invalid ${envVar}. ${requirements.description}`,
        isValid: false,
      };
    }
  }

  // Additional provider-specific validation
  switch (provider) {
    case 'github':
      if (!process.env.GITHUB_ORG && !hasGitHubProjectMapping()) {
        return {
          provider: provider as Provider,
          status: 'missing-project',
          reason:
            'GitHub requires either GITHUB_ORG environment variable or project mappings in .mcp.json',
          isValid: false,
        };
      }
      break;

    case 'azure':
      if (!process.env.AZURE_PROJECT && !hasAzureProjectMapping()) {
        return {
          provider: provider as Provider,
          status: 'missing-project',
          reason:
            'Azure DevOps requires either AZURE_PROJECT environment variable or project mappings in .mcp.json',
          isValid: false,
        };
      }
      break;
  }

  return {
    provider: provider as Provider,
    status: 'configured',
    isValid: true,
  };
}

/**
 * Validates all supported providers
 */
export function validateAllProviderConfigs(): ConfigValidationResult[] {
  const results: ConfigValidationResult[] = [];

  for (const provider of Object.keys(PROVIDER_REQUIREMENTS) as Provider[]) {
    results.push(validateProviderConfig(provider));
  }

  return results;
}

/**
 * Filters results to only include properly configured providers
 */
export function getConfiguredProviders(results: ConfigValidationResult[]): Provider[] {
  return results.filter((result) => result.isValid).map((result) => result.provider);
}

/**
 * Logs configuration validation results in a user-friendly format
 */
export function logConfigurationStatus(results: ConfigValidationResult[]): void {
  console.log('\n=== Provider Configuration Status ===');

  const configured = results.filter((r) => r.isValid);
  const missing = results.filter((r) => !r.isValid);

  if (configured.length > 0) {
    console.log('\n✅ Configured providers:');
    configured.forEach((result) => {
      console.log(`   ${result.provider}: Ready`);
    });
  }

  if (missing.length > 0) {
    console.log('\n⚠️  Skipped providers (missing configuration):');
    missing.forEach((result) => {
      console.log(`   ${result.provider}: ${result.reason}`);
    });
  }

  if (missing.length === results.length) {
    console.log('\n🔧 To enable providers, set the required environment variables:');
    missing.forEach((result) => {
      const req = PROVIDER_REQUIREMENTS[result.provider];
      if (req) {
        console.log(`   ${result.provider}: ${req.description}`);
      }
    });
    console.log('\n   Example: export GITHUB_TOKEN=ghp_your_token_here');
  }

  console.log('=====================================\n');
}

/**
 * Creates help text for provider configuration
 */
export function getConfigurationHelp(provider?: string): string {
  if (provider) {
    const req = PROVIDER_REQUIREMENTS[provider];
    if (!req) return `Unknown provider: ${provider}`;

    return `${provider.toUpperCase()} Configuration:
${req.description}

Required environment variables:
${req.requiredEnvVars.map((env) => `  - ${env}`).join('\n')}

Optional environment variables:
${req.optionalEnvVars.map((env) => `  - ${env}`).join('\n')}`;
  }

  return `Provider Configuration Help:

Available providers: ${Object.keys(PROVIDER_REQUIREMENTS).join(', ')}

Use --help <provider> for specific configuration requirements.

Quick setup examples:
  export GITHUB_TOKEN=ghp_your_token_here
  export GITLAB_TOKEN=glpat_your_token_here  
  export AZURE_TOKEN=your_pat_here
  export AZURE_ORG=your_org_name`;
}

/**
 * Check if GitHub project mapping exists in config
 */
function hasGitHubProjectMapping(): boolean {
  // In a real implementation, this would check .mcp.json for project mappings
  // For now, return false to require explicit org configuration
  return false;
}

/**
 * Check if Azure project mapping exists in config
 */
function hasAzureProjectMapping(): boolean {
  // In a real implementation, this would check .mcp.json for project mappings
  // For now, return false to require explicit project configuration
  return false;
}

/**
 * Validates configuration and provides helpful error messages for CLI usage
 */
export function validateConfigurationForCLI(): {
  isValid: boolean;
  configuredProviders: Provider[];
  errors: string[];
  warnings: string[];
} {
  const results = validateAllProviderConfigs();
  const configured = getConfiguredProviders(results);
  const errors: string[] = [];
  const warnings: string[] = [];

  results.forEach((result) => {
    if (!result.isValid) {
      if (result.status === 'missing-token' || result.status === 'invalid-config') {
        errors.push(result.reason ?? 'Configuration error');
      } else {
        warnings.push(result.reason ?? 'Configuration warning');
      }
    }
  });

  return {
    isValid: configured.length > 0,
    configuredProviders: configured,
    errors,
    warnings,
  };
}
