import { translateMessage } from '../translate';
import vietnamese from '../vi.json';

describe('English / Vietnamese application copy', () => {
  test('switching back to English restores the source copy', () => {
    expect(translateMessage('vi', 'View profile')).toBe('Xem hồ sơ');
    expect(translateMessage('en', 'View profile')).toBe('View profile');
    expect(translateMessage('vi', 'Annual member')).toBe('Thành viên năm');
  });

  test('localizes profile descriptions and completed status', () => {
    expect(translateMessage('vi', 'Personal information')).toBe('Thông tin cá nhân');
    expect(translateMessage('vi', 'Manage vehicles')).toBe('Quản lý xe');
    expect(translateMessage('vi', 'COMPLETED')).toBe('Hoàn tất');
  });

  test('interpolates counters in both languages', () => {
    expect(translateMessage('vi', '{count} unread', { count: 3 })).toBe('3 chưa đọc');
    expect(translateMessage('en', '{count} unread', { count: 3 })).toBe('3 unread');
    expect(translateMessage('vi', 'Balance: {amount} VND', { amount: '1.250.000' }))
      .toBe('Số dư: 1.250.000 VND');
  });

  test('preserves unrecognized server content and user values', () => {
    for (const value of ['anhhung', 'hosyhung0704@gmail.com', '30A-12345', 'Custom server reply']) {
      expect(translateMessage('vi', value)).toBe(value);
    }
    expect(translateMessage('vi', 'Balance: {amount} VND', { amount: '{count}' }))
      .toBe('Số dư: {count} VND');
  });

  test('handles multiline JSX copy and inherited object keys safely', () => {
    expect(translateMessage('vi', '\n  View   profile\n')).toBe('Xem hồ sơ');
    expect(translateMessage('vi', 'constructor')).toBe('constructor');
    expect(translateMessage('en', '')).toBe('');
  });

  test('every translation preserves placeholders and has nonempty content', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
    for (const [source, translated] of Object.entries(vietnamese)) {
      expect(translated.trim()).not.toBe('');
      expect(translated).not.toMatch(/\?(?!$|[”"’'])/u);
      expect(placeholders(translated)).toEqual(placeholders(source));
    }
  });
});
