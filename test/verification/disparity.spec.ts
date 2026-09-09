/**
 * IDV-004, pure — no database. Same "factor the pure logic out, test without a
 * database" shape as brokers/businesses' computeOutstandingItems.
 */
import { computeDisparities } from '../../src/modules/verification/identity-verification.repository';

describe('computeDisparities (IDV-004)', () => {
  const brokerEntered = { firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1990-01-15' };

  it('finds no disparities when the provider payload matches (case/whitespace-insensitive)', () => {
    expect(
      computeDisparities(brokerEntered, { firstName: ' jane ', lastName: 'SMITH', dob: '1990-01-15' }),
    ).toHaveLength(0);
  });

  it('flags a mismatched first name', () => {
    const disparities = computeDisparities(brokerEntered, { firstName: 'Janet', lastName: 'Smith', dob: '1990-01-15' });
    expect(disparities).toEqual([{ field: 'firstName', brokerEntered: 'Jane', providerReturned: 'Janet' }]);
  });

  it('flags a mismatched date of birth', () => {
    const disparities = computeDisparities(brokerEntered, { firstName: 'Jane', lastName: 'Smith', dob: '1991-01-15' });
    expect(disparities).toEqual([{ field: 'dateOfBirth', brokerEntered: '1990-01-15', providerReturned: '1991-01-15' }]);
  });

  it('flags multiple mismatches at once', () => {
    const disparities = computeDisparities(brokerEntered, { firstName: 'Janet', lastName: 'Smyth', dob: '1990-01-15' });
    expect(disparities.map((d) => d.field)).toEqual(['firstName', 'lastName']);
  });

  it('ignores a field the provider payload never returned', () => {
    expect(computeDisparities(brokerEntered, {})).toHaveLength(0);
  });
});
