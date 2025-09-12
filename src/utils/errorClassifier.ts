/**
 * Classifies errors to determine if provider should be reconnected
 */

export type ErrorType = 'auth' | 'network' | 'config' | 'unknown';

export interface ErrorClassification {
  type: ErrorType;
  shouldReconnect: boolean;
  message: string;
}

/**
 * Classify error and determine if reconnection should be attempted
 */
export function classifyError(error: unknown): ErrorClassification {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Authentication/Authorization errors - do not reconnect
  if (lowerMessage.includes('unauthorized') || 
      lowerMessage.includes('401') ||
      lowerMessage.includes('forbidden') ||
      lowerMessage.includes('403') ||
      lowerMessage.includes('invalid token') ||
      lowerMessage.includes('authentication failed') ||
      lowerMessage.includes('access denied') ||
      lowerMessage.includes('bad credentials') ||
      lowerMessage.includes('token expired')) {
    return {
      type: 'auth',
      shouldReconnect: false,
      message: `Authentication failed: ${errorMessage}`
    };
  }

  // Network/Connection errors - can reconnect
  if (lowerMessage.includes('connection') ||
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('network') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('socket') ||
      lowerMessage.includes('dns') ||
      lowerMessage.includes('502') ||
      lowerMessage.includes('503') ||
      lowerMessage.includes('504')) {
    return {
      type: 'network',
      shouldReconnect: true,
      message: `Network error: ${errorMessage}`
    };
  }

  // Configuration errors - do not reconnect
  if (lowerMessage.includes('not found') && lowerMessage.includes('404') ||
      lowerMessage.includes('invalid configuration') ||
      lowerMessage.includes('missing parameter') ||
      lowerMessage.includes('organization') && lowerMessage.includes('not found')) {
    return {
      type: 'config',
      shouldReconnect: false,
      message: `Configuration error: ${errorMessage}`
    };
  }

  // Unknown errors - can try to reconnect
  return {
    type: 'unknown',
    shouldReconnect: true,
    message: `Unknown error: ${errorMessage}`
  };
}

/**
 * Check if provider should be reconnected based on error count and time
 */
export function shouldAttemptReconnection(
  reconnectAttempts: number = 0,
  lastReconnectTime?: Date,
  maxAttempts: number = 3,
  cooldownMs: number = 30000 // 30 seconds
): boolean {
  // Too many attempts
  if (reconnectAttempts >= maxAttempts) {
    return false;
  }

  // Need to wait for cooldown period
  if (lastReconnectTime) {
    const timeSinceLastAttempt = Date.now() - lastReconnectTime.getTime();
    if (timeSinceLastAttempt < cooldownMs) {
      return false;
    }
  }

  return true;
}