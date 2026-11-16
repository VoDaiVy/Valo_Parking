import { useState } from 'react';
import { Link } from 'react-router-dom';
import { searchAICustomers } from '../services/aiCopilotService';

export default function StaffCustomerCards({ result, onNavigate }) {
  const [page, setPage] = useState(result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changePage = async number => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await searchAICustomers({ ...page.filters, limit: page.limit, sortBy: page.sortBy, sortOrder: page.sortOrder, page: number });
      if (!response.ok || !response.data?.success) throw new Error('Unable to load customers. Please try again.');
      setPage(response.data.data);
    } catch { setError('Unable to load customers. Please try again.'); }
    finally { setBusy(false); }
  };
  const items = (page.items || []).filter(customer => customer.role === 'customer');
  return <div className="admin-ai-results" aria-label="Customer results" aria-busy={busy}>
    <p className="admin-ai-account-count">{page.total} {page.total === 1 ? 'customer' : 'customers'} found</p>
    {items.map(customer => <div className="admin-ai-result-row" key={customer._id}>
      <div className="admin-ai-result-heading"><strong>{[customer.profile?.firstName, customer.profile?.lastName].filter(Boolean).join(' ') || customer.username || customer.email}</strong>
        {/^[a-f\d]{24}$/i.test(String(customer._id)) && <Link className="admin-ai-entity-link" to={`/staff/accounts?userId=${customer._id}`} onClick={onNavigate}>View Customer</Link>}</div>
      <p className="admin-ai-result-subtitle">{customer.email}</p>
      {customer.profile?.phone && <p className="admin-ai-result-subtitle">{customer.profile.phone}</p>}
      <p className="admin-ai-result-subtitle">Status: {customer.status === true ? 'Active' : customer.status === false ? 'Blocked' : 'Unavailable'}</p>
    </div>)}
    {page.pages > 1 && <nav aria-label="Customer result pages" className="admin-ai-entity-actions">
      <button type="button" className="admin-ai-entity-link" disabled={busy || page.page <= 1} onClick={() => changePage(page.page - 1)}>Previous</button>
      <span>Page {page.page} of {page.pages}</span>
      <button type="button" className="admin-ai-entity-link" disabled={busy || page.page >= page.pages} onClick={() => changePage(page.page + 1)}>Next</button>
    </nav>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
