export const serviceLinkState = (response, serviceId) => {
  if ([401, 403].includes(response.status)) return { status: 'unavailable' };
  if (!response.ok || !response.data?.success || !Array.isArray(response.data.data)) return { status: 'error' };
  if (!/^[a-f\d]{24}$/i.test(serviceId || '')) return { status: 'missing' };
  const service = response.data.data.find(row => String(row._id).toLowerCase() === serviceId.toLowerCase());
  return service ? { status: 'ready', serviceId: String(service._id) } : { status: 'missing' };
};
export const includeLinkedService = (filtered, services, serviceId) => {
  if (!serviceId || filtered.some(row => String(row._id).toLowerCase() === serviceId.toLowerCase())) return filtered;
  const service = services.find(row => String(row._id).toLowerCase() === serviceId.toLowerCase());
  return service ? [...filtered, service] : filtered;
};
export const serviceRowPage = (rows, serviceId) => {
  const index = rows.findIndex(row => String(row._id).toLowerCase() === String(serviceId).toLowerCase());
  return index < 0 ? null : Math.floor(index / 10) + 1;
};
export const highlightServiceRow = row => {
  if (!row) return () => {};
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('service-ai-highlight');
  const timer = setTimeout(() => row.classList.remove('service-ai-highlight'), 4000);
  return () => { clearTimeout(timer); row.classList.remove('service-ai-highlight'); };
};
