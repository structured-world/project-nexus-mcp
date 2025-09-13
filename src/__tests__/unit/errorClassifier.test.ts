import { classifyError, shouldAttemptReconnection, ErrorType } from '../../utils/errorClassifier';

describe('errorClassifier', () => {
  describe('classifyError', () => {
    describe('authentication errors', () => {
      const authTestCases = [
        { message: 'Unauthorized access', expectedType: 'auth' as ErrorType },
        { message: 'HTTP 401 error', expectedType: 'auth' as ErrorType },
        { message: 'Access forbidden', expectedType: 'auth' as ErrorType },
        { message: 'HTTP 403 Forbidden', expectedType: 'auth' as ErrorType },
        { message: 'Invalid token provided', expectedType: 'auth' as ErrorType },
        { message: 'Authentication failed', expectedType: 'auth' as ErrorType },
        { message: 'Access denied to resource', expectedType: 'auth' as ErrorType },
        { message: 'Bad credentials', expectedType: 'auth' as ErrorType },
        { message: 'Token expired', expectedType: 'auth' as ErrorType },
      ];

      authTestCases.forEach(({ message, expectedType }) => {
        it(`should classify "${message}" as auth error`, () => {
          const result = classifyError(new Error(message));

          expect(result.type).toBe(expectedType);
          expect(result.shouldReconnect).toBe(false);
          expect(result.message).toBe(`Authentication failed: ${message}`);
        });
      });

      it('should handle case-insensitive auth error detection', () => {
        const result = classifyError(new Error('UNAUTHORIZED ACCESS'));

        expect(result.type).toBe('auth');
        expect(result.shouldReconnect).toBe(false);
      });
    });

    describe('network errors', () => {
      const networkTestCases = [
        { message: 'Connection reset by peer', expectedType: 'network' as ErrorType },
        { message: 'Request timeout', expectedType: 'network' as ErrorType },
        { message: 'Network error occurred', expectedType: 'network' as ErrorType },
        { message: 'ECONNREFUSED', expectedType: 'network' as ErrorType },
        { message: 'ENOTFOUND hostname', expectedType: 'network' as ErrorType },
        { message: 'Socket hang up', expectedType: 'network' as ErrorType },
        { message: 'DNS resolution failed', expectedType: 'network' as ErrorType },
        { message: 'HTTP 502 Bad Gateway', expectedType: 'network' as ErrorType },
        { message: 'HTTP 503 Service Unavailable', expectedType: 'network' as ErrorType },
        { message: 'HTTP 504 Gateway Timeout', expectedType: 'network' as ErrorType },
      ];

      networkTestCases.forEach(({ message, expectedType }) => {
        it(`should classify "${message}" as network error`, () => {
          const result = classifyError(new Error(message));

          expect(result.type).toBe(expectedType);
          expect(result.shouldReconnect).toBe(true);
          expect(result.message).toBe(`Network error: ${message}`);
        });
      });
    });

    describe('configuration errors', () => {
      const configTestCases = [
        { message: 'Resource not found (404)', expectedType: 'config' as ErrorType },
        { message: 'Invalid configuration provided', expectedType: 'config' as ErrorType },
        { message: 'Missing parameter in request', expectedType: 'config' as ErrorType },
        { message: 'Organization myorg not found', expectedType: 'config' as ErrorType },
      ];

      configTestCases.forEach(({ message, expectedType }) => {
        it(`should classify "${message}" as config error`, () => {
          const result = classifyError(new Error(message));

          expect(result.type).toBe(expectedType);
          expect(result.shouldReconnect).toBe(false);
          expect(result.message).toBe(`Configuration error: ${message}`);
        });
      });
    });

    describe('unknown errors', () => {
      it('should classify unrecognized errors as unknown', () => {
        const result = classifyError(new Error('Something unexpected happened'));

        expect(result.type).toBe('unknown');
        expect(result.shouldReconnect).toBe(true);
        expect(result.message).toBe('Unknown error: Something unexpected happened');
      });

      it('should handle non-Error objects', () => {
        const result = classifyError('String error message');

        expect(result.type).toBe('unknown');
        expect(result.shouldReconnect).toBe(true);
        expect(result.message).toBe('Unknown error: String error message');
      });

      it('should handle null/undefined errors', () => {
        const result = classifyError(null);

        expect(result.type).toBe('unknown');
        expect(result.shouldReconnect).toBe(true);
        expect(result.message).toBe('Unknown error: null');
      });
    });
  });

  describe('shouldAttemptReconnection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-01T12:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should allow reconnection with default parameters', () => {
      const result = shouldAttemptReconnection();

      expect(result).toBe(true);
    });

    it('should allow reconnection when attempts are below max', () => {
      const result = shouldAttemptReconnection(2, undefined, 3);

      expect(result).toBe(true);
    });

    it('should prevent reconnection when max attempts reached', () => {
      const result = shouldAttemptReconnection(3, undefined, 3);

      expect(result).toBe(false);
    });

    it('should prevent reconnection when max attempts exceeded', () => {
      const result = shouldAttemptReconnection(5, undefined, 3);

      expect(result).toBe(false);
    });

    it('should allow reconnection after cooldown period', () => {
      const oneMinuteAgo = new Date('2025-01-01T11:59:00Z'); // 1 minute ago
      const result = shouldAttemptReconnection(1, oneMinuteAgo, 3, 30000); // 30s cooldown

      expect(result).toBe(true);
    });

    it('should prevent reconnection during cooldown period', () => {
      const tenSecondsAgo = new Date('2025-01-01T11:59:50Z'); // 10 seconds ago
      const result = shouldAttemptReconnection(1, tenSecondsAgo, 3, 30000); // 30s cooldown

      expect(result).toBe(false);
    });

    it('should allow reconnection exactly at cooldown threshold', () => {
      const exactlyCooldownAgo = new Date('2025-01-01T11:59:30Z'); // exactly 30s ago
      const result = shouldAttemptReconnection(1, exactlyCooldownAgo, 3, 30000); // 30s cooldown

      expect(result).toBe(true);
    });

    it('should handle custom max attempts and cooldown', () => {
      const result = shouldAttemptReconnection(4, undefined, 5, 60000);

      expect(result).toBe(true);
    });

    it('should prevent reconnection when both max attempts and cooldown constraints fail', () => {
      const recentTime = new Date('2025-01-01T11:59:50Z'); // 10 seconds ago
      const result = shouldAttemptReconnection(3, recentTime, 3, 30000);

      expect(result).toBe(false);
    });

    it('should allow reconnection with zero attempts and no last reconnect time', () => {
      const result = shouldAttemptReconnection(0, undefined, 3, 30000);

      expect(result).toBe(true);
    });
  });
});
