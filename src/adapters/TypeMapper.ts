import { WorkItemType, Provider, AzureProcess } from '../types/index.js';

/**
 * Intelligent type mapping between different work item taxonomies
 * Based on the mapping rules defined in PROVIDERS.md
 */

export interface UnifiedLabels {
  has(label: string): boolean;
  all: string[];
}

export interface GitLabTypeHints {
  glType?: 'epic' | 'issue' | 'task' | 'incident' | 'bug' | 'test_case';
  isGroupEpic?: boolean;
  childCount?: number;
}

export interface GitHubTypeHints {
  ghType?: 'bug' | 'enhancement' | 'task' | 'epic';
  labels: UnifiedLabels;
  childCount?: number;
}

export interface MappingInput {
  provider: Provider;
  process?: AzureProcess; // For Azure DevOps
  title: string;
  description?: string;
  gitlab?: GitLabTypeHints;
  github?: GitHubTypeHints;
}

export interface MappingResult {
  targetType: string; // Platform-specific type
  addTags: string[];
  rationale: string[];
}

export class TypeMapper {
  private constructor() {
    // Utility class - prevent instantiation
  }

  /**
   * GitLab → Azure DevOps type mapping
   */
  private static gitlabToAzureTypeMap = {
    agile: {
      epic: 'Epic',
      issue: 'User Story',
      task: 'Task',
      incident: 'Bug',
      bug: 'Bug',
      test_case: 'Test Case',
    },
    scrum: {
      epic: 'Epic',
      issue: 'Product Backlog Item',
      task: 'Task',
      incident: 'Bug',
      bug: 'Bug',
      test_case: 'Test Case',
    },
    basic: {
      epic: 'Epic',
      issue: 'Issue',
      task: 'Task',
      incident: 'Issue', // + tag: incident
      bug: 'Issue', // + tag: bug
      test_case: 'Task', // + tag: test-case
    },
  };

  /**
   * GitHub → Azure DevOps type mapping with detection logic
   */
  private static detectGitHubType(labels: string[], body?: string, childCount = 0): string {
    const labelSet = new Set(labels.map((l) => l.toLowerCase()));

    if (labelSet.has('epic')) return 'epic';
    if (labelSet.has('bug')) return 'bug';
    if (labelSet.has('task')) return 'task';
    if (labelSet.has('enhancement')) return 'enhancement';

    // Check for parent-child pattern (epic simulation)
    if (body?.includes('- [ ]') && childCount > 3) return 'epic';

    return 'issue';
  }

  private static mapGitHubToAzure(
    detectedType: string,
    process: AzureProcess,
    childCount = 0,
  ): string {
    switch (detectedType) {
      case 'epic':
        return 'Epic';
      case 'bug':
        return process === 'basic' ? 'Issue' : 'Bug';
      case 'task':
        return 'Task';
      case 'enhancement':
        return childCount >= 2
          ? 'Feature'
          : process === 'scrum'
            ? 'Product Backlog Item'
            : process === 'basic'
              ? 'Issue'
              : 'User Story';
      default:
        return process === 'scrum'
          ? 'Product Backlog Item'
          : process === 'basic'
            ? 'Issue'
            : 'User Story';
    }
  }

  /**
   * Azure DevOps → GitLab type mapping
   */
  private static azureToGitlabTypeMap: Record<string, string> = {
    Epic: 'epic',
    Feature: 'issue',
    'User Story': 'issue',
    'Product Backlog Item': 'issue',
    Issue: 'issue',
    Task: 'task',
    Bug: 'incident',
    'Test Case': 'test_case',
  };

  /**
   * Azure DevOps → GitHub type mapping
   */
  private static azureToGitHubTypeMap: Record<string, string[]> = {
    Epic: ['epic'],
    Feature: ['enhancement', 'feature'],
    'User Story': ['story'],
    'Product Backlog Item': ['story'],
    Issue: [], // No specific label
    Task: ['task'],
    Bug: ['bug'],
    'Test Case': ['test'],
  };

  /**
   * GitLab → GitHub type mapping
   */
  private static gitlabToGitHubTypeMap: Record<string, string[]> = {
    epic: ['epic'],
    issue: [],
    task: ['task'],
    incident: ['bug', 'incident'],
    bug: ['bug'],
    test_case: ['test'],
  };

