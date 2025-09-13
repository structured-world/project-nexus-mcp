import {
  isMCPResult,
  isProviderAPIResponse,
  hasTextContent,
  isStringOrHasProperty,
  isArrayOfItems,
  isLabelLike,
  isGitLabIssue,
  isGitLabEpic,
  isGitHubIssue,
  isAzureWorkItem,
  isAPIResponse,
} from '../../utils/typeGuards';

describe('typeGuards', () => {
  describe('isMCPResult', () => {
    it('should return true for valid MCP result with content', () => {
      const validResult = {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', url: 'http://example.com/image.png' },
        ],
      };

      expect(isMCPResult(validResult)).toBe(true);
    });

    it('should return true for MCP result without content', () => {
      const resultWithoutContent = { success: true };

      expect(isMCPResult(resultWithoutContent)).toBe(true);
    });

    it('should return false for invalid content array', () => {
      const invalidContent = {
        content: [
          { type: 'text' },
          { invalidItem: true }, // missing type
        ],
      };

      expect(isMCPResult(invalidContent)).toBe(false);
    });

    it('should return false for non-array content', () => {
      const nonArrayContent = {
        content: 'not an array',
      };

      expect(isMCPResult(nonArrayContent)).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(isMCPResult(null)).toBe(false);
      expect(isMCPResult(undefined)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isMCPResult('string')).toBe(false);
      expect(isMCPResult(123)).toBe(false);
      expect(isMCPResult(true)).toBe(false);
    });
  });

  describe('isProviderAPIResponse', () => {
    it('should return true for objects with id and title', () => {
      const response = { id: 1, title: 'Test Issue' };

      expect(isProviderAPIResponse(response)).toBe(true);
    });

    it('should return true for objects with number and name', () => {
      const response = { number: 42, name: 'Test Item' };

      expect(isProviderAPIResponse(response)).toBe(true);
    });

    it('should return true for objects with iid and summary', () => {
      const response = { iid: 5, summary: 'Test Summary' };

      expect(isProviderAPIResponse(response)).toBe(true);
    });

    it('should return false for objects missing required properties', () => {
      const missingId = { title: 'Test' };
      const missingTitle = { id: 1 };

      expect(isProviderAPIResponse(missingId)).toBe(false);
      expect(isProviderAPIResponse(missingTitle)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isProviderAPIResponse(null)).toBe(false);
      expect(isProviderAPIResponse('string')).toBe(false);
      expect(isProviderAPIResponse(123)).toBe(false);
    });
  });

  describe('hasTextContent', () => {
    it('should return true for MCP result with text content', () => {
      const textContent = {
        content: [{ type: 'text', text: 'Hello world' }],
      };

      expect(hasTextContent(textContent)).toBe(true);
    });

    it('should return false for MCP result without text content', () => {
      const noTextContent = {
        content: [{ type: 'image', url: 'test.png' }],
      };

      expect(hasTextContent(noTextContent)).toBe(false);
    });

    it('should return false for empty content array', () => {
      const emptyContent = { content: [] };

      expect(hasTextContent(emptyContent)).toBe(false);
    });

    it('should return false for non-MCP result', () => {
      expect(hasTextContent({ notContent: 'test' })).toBe(false);
      expect(hasTextContent('string')).toBe(false);
    });
  });

  describe('isStringOrHasProperty', () => {
    it('should return true for string values', () => {
      expect(isStringOrHasProperty('test string', 'name')).toBe(true);
    });

    it('should return true for objects with the specified property as string', () => {
      const obj = { name: 'test name' };

      expect(isStringOrHasProperty(obj, 'name')).toBe(true);
    });

    it('should return false for objects with non-string property', () => {
      const obj = { name: 123 };

      expect(isStringOrHasProperty(obj, 'name')).toBe(false);
    });

    it('should return false for objects without the property', () => {
      const obj = { title: 'test' };

      expect(isStringOrHasProperty(obj, 'name')).toBe(false);
    });

    it('should return false for null or non-object values', () => {
      expect(isStringOrHasProperty(null, 'name')).toBe(false);
      expect(isStringOrHasProperty(123, 'name')).toBe(false);
      expect(isStringOrHasProperty(true, 'name')).toBe(false);
    });
  });

  describe('isArrayOfItems', () => {
    const isString = (value: unknown): value is string => typeof value === 'string';

    it('should return true for array where all items pass guard', () => {
      const stringArray = ['a', 'b', 'c'];

      expect(isArrayOfItems(stringArray, isString)).toBe(true);
    });

    it('should return false for array where some items fail guard', () => {
      const mixedArray = ['a', 'b', 123];

      expect(isArrayOfItems(mixedArray, isString)).toBe(false);
    });

    it('should return true for empty array', () => {
      expect(isArrayOfItems([], isString)).toBe(true);
    });

    it('should return false for non-array values', () => {
      expect(isArrayOfItems('string', isString)).toBe(false);
      expect(isArrayOfItems({ 0: 'a', 1: 'b' }, isString)).toBe(false);
      expect(isArrayOfItems(null, isString)).toBe(false);
    });
  });

  describe('isLabelLike', () => {
    it('should return true for string values', () => {
      expect(isLabelLike('label string')).toBe(true);
    });

    it('should return true for objects with name property', () => {
      const labelWithName = { name: 'bug' };

      expect(isLabelLike(labelWithName)).toBe(true);
    });

    it('should return true for objects with title property', () => {
      const labelWithTitle = { title: 'enhancement' };

      expect(isLabelLike(labelWithTitle)).toBe(true);
    });

    it('should return false for objects without name or title', () => {
      const invalidLabel = { description: 'test' };

      expect(isLabelLike(invalidLabel)).toBe(false);
    });

    it('should return false for objects with non-string name/title', () => {
      const nonStringName = { name: 123 };
      const nonStringTitle = { title: true };

      expect(isLabelLike(nonStringName)).toBe(false);
      expect(isLabelLike(nonStringTitle)).toBe(false);
    });

    it('should return false for null or non-object values', () => {
      expect(isLabelLike(null)).toBe(false);
      expect(isLabelLike(123)).toBe(false);
      expect(isLabelLike(true)).toBe(false);
    });
  });

  describe('isGitLabIssue', () => {
    it('should return true for valid GitLab issue', () => {
      const issue = {
        id: 1,
        iid: 5,
        title: 'Test Issue',
        description: 'Test description',
        state: 'open',
        assignees: [],
        labels: [],
      };

      expect(isGitLabIssue(issue)).toBe(true);
    });

    it('should return true for minimal valid GitLab issue', () => {
      const minimalIssue = {
        id: 1,
        iid: 5,
        title: 'Test Issue',
      };

      expect(isGitLabIssue(minimalIssue)).toBe(true);
    });

    it('should return false for issue missing required properties', () => {
      const missingId = { iid: 5, title: 'Test' };
      const missingIid = { id: 1, title: 'Test' };
      const missingTitle = { id: 1, iid: 5 };

      expect(isGitLabIssue(missingId)).toBe(false);
      expect(isGitLabIssue(missingIid)).toBe(false);
      expect(isGitLabIssue(missingTitle)).toBe(false);
    });

    it('should return false for non-object values', () => {
      expect(isGitLabIssue(null)).toBe(false);
      expect(isGitLabIssue('string')).toBe(false);
    });
  });

  describe('isGitLabEpic', () => {
    it('should return true for valid GitLab epic', () => {
      const epic = {
        id: 1,
        title: 'Test Epic',
        description: 'Epic description',
        state: 'open',
      };

      expect(isGitLabEpic(epic)).toBe(true);
    });

    it('should return true for minimal valid GitLab epic', () => {
      const minimalEpic = {
        id: 1,
        title: 'Test Epic',
      };

      expect(isGitLabEpic(minimalEpic)).toBe(true);
    });

    it('should return false for epic missing required properties', () => {
      const missingId = { title: 'Test Epic' };
      const missingTitle = { id: 1 };

      expect(isGitLabEpic(missingId)).toBe(false);
      expect(isGitLabEpic(missingTitle)).toBe(false);
    });
  });

  describe('isGitHubIssue', () => {
    it('should return true for valid GitHub issue', () => {
      const issue = {
        id: 1,
        number: 42,
        title: 'Test Issue',
        body: 'Issue body',
        state: 'open',
        assignees: [],
        labels: [],
      };

      expect(isGitHubIssue(issue)).toBe(true);
    });

    it('should return true for minimal valid GitHub issue', () => {
      const minimalIssue = {
        id: 1,
        number: 42,
        title: 'Test Issue',
      };

      expect(isGitHubIssue(minimalIssue)).toBe(true);
    });

    it('should return false for issue missing required properties', () => {
      const missingId = { number: 42, title: 'Test' };
      const missingNumber = { id: 1, title: 'Test' };
      const missingTitle = { id: 1, number: 42 };

      expect(isGitHubIssue(missingId)).toBe(false);
      expect(isGitHubIssue(missingNumber)).toBe(false);
      expect(isGitHubIssue(missingTitle)).toBe(false);
    });
  });

  describe('isAzureWorkItem', () => {
    it('should return true for valid Azure work item', () => {
      const workItem = {
        id: 1,
        fields: {
          'System.Title': 'Test Work Item',
          'System.State': 'New',
        },
      };

      expect(isAzureWorkItem(workItem)).toBe(true);
    });

    it('should return false for work item missing id', () => {
      const missingId = {
        fields: { 'System.Title': 'Test' },
      };

      expect(isAzureWorkItem(missingId)).toBe(false);
    });

    it('should return false for work item missing fields', () => {
      const missingFields = { id: 1 };

      expect(isAzureWorkItem(missingFields)).toBe(false);
    });

    it('should return false for work item with non-object fields', () => {
      const invalidFields = {
        id: 1,
        fields: 'not an object',
      };

      expect(isAzureWorkItem(invalidFields)).toBe(false);
    });
  });

  describe('isAPIResponse', () => {
    it('should return true for any object', () => {
      const obj = { key: 'value' };

      expect(isAPIResponse(obj)).toBe(true);
    });

    it('should return true for empty object', () => {
      expect(isAPIResponse({})).toBe(true);
    });

    it('should return false for null', () => {
      expect(isAPIResponse(null)).toBe(false);
    });

    it('should return false for primitive values', () => {
      expect(isAPIResponse('string')).toBe(false);
      expect(isAPIResponse(123)).toBe(false);
      expect(isAPIResponse(true)).toBe(false);
      expect(isAPIResponse(undefined)).toBe(false);
    });
  });
});
