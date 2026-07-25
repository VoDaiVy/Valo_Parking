export function getResponseAvailability(response, fallbackMessage) {
  const isAvailable = Boolean(response?.ok && response.data?.success);

  return {
    isAvailable,
    data: isAvailable ? response.data.data : null,
    error: isAvailable ? '' : (response?.data?.message || fallbackMessage),
  };
}

export function getRequiredSourcesAvailability(sources) {
  const unavailable = sources
    .map(({ name, response }) => ({
      name,
      state: getResponseAvailability(response, `${name} is unavailable.`),
    }))
    .filter(({ state }) => !state.isAvailable);

  return {
    isAvailable: unavailable.length === 0,
    error: unavailable.map(({ name, state }) => `${name}: ${state.error}`).join(' '),
    failedSources: unavailable.map(({ name }) => name),
  };
}

export function getOperationalViewState({ loading = false, error = '' } = {}) {
  const status = loading ? 'loading' : error ? 'unavailable' : 'live';

  return {
    status,
    isAvailable: status === 'live',
    error: status === 'unavailable' ? String(error) : '',
  };
}

export function getOperationalValue(viewState, value, unavailableValue = '—') {
  return viewState?.isAvailable ? value : unavailableValue;
}