  /**
   * Main type mapping function
   */
  static mapType(input: MappingInput): MappingResult {
    const { provider, process = 'agile' } = input;
    const rationale: string[] = [];
    const addTags: string[] = [];

    if (provider === 'gitlab' && input.gitlab) {
      return this.mapGitLabType(input.gitlab, process, rationale, addTags);
    } else if (provider === 'github' && input.github) {
      return this.mapGitHubType(input.github, process, rationale, addTags);
    }

    // Default fallback
    rationale.push('Unknown provider or missing type hints; using default mapping');
    return {
      targetType: 'Issue',
      addTags,
      rationale,
    };
  }

  private static mapGitLabType(
    gitlab: GitLabTypeHints,
    process: AzureProcess,
    rationale: string[],
    addTags: string[],
  ): MappingResult {
    const glType = gitlab.glType ?? 'issue';

    // Handle group-level epics
    if (glType === 'epic' || gitlab.isGroupEpic) {
      rationale.push('GitLab type is epic (group-level)');
      return { targetType: 'Epic', addTags, rationale };
    }

    // Handle incidents with special tagging for Basic process
    if (glType === 'incident') {
      rationale.push('GitLab type is incident → map to Bug; preserve tag `incident`');
      if (process === 'basic') {
        addTags.push('incident');
        return { targetType: 'Issue', addTags, rationale };
      }
      return { targetType: 'Bug', addTags, rationale };
    }

    // Handle test cases
    if (glType === 'test_case') {
      rationale.push('GitLab type is test_case');
      if (process === 'basic') {
        addTags.push('test-case');
        return { targetType: 'Task', addTags, rationale };
      }
      return { targetType: 'Test Case', addTags, rationale };
    }

    // Standard mapping
    const mapped = this.gitlabToAzureTypeMap[process][glType] || 'Issue';
    rationale.push(`GitLab ${glType} → Azure ${mapped} (${process} process)`);

    return { targetType: mapped, addTags, rationale };
  }

  private static mapGitHubType(
    github: GitHubTypeHints,
    process: AzureProcess,
    rationale: string[],
    addTags: string[],
  ): MappingResult {
    const labels = github.labels.all;
    const detectedType = this.detectGitHubType(labels, '', github.childCount);

    rationale.push(`Detected GitHub type: ${detectedType} from labels: [${labels.join(', ')}]`);

    // Handle enhancement with child count heuristic
    if (detectedType === 'enhancement' && (github.childCount ?? 0) >= 2) {
      rationale.push(`Enhancement with ${github.childCount} children → Feature`);
      return { targetType: 'Feature', addTags, rationale };
    }

    const mapped = this.mapGitHubToAzure(detectedType, process, github.childCount);
    rationale.push(`GitHub ${detectedType} → Azure ${mapped} (${process} process)`);

    // Preserve enhancement label
    if (detectedType === 'enhancement' && mapped !== 'Feature') {
      addTags.push('enhancement');
    }

    return { targetType: mapped, addTags, rationale };
  }

  /**
   * Reverse mapping: Azure → GitLab
   */
  static mapAzureToGitLab(azureType: string): { type: string; tags: string[] } {
    const type = this.azureToGitlabTypeMap[azureType] || 'issue';
    const tags: string[] = [];

    // Preserve original type information
    if (azureType !== 'Issue') {
      tags.push(`azure-${azureType.toLowerCase().replace(' ', '-')}`);
    }

    return { type, tags };
  }

  /**
   * Reverse mapping: Azure → GitHub
   */
  static mapAzureToGitHub(azureType: string): string[] {
    return this.azureToGitHubTypeMap[azureType] ?? [];
  }

  /**
   * Reverse mapping: GitLab → GitHub
   */
  static mapGitLabToGitHub(gitlabType: string): string[] {
    return this.gitlabToGitHubTypeMap[gitlabType] ?? [];
  }

  /**
   * Normalize type to common WorkItemType
   */
  static normalizeType(type: string): WorkItemType {
    const typeMap: Partial<Record<string, WorkItemType>> = {
      // Common types
      epic: 'epic',
      task: 'task',
      bug: 'bug',
      issue: 'issue',
      story: 'story',
      feature: 'feature',

      // GitLab specific
      incident: 'bug',
      test_case: 'test',

      // GitHub specific
      enhancement: 'story',

      // Azure DevOps specific
      'user story': 'story',
      'product backlog item': 'story',
      'test case': 'test',
    };

    const normalized = typeMap[type.toLowerCase()];
    return normalized ?? 'issue';
  }
}

/**
 * Helper to create UnifiedLabels from string array
 */
export function createUnifiedLabels(labels: string[]): UnifiedLabels {
  const labelSet = new Set(labels.map((l) => l.toLowerCase()));

  return {
    has: (label: string) => labelSet.has(label.toLowerCase()),
    all: labels,
  };
}
