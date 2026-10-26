import { getAiBookingRange } from '../aiBookingDraft';

describe('AI booking draft range', () => {
  it('interprets Vietnamese dates in UTC+7 independently of device timezone', () => {
    expect(
      getAiBookingRange({ startDate: '2030-01-01', startTime: '08:00', endTime: '09:00' }),
    ).toEqual({ startTime: '2030-01-01T01:00:00.000Z', endTime: '2030-01-01T02:00:00.000Z' });
  });
  it('accepts an overnight interval only with a later end date', () => {
    expect(
      getAiBookingRange({ startDate: '2030-01-01', startTime: '23:00', endTime: '01:00' }),
    ).toBeNull();
    expect(
      getAiBookingRange({
        startDate: '2030-01-01',
        endDate: '2030-01-02',
        startTime: '23:00',
        endTime: '01:00',
      }),
    ).not.toBeNull();
  });
  it('rejects incomplete drafts and invalid hours', () => {
    expect(getAiBookingRange({ startDate: '2030-01-01' })).toBeNull();
    expect(
      getAiBookingRange({ startDate: '2030-01-01', startTime: '25:00', endTime: '26:00' }),
    ).toBeNull();
  });
});
