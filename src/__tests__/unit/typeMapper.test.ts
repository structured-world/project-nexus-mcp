import { TypeMapper, createUnifiedLabels, MappingInput } from '../../adapters/TypeMapper.js';
import { Provider } from '../../types/index.js';

describe('TypeMapper', () => {
  describe('mapType', () => {
    describe('GitLab mapping', () => {
      it('should map GitLab epic to Azure Epic', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'agile',
          title: 'Test Epic',
          gitlab: { glType: 'epic' },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Epic');
        expect(result.rationale).toContain('GitLab type is epic (group-level)');
        expect(result.addTags).toEqual([]);
      });

      it('should map GitLab issue to User Story in Agile process', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'agile',
          title: 'Test Issue',
          gitlab: { glType: 'issue' },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('User Story');
        expect(result.rationale).toContain('GitLab issue → Azure User Story (agile process)');
      });

      it('should map GitLab issue to Product Backlog Item in Scrum process', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'scrum',
          title: 'Test Issue',
          gitlab: { glType: 'issue' },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Product Backlog Item');
        expect(result.rationale).toContain(
          'GitLab issue → Azure Product Backlog Item (scrum process)',
        );
      });

      it('should map GitLab incident to Issue with incident tag in Basic process', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'basic',
          title: 'Test Incident',
          gitlab: { glType: 'incident' },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Issue');
        expect(result.addTags).toContain('incident');
        expect(result.rationale).toContain(
          'GitLab type is incident → map to Bug; preserve tag `incident`',
        );
      });

      it('should map GitLab incident to Bug in Agile/Scrum process', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'agile',
          title: 'Test Incident',
          gitlab: { glType: 'incident' },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Bug');
        expect(result.addTags).not.toContain('incident');
      });

      it('should map GitLab test_case to Task with test-case tag in Basic process', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'basic',
          title: 'Test Case',
          gitlab: { glType: 'test_case' },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Task');
        expect(result.addTags).toContain('test-case');
      });

      it('should map GitLab test_case to Test Case in Agile/Scrum process', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'agile',
          title: 'Test Case',
          gitlab: { glType: 'test_case' },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Test Case');
        expect(result.addTags).not.toContain('test-case');
      });

      it('should handle group-level epics', () => {
        const input: MappingInput = {
          provider: 'gitlab',
          process: 'agile',
          title: 'Group Epic',
          gitlab: { glType: 'issue', isGroupEpic: true },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Epic');
        expect(result.rationale).toContain('GitLab type is epic (group-level)');
      });
    });

    describe('GitHub mapping', () => {
      it('should detect and map GitHub epic label', () => {
        const labels = createUnifiedLabels(['epic', 'priority-high']);
        const input: MappingInput = {
          provider: 'github',
          process: 'agile',
          title: 'Test Epic',
          github: { labels },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Epic');
        expect(result.rationale[0]).toContain('Detected GitHub type: epic from labels:');
      });

      it('should detect and map GitHub bug label', () => {
        const labels = createUnifiedLabels(['bug', 'critical']);
        const input: MappingInput = {
          provider: 'github',
          process: 'agile',
          title: 'Test Bug',
          github: { labels },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Bug');
        expect(result.rationale[0]).toContain('Detected GitHub type: bug from labels:');
      });

      it('should map GitHub bug to Issue in Basic process', () => {
        const labels = createUnifiedLabels(['bug']);
        const input: MappingInput = {
          provider: 'github',
          process: 'basic',
          title: 'Test Bug',
          github: { labels },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Issue');
      });

      it('should detect enhancement and map to Feature when has children', () => {
        const labels = createUnifiedLabels(['enhancement']);
        const input: MappingInput = {
          provider: 'github',
          process: 'agile',
          title: 'Test Enhancement',
          github: { labels, childCount: 3 },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Feature');
        expect(result.rationale).toContain('Enhancement with 3 children → Feature');
      });

      it('should map enhancement to User Story without children in Agile', () => {
        const labels = createUnifiedLabels(['enhancement']);
        const input: MappingInput = {
          provider: 'github',
          process: 'agile',
          title: 'Test Enhancement',
          github: { labels, childCount: 0 },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('User Story');
        expect(result.addTags).toContain('enhancement');
      });

      it('should map task label to Task', () => {
        const labels = createUnifiedLabels(['task']);
        const input: MappingInput = {
          provider: 'github',
          process: 'agile',
          title: 'Test Task',
          github: { labels },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Task');
        expect(result.rationale[0]).toContain('Detected GitHub type: task from labels:');
      });

      it('should default to User Story in Agile for unlabeled issues', () => {
        const labels = createUnifiedLabels([]);
        const input: MappingInput = {
          provider: 'github',
          process: 'agile',
          title: 'Unlabeled Issue',
          github: { labels },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('User Story');
        expect(result.rationale[0]).toContain('Detected GitHub type: issue from labels:');
      });

      it('should default to Issue in Basic process for unlabeled issues', () => {
        const labels = createUnifiedLabels([]);
        const input: MappingInput = {
          provider: 'github',
          process: 'basic',
          title: 'Unlabeled Issue',
          github: { labels },
        };

        const result = TypeMapper.mapType(input);

        expect(result.targetType).toBe('Issue');
      });
    });

    it('should provide fallback for unknown provider', () => {
      const input: MappingInput = {
        provider: 'unknown' as Provider,
        title: 'Unknown Provider Item',
      };

      const result = TypeMapper.mapType(input);

      expect(result.targetType).toBe('Issue');
      expect(result.rationale).toContain(
        'Unknown provider or missing type hints; using default mapping',
      );
    });

    it('should provide fallback for missing type hints', () => {
      const input: MappingInput = {
        provider: 'gitlab',
        title: 'Missing Type Hints',
      };

      const result = TypeMapper.mapType(input);

      expect(result.targetType).toBe('Issue');
      expect(result.rationale).toContain(
        'Unknown provider or missing type hints; using default mapping',
      );
    });
  });

  describe('Reverse mapping functions', () => {
    describe('mapAzureToGitLab', () => {
      it('should map Azure types to GitLab types', () => {
        expect(TypeMapper.mapAzureToGitLab('Epic')).toEqual({
          type: 'epic',
          tags: ['azure-epic'],
        });

        expect(TypeMapper.mapAzureToGitLab('User Story')).toEqual({
          type: 'issue',
          tags: ['azure-user-story'],
        });

        expect(TypeMapper.mapAzureToGitLab('Bug')).toEqual({
          type: 'incident',
          tags: ['azure-bug'],
        });

        expect(TypeMapper.mapAzureToGitLab('Task')).toEqual({
          type: 'task',
          tags: ['azure-task'],
        });
      });

      it('should not add tags for generic Issue type', () => {
        expect(TypeMapper.mapAzureToGitLab('Issue')).toEqual({
          type: 'issue',
          tags: [],
        });
      });

      it('should handle unknown types', () => {
        expect(TypeMapper.mapAzureToGitLab('Unknown Type')).toEqual({
          type: 'issue',
          tags: ['azure-unknown-type'],
        });
      });
    });

    describe('mapAzureToGitHub', () => {
      it('should map Azure types to GitHub labels', () => {
        expect(TypeMapper.mapAzureToGitHub('Epic')).toEqual(['epic']);
        expect(TypeMapper.mapAzureToGitHub('Feature')).toEqual(['enhancement', 'feature']);
        expect(TypeMapper.mapAzureToGitHub('User Story')).toEqual(['story']);
        expect(TypeMapper.mapAzureToGitHub('Bug')).toEqual(['bug']);
        expect(TypeMapper.mapAzureToGitHub('Task')).toEqual(['task']);
        expect(TypeMapper.mapAzureToGitHub('Test Case')).toEqual(['test']);
      });

      it('should return empty array for Issue', () => {
        expect(TypeMapper.mapAzureToGitHub('Issue')).toEqual([]);
      });

      it('should handle unknown types', () => {
        expect(TypeMapper.mapAzureToGitHub('Unknown')).toEqual([]);
      });
    });

    describe('mapGitLabToGitHub', () => {
      it('should map GitLab types to GitHub labels', () => {
        expect(TypeMapper.mapGitLabToGitHub('epic')).toEqual(['epic']);
        expect(TypeMapper.mapGitLabToGitHub('task')).toEqual(['task']);
        expect(TypeMapper.mapGitLabToGitHub('incident')).toEqual(['bug', 'incident']);
        expect(TypeMapper.mapGitLabToGitHub('bug')).toEqual(['bug']);
        expect(TypeMapper.mapGitLabToGitHub('test_case')).toEqual(['test']);
      });

      it('should return empty array for generic issue', () => {
        expect(TypeMapper.mapGitLabToGitHub('issue')).toEqual([]);
      });

      it('should handle unknown types', () => {
        expect(TypeMapper.mapGitLabToGitHub('unknown')).toEqual([]);
      });
    });
  });

  describe('normalizeType', () => {
    it('should normalize common types', () => {
      expect(TypeMapper.normalizeType('epic')).toBe('epic');
      expect(TypeMapper.normalizeType('task')).toBe('task');
      expect(TypeMapper.normalizeType('bug')).toBe('bug');
      expect(TypeMapper.normalizeType('issue')).toBe('issue');
    });

    it('should normalize GitLab-specific types', () => {
      expect(TypeMapper.normalizeType('incident')).toBe('bug');
      expect(TypeMapper.normalizeType('test_case')).toBe('test');
    });

    it('should normalize GitHub-specific types', () => {
      expect(TypeMapper.normalizeType('enhancement')).toBe('story');
    });

    it('should normalize Azure DevOps-specific types', () => {
      expect(TypeMapper.normalizeType('User Story')).toBe('story');
      expect(TypeMapper.normalizeType('Product Backlog Item')).toBe('story');
      expect(TypeMapper.normalizeType('Test Case')).toBe('test');
    });

    it('should be case-insensitive', () => {
      expect(TypeMapper.normalizeType('EPIC')).toBe('epic');
      expect(TypeMapper.normalizeType('User story')).toBe('story');
      expect(TypeMapper.normalizeType('TEST_CASE')).toBe('test');
    });

    it('should default to issue for unknown types', () => {
      expect(TypeMapper.normalizeType('unknown')).toBe('issue');
      expect(TypeMapper.normalizeType('custom-type')).toBe('issue');
    });
  });
});

describe('createUnifiedLabels', () => {
  it('should create UnifiedLabels from string array', () => {
    const labels = createUnifiedLabels(['Bug', 'Priority-High', 'Feature']);

    expect(labels.has('bug')).toBe(true);
    expect(labels.has('priority-high')).toBe(true);
    expect(labels.has('feature')).toBe(true);
    expect(labels.has('nonexistent')).toBe(false);

    expect(labels.all).toEqual(['Bug', 'Priority-High', 'Feature']);
  });

  it('should handle case-insensitive label checking', () => {
    const labels = createUnifiedLabels(['ENHANCEMENT', 'bug', 'Task']);

    expect(labels.has('enhancement')).toBe(true);
    expect(labels.has('ENHANCEMENT')).toBe(true);
    expect(labels.has('Enhancement')).toBe(true);
    expect(labels.has('BUG')).toBe(true);
    expect(labels.has('task')).toBe(true);
  });

  it('should handle empty labels array', () => {
    const labels = createUnifiedLabels([]);

    expect(labels.has('anything')).toBe(false);
    expect(labels.all).toEqual([]);
  });

  it('should preserve original label casing in all property', () => {
    const original = ['CamelCase', 'kebab-case', 'UPPERCASE'];
    const labels = createUnifiedLabels(original);

    expect(labels.all).toEqual(original);
  });
});
