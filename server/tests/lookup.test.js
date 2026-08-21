const request = require('supertest');
const app = require('../index');
const pool = require('../src/db/pool');
const apis = require('../src/services/apis');

// 1. Mock the external dependencies
jest.mock('../src/db/pool');
jest.mock('../src/services/apis');

describe('POST /api/lookup', () => {
  beforeEach(() => {
    // Clear mock history before each test
    jest.clearAllMocks();
  });

  it('should return 400 for invalid input format', async () => {
    const res = await request(app)
      .post('/api/lookup')
      .send({ query: 'not-an-ip', type: 'ip' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
    // Ensure the database was NEVER called
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('should return cached data if available (Cache Hit)', async () => {
    // Mock the database returning an existing record
    const mockDbResponse = {
      rows: [{
        id: 1,
        query: '8.8.8.8',
        query_type: 'ip',
        geo_data: { city: 'Mountain View' }
      }]
    };
    
    // First query is the SELECT check, second is the async INSERT into history
    pool.query.mockResolvedValueOnce(mockDbResponse).mockResolvedValueOnce({});

    const res = await request(app)
      .post('/api/lookup')
      .send({ query: '8.8.8.8', type: 'ip' });

    expect(res.statusCode).toBe(200);
    expect(res.body.geo_data.city).toBe('Mountain View');
    
    // Ensure we checked the cache
    expect(pool.query).toHaveBeenCalledTimes(2); 
    // Ensure external APIs were NOT called
    expect(apis.getGeo).not.toHaveBeenCalled();
  });

  it('should fetch external APIs and save to DB on Cache Miss', async () => {
    // Mock the DB SELECT returning empty (cache miss)
    pool.query.mockResolvedValueOnce({ rows: [] });
    
    // Mock the DB INSERT returning the new saved row
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 2,
        query: '1.1.1.1',
        query_type: 'ip',
        geo_data: { city: 'Brisbane' }
      }]
    });

    // Mock the async INSERT into search_history
    pool.query.mockResolvedValueOnce({});

    // Mock the external API responses
    apis.getGeo.mockResolvedValue({ city: 'Brisbane' });
    apis.getShodan.mockResolvedValue({ ports: [80, 443] });

    const res = await request(app)
      .post('/api/lookup')
      .send({ query: '1.1.1.1', type: 'ip' });

    expect(res.statusCode).toBe(200);
    expect(res.body.geo_data.city).toBe('Brisbane');
    
    // Ensure external APIs were called
    expect(apis.getGeo).toHaveBeenCalledWith('1.1.1.1');
    expect(apis.getShodan).toHaveBeenCalledWith('1.1.1.1');
    
    // Ensure DB was queried 3 times: SELECT cache, INSERT cache, INSERT history
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});