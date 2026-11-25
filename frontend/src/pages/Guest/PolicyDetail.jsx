import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import PolicyAcceptancePrompt from '../../components/policies/PolicyAcceptancePrompt';
import PolicyContent from '../../components/policies/PolicyContent';
import {
  getPolicyBySlug,
  getPolicyVersion,
} from '../../services/policyService';

export default function PolicyDetail() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [versionData, setVersionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [versionError, setVersionError] = useState('');
  const [versionLoading, setVersionLoading] = useState(false);
  const [error, setError] = useState('');
  const [acceptOpen, setAcceptOpen] = useState(false);

  const user = useMemo(() => {
    const raw = sessionStorage.getItem('valo_user');
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    setVersionData(null);
    setVersionError('');
    getPolicyBySlug(slug)
      .then((res) => {
        if (res.ok && res.data?.success) {
          setData(res.data.data);
          setSelectedVersion(res.data.data.policy?.currentVersionNumber);
        } else {
          setError(res.data?.message || 'Policy not found.');
        }
      })
      .catch(() => setError('Unable to load policy.'))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!data || !selectedVersion) return undefined;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVersionError('');
    setVersionLoading(false);
    const currentVersion = data.policy?.currentVersion;
    if (Number(selectedVersion) === Number(data.policy?.currentVersionNumber)) {
      setVersionData(currentVersion);
      return undefined;
    }

    let cancelled = false;
    setVersionLoading(true);
    getPolicyVersion(slug, selectedVersion)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data?.success) {
          setVersionData(res.data.data.version);
        } else {
          setVersionError(res.data?.message || 'Unable to load version.');
        }
      })
      .catch(() => { if (!cancelled) setVersionError('Unable to load version.'); })
      .finally(() => {
        if (!cancelled) setVersionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data, selectedVersion, slug]);

  const policy = data?.policy;
  const isCurrentVersion = Number(selectedVersion) === Number(policy?.currentVersionNumber);
  const canAccept = user?.role === 'customer' && policy?.requiresAcceptance && isCurrentVersion;

  if (loading) {
    return (
      <div className="policy-page bg-stone-50 px-4 pb-8 pt-28">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 rounded-[20px] border border-gray-200 bg-white py-10 text-sm font-bold text-gray-500">
          <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />
          Loading policy
        </div>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="policy-page bg-stone-50 px-4 pb-8 pt-28">
        <div className="mx-auto max-w-3xl rounded-[20px] border border-red-200 bg-red-50 p-8 text-red-700">
          <Link to="/policies" className="mb-4 block underline">Back to policies</Link>
          {error || 'Policy not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="policy-page bg-stone-50 pb-4 pt-20">
      <div>

        {versionLoading ? (
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 rounded-[20px] border border-gray-200 bg-white py-10 text-sm font-bold text-gray-500">
            <Loader2 size={18} className="animate-spin motion-reduce:animate-none" />
            Loading version
          </div>
        ) : versionError ? (
          <div role="alert" className="rounded-[20px] border border-red-200 bg-white p-6 text-red-700">{versionError}</div>
        ) : (
          <PolicyContent policy={policy} version={versionData || policy.currentVersion} controls={
          <div className="flex flex-wrap items-center gap-3">
            {data.versions?.length > 1 && (
              <select
                aria-label="Policy version"
                value={selectedVersion || ''}
                onChange={(event) => setSelectedVersion(event.target.value)}
                className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {data.versions.map((version) => (
                  <option key={version.versionNumber} value={version.versionNumber}>
                    Version {version.versionNumber}
                  </option>
                ))}
              </select>
            )}
            {canAccept && (
              <button
                type="button"
                onClick={() => setAcceptOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-gold px-5 py-2.5 text-sm font-black text-charcoal min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold transition hover:bg-gold-light"
              >
                <CheckCircle2 size={16} />
                Accept latest version
              </button>
            )}
          </div>
          } />
        )}
      </div>

      <PolicyAcceptancePrompt
        open={acceptOpen}
        missingPolicies={[
          {
            policyId: policy._id,
            slug: policy.slug,
            title: policy.currentVersion?.title || policy.title,
            versionNumber: policy.currentVersionNumber,
          },
        ]}
        onClose={() => setAcceptOpen(false)}
        onAccepted={() => setAcceptOpen(false)}
      />
    </div>
  );
}
