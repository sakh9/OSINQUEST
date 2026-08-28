// abuse.js does `require('node-fetch')` internally (unlike apis.js, which
// relies on Node's built-in global fetch) - mocking global.fetch has no
// effect on it. This needs to mock the node-fetch module itself, and must
// be registered before abuse.js is required so Jest's module registry
// substitution actually takes effect.
jest.mock('node-fetch', () => jest.fn());
const fetchMock = require('node-fetch');
const { getAbuse } = require('../src/services/abuse');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  fetchMock.mockReset();
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('getAbuse', () => {
  test('returns a skipped result when no API key is configured', async () => {
    delete process.env.ABUSEIPDB_KEY;
    const result = await getAbuse('8.8.8.8');
    expect(result).toEqual({ skipped: true, reason: 'ABUSEIPDB_KEY not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns parsed data on success when a key is configured', async () => {
    process.env.ABUSEIPDB_KEY = 'test-key';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          abuseConfidenceScore: 0,
          totalReports: 0,
          lastReportedAt: null,
          isTor: false,
          usageType: 'Content Delivery Network',
          domain: 'google.com',
        },
      }),
    });

    const result = await getAbuse('8.8.8.8');
    expect(result.abuseConfidenceScore).toBe(0);
    expect(result.usageType).toBe('Content Delivery Network');
    // Confirms the key is actually sent as a header, not silently dropped.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('8.8.8.8'),
      expect.objectContaining({ headers: expect.objectContaining({ Key: 'test-key' }) })
    );
  });

  test('throws on a non-ok response', async () => {
    process.env.ABUSEIPDB_KEY = 'test-key';
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(getAbuse('8.8.8.8')).rejects.toThrow(/status 429/);
  });
});