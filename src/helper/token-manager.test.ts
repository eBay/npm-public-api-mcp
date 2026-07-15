import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import * as tokenManager from './token-manager.js';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock logger to suppress logs during tests
vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('token-manager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset environment
    process.env = { ...originalEnv };
    process.env.EBAY_CLIENT_ID = 'test-client-id';
    process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
    process.env.EBAY_TOKEN_TYPE = 'application';
    process.env.EBAY_ENVIRONMENT = 'production';

    // Clear token state
    tokenManager.clearAccessToken();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  describe('initializeTokenManager', () => {
    it('should initialize in application mode by default', () => {
      tokenManager.initializeTokenManager();
      expect(tokenManager.getTokenMode()).toBe('application');
    });

    it('should initialize in user mode when EBAY_TOKEN_TYPE=user', () => {
      process.env.EBAY_TOKEN_TYPE = 'user';
      process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
      tokenManager.initializeTokenManager();
      expect(tokenManager.getTokenMode()).toBe('user');
    });

    it('should throw error when client credentials are missing', () => {
      delete process.env.EBAY_CLIENT_ID;
      expect(() => tokenManager.initializeTokenManager()).toThrow(/EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are required/);
    });

    it('should throw error when user mode missing refresh token', () => {
      process.env.EBAY_TOKEN_TYPE = 'user';
      delete process.env.EBAY_REFRESH_TOKEN;
      expect(() => tokenManager.initializeTokenManager()).toThrow(/EBAY_REFRESH_TOKEN is required/);
    });
  });

  describe('getAccessToken - application mode', () => {
    beforeEach(() => {
      tokenManager.initializeTokenManager();
    });

    it('should fetch new token when no token in memory', async () => {
      const mockResponse = {
        data: {
          access_token: 'new-token',
          expires_in: 7200,
        },
      };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const token = await tokenManager.getAccessToken();

      expect(token).toBe('new-token');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/identity/v1/oauth2/token'),
        expect.stringContaining('grant_type=client_credentials'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic'),
          }),
        })
      );
    });

    it('should return cached token when not expiring soon', async () => {
      const mockResponse = {
        data: {
          access_token: 'cached-token',
          expires_in: 7200,
        },
      };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const token1 = await tokenManager.getAccessToken();

      // Advance time by 1 hour (still valid, expires in 2 hours)
      vi.advanceTimersByTime(60 * 60 * 1000);

      const token2 = await tokenManager.getAccessToken();

      expect(token1).toBe('cached-token');
      expect(token2).toBe('cached-token');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should refresh token when expiring soon (within 5 minutes)', async () => {
      const mockResponse1 = {
        data: {
          access_token: 'first-token',
          expires_in: 7200,
        },
      };
      const mockResponse2 = {
        data: {
          access_token: 'refreshed-token',
          expires_in: 7200,
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const token1 = await tokenManager.getAccessToken();

      // Advance time to 4 minutes before expiry (triggers refresh)
      vi.advanceTimersByTime((7200 - 4 * 60) * 1000);

      const token2 = await tokenManager.getAccessToken();

      expect(token1).toBe('first-token');
      expect(token2).toBe('refreshed-token');
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should handle missing expires_in and default to 7200 seconds', async () => {
      const mockResponse = {
        data: {
          access_token: 'token-without-expiry',
        },
      };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const token = await tokenManager.getAccessToken();

      expect(token).toBe('token-without-expiry');
    });

    it('should throw error when access_token missing in response', async () => {
      const mockResponse = {
        data: {
          expires_in: 7200,
        },
      };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      await expect(tokenManager.getAccessToken()).rejects.toThrow(/did not contain access_token/);
    });
  });

  describe('getAccessToken - user mode', () => {
    beforeEach(() => {
      process.env.EBAY_TOKEN_TYPE = 'user';
      process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
      tokenManager.initializeTokenManager();
    });

    it('should fetch user token using refresh_token grant', async () => {
      const mockResponse = {
        data: {
          access_token: 'user-token',
          expires_in: 7200,
        },
      };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const token = await tokenManager.getAccessToken();

      expect(token).toBe('user-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/identity/v1/oauth2/token'),
        expect.stringContaining('grant_type=refresh_token'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Basic'),
          }),
        })
      );
    });
  });

  describe('refreshAccessToken - concurrent requests', () => {
    beforeEach(() => {
      tokenManager.initializeTokenManager();
    });

    it('should handle concurrent refresh requests with queue', async () => {
      const mockResponse = {
        data: {
          access_token: 'concurrent-token',
          expires_in: 7200,
        },
      };

      // Mock axios to delay response
      mockedAxios.post.mockImplementation(() =>
        new Promise(resolve => {
          setTimeout(() => resolve(mockResponse), 100);
        })
      );

      // Trigger 3 concurrent refresh requests
      const promise1 = tokenManager.refreshAccessToken();
      const promise2 = tokenManager.refreshAccessToken();
      const promise3 = tokenManager.refreshAccessToken();

      await vi.runAllTimersAsync();

      const [token1, token2, token3] = await Promise.all([promise1, promise2, promise3]);

      // All should get the same token
      expect(token1).toBe('concurrent-token');
      expect(token2).toBe('concurrent-token');
      expect(token3).toBe('concurrent-token');

      // But only one actual API call
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('should reject all queued requests on refresh failure', async () => {
      const mockError = new Error('Token API error');

      mockedAxios.post.mockRejectedValueOnce(mockError);

      const promise1 = tokenManager.refreshAccessToken();
      const promise2 = tokenManager.refreshAccessToken();
      const promise3 = tokenManager.refreshAccessToken();

      // Use Promise.allSettled to handle all rejections properly
      const results = await Promise.allSettled([promise1, promise2, promise3]);

      results.forEach(result => {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason.message).toMatch(/Token request failed|Token refresh failed/);
        }
      });
    });
  });

  describe('handle401Error', () => {
    beforeEach(() => {
      tokenManager.initializeTokenManager();
    });

    it('should clear token and fetch new one on 401', async () => {
      const mockResponse1 = {
        data: {
          access_token: 'original-token',
          expires_in: 7200,
        },
      };
      const mockResponse2 = {
        data: {
          access_token: 'new-token-after-401',
          expires_in: 7200,
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      // Get initial token
      const token1 = await tokenManager.getAccessToken();
      expect(token1).toBe('original-token');

      // Simulate 401 error
      const token2 = await tokenManager.handle401Error();

      expect(token2).toBe('new-token-after-401');
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearAccessToken', () => {
    beforeEach(() => {
      tokenManager.initializeTokenManager();
    });

    it('should clear cached token', async () => {
      const mockResponse1 = {
        data: {
          access_token: 'token-1',
          expires_in: 7200,
        },
      };
      const mockResponse2 = {
        data: {
          access_token: 'token-2',
          expires_in: 7200,
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const token1 = await tokenManager.getAccessToken();
      expect(token1).toBe('token-1');

      tokenManager.clearAccessToken();

      const token2 = await tokenManager.getAccessToken();
      expect(token2).toBe('token-2');
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      tokenManager.initializeTokenManager();
    });

    it('should handle axios error with response', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'invalid_grant' },
        },
        message: 'Request failed',
      };

      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await expect(tokenManager.getAccessToken()).rejects.toThrow(/Token request failed/);
    });

    it('should handle network error', async () => {
      const networkError = new Error('Network error');

      mockedAxios.post.mockRejectedValueOnce(networkError);

      await expect(tokenManager.getAccessToken()).rejects.toThrow(/Token request failed/);
    });
  });
});