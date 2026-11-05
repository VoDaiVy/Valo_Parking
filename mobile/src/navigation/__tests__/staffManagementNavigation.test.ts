import { openStaffManagementHome } from '../staffManagementNavigation';

test('management tab cancels default stack popping before opening quick access', () => {
  let defaultPrevented = false;
  const event = { preventDefault: jest.fn(() => { defaultPrevented = true; }) };
  const navigate = jest.fn(() => { expect(defaultPrevented).toBe(true); });

  openStaffManagementHome(event, { navigate });

  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('Manage', { screen: 'ManagementHome', initial: false });
});

test('reselecting management always targets the hub and retains its initial route', () => {
  const navigate = jest.fn();
  const event = { preventDefault: jest.fn() };

  openStaffManagementHome(event, { navigate });
  openStaffManagementHome(event, { navigate });

  expect(navigate.mock.calls).toEqual([
    ['Manage', { screen: 'ManagementHome', initial: false }],
    ['Manage', { screen: 'ManagementHome', initial: false }],
  ]);
});
