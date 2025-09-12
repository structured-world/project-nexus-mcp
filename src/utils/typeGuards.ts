import { MCPResult, ProviderAPIResponse } from '../types/index.js';

export function isMCPResult(value: unknown): value is MCPResult {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  if ('content' in obj) {
    if (!Array.isArray(obj.content)) return false;

    return obj.content.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const contentItem = item as Record<string, unknown>;
      return 'type' in contentItem && typeof contentItem.type === 'string';
    });
  }

  return true;
}

export function isProviderAPIResponse(value: unknown): value is ProviderAPIResponse {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  return (
    ('id' in obj || 'number' in obj || 'iid' in obj) &&
    ('title' in obj || 'name' in obj || 'summary' in obj)
  );
}

export function hasTextContent(value: unknown): value is { content: Array<{ text: string }> } {
  if (!isMCPResult(value) || !value.content) return false;

  return (
    value.content.length > 0 &&
    value.content[0] &&
    'text' in value.content[0] &&
    typeof value.content[0].text === 'string'
  );
}

export function isStringOrHasProperty<T extends string>(
  value: unknown,
  property: T,
): value is string | Record<T, string> {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;
  return property in obj && typeof obj[property] === 'string';
}

export function isArrayOfItems<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T,
): value is T[] {
  if (!Array.isArray(value)) return false;
  return value.every(itemGuard);
}

export function isLabelLike(
  value: unknown,
): value is string | { name: string } | { title: string } {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;
  return (
    ('name' in obj && typeof obj.name === 'string') ||
    ('title' in obj && typeof obj.title === 'string')
  );
}
