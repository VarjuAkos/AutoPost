'use client';

import { useEffect, useState } from 'react';
import { Copy, Link2, ShieldCheck, X } from 'lucide-react';
import { api } from '@/lib/api';

type Status = { paired: boolean; createdAt: string | null; lastUsedAt: string | null };
const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'never';

export function LightroomConnect({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<Status>('/api/integrations/lightroom/token').then(setStatus).catch(e => setError(e.message)); }, []);
  async function run(method: 'POST' | 'DELETE') {
    if (status?.paired && !window.confirm(method === 'POST' ? 'Generate a new token? The current Lightroom connection stops working until you paste the new one.' : 'Disconnect Lightroom? Publishing will stop until you pair again. Photos already here are kept.')) return;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      if (method === 'POST') setToken((await api<{ token: string }>('/api/integrations/lightroom/token', { method })).token);
      else { await api('/api/integrations/lightroom/token', { method }); setToken(''); }
      setStatus(await api<Status>('/api/integrations/lightroom/token'));
    } catch (e) { setError(e instanceof Error ? e.message : 'The request failed.'); }
    setBusy(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setError('Copy failed. Select the token and copy it manually.'); }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="dialog lightroom-dialog" role="dialog" aria-modal="true" aria-labelledby="lightroom-title">
      <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={onClose}><X size={19} /></button>
      <div className="dialog-icon"><Link2 size={25} /></div>
      <div className="eyebrow">LIGHTROOM CLASSIC</div>
      <h2 id="lightroom-title">Connect Lightroom.</h2>
      <p>Publish edited photos with their star ratings straight from Lightroom Classic. Each published collection becomes a collection here.</p>
      <div className="lightroom-status" aria-live="polite">{!status ? 'Checking…' : status.paired ? <><strong>Paired</strong> · created {when(status.createdAt)} · last used {when(status.lastUsedAt)}</> : <strong>Not paired</strong>}</div>
      {token && <div className="lightroom-token"><label className="field-label" htmlFor="lightroom-token">PAIRING TOKEN · SHOWN ONCE</label><div><input id="lightroom-token" readOnly value={token} onFocus={e => e.currentTarget.select()} /><button type="button" className="button secondary" onClick={() => void copy()}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</button></div><small>Paste it into the AutoPost publish service settings in Lightroom. It is stored here only as a hash.</small></div>}
      <div className="lightroom-actions"><button type="button" className="button primary" disabled={busy || !status} onClick={() => void run('POST')}>{status?.paired ? 'Generate new token' : 'Generate token'}</button>{status?.paired && <button type="button" className="text-button" disabled={busy} onClick={() => void run('DELETE')}>Disconnect</button>}</div>
      <ol className="lightroom-steps">
        <li>In Lightroom Classic: File → Plug-in Manager → Add, and choose <code>integrations/lightroom/AutoPost.lrdevplugin</code>.</li>
        <li>In the Library’s Publish Services panel, set up <strong>AutoPost</strong> and paste the token. Use Test connection.</li>
        <li>Create a published collection, drag photos in, and click Publish. Keep this app running.</li>
      </ol>
      <div className="safety-note"><ShieldCheck size={18} /><span>The plugin only reads from Lightroom and sends rendered copies. It never changes your catalog, edits, ratings, or photo files.</span></div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  </div>;
}
