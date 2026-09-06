/**
 * ONB-014/BUS-024 (Section 6.1a). Covers the checksum validation (pure, no network),
 * the "degrades gracefully when unconfigured" path (no ABR_ABN_LOOKUP_GUID is set in
 * this test environment — that absence is itself the thing being tested, not a gap),
 * and the found/not_found/error paths against a mocked fetch so the suite doesn't
 * depend on a real network call or a real GUID to run.
 */
import { isValidAbnChecksum, lookupAbn } from '../../src/modules/businesses/providers/abn-lookup.provider';

describe('ABN checksum validation', () => {
  it('accepts a known-valid ABN regardless of formatting', () => {
    expect(isValidAbnChecksum('51824753556')).toBe(true);
    expect(isValidAbnChecksum('51 824 753 556')).toBe(true);
  });

  it('rejects an ABN that fails the mod-89 checksum', () => {
    expect(isValidAbnChecksum('12345678901')).toBe(false);
  });

  it('rejects anything that is not 11 digits', () => {
    expect(isValidAbnChecksum('123')).toBe(false);
    expect(isValidAbnChecksum('abcdefghijk')).toBe(false);
  });
});

describe('lookupAbn', () => {
  it('short-circuits on an invalid checksum without making a network call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const outcome = await lookupAbn('12345678901');
    expect(outcome).toEqual({ status: 'invalid_abn' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns not_configured when ABR_ABN_LOOKUP_GUID is unset (this test environment\'s actual state)', async () => {
    const outcome = await lookupAbn('51824753556');
    expect(outcome).toEqual({ status: 'not_configured' });
  });

  describe('with a GUID configured', () => {
    const ORIGINAL_ENV = process.env.ABR_ABN_LOOKUP_GUID;

    beforeAll(() => {
      process.env.ABR_ABN_LOOKUP_GUID = 'test-guid';
    });
    afterAll(() => {
      process.env.ABR_ABN_LOOKUP_GUID = ORIGINAL_ENV;
    });

    // env.ts reads process.env once at import time, so these tests reach into the
    // module's already-resolved env object directly rather than relying on
    // process.env being re-read — matches how env.ts is actually consumed elsewhere.
    beforeEach(() => {
      jest.resetModules();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function lookupWithGuid(rawAbn: string) {
      jest.doMock('../../src/config/env', () => ({
        env: { ...jest.requireActual('../../src/config/env').env, abrAbnLookup: { guid: 'test-guid' } },
      }));
      const { lookupAbn: lookupAbnFresh } = await import('../../src/modules/businesses/providers/abn-lookup.provider');
      return lookupAbnFresh(rawAbn);
    }

    it('parses a found response', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () =>
          `callback(${JSON.stringify({
            Abn: '51824753556',
            AbnStatus: 'Active',
            Acn: '824753556',
            EntityName: 'EXAMPLE PTY LTD',
            EntityTypeCode: 'PRV',
            EntityTypeName: 'Australian Private Company',
            BusinessName: ['Example Trading'],
            Gst: true,
            AddressState: 'NSW',
            AddressPostcode: '2000',
            Message: '',
          })});`,
      } as Response);

      const outcome = await lookupWithGuid('51824753556');
      expect(outcome.status).toBe('found');
      if (outcome.status === 'found') {
        expect(outcome.result.entityName).toBe('EXAMPLE PTY LTD');
        expect(outcome.result.gstRegistered).toBe(true);
        expect(outcome.result.businessNames).toEqual(['Example Trading']);
      }
    });

    it('maps a "no record found" Message to not_found', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => `callback(${JSON.stringify({ Message: 'No record found' })});`,
      } as Response);

      const outcome = await lookupWithGuid('51824753556');
      expect(outcome).toEqual({ status: 'not_found' });
    });

    it('maps an unrecognised-GUID Message to invalid_guid', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => `callback(${JSON.stringify({ Message: 'The GUID provided is not recognised' })});`,
      } as Response);

      const outcome = await lookupWithGuid('51824753556');
      expect(outcome).toEqual({ status: 'invalid_guid' });
    });

    it('treats a non-2xx response as an error, not a crash', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

      const outcome = await lookupWithGuid('51824753556');
      expect(outcome.status).toBe('error');
    });
  });
});
