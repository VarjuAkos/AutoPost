'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, LoaderCircle, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api, jsonRequest } from '@/lib/api';
import { assetUrl, type Asset, type Lens, type Post } from '@/lib/domain';

type Settings = { used: number; recorded?: number; reserved?: number; uncertain?: number; pending?: number; limit: number; configured: boolean; model: string };
type Props = { projectId: string; assets: Asset[]; selected: Set<string>; target?: Post; onClose: () => void; onApply: (posts: Post[], targetId?: string) => void; onFlush: () => Promise<void> };
export function CurationPanel({ projectId, assets, selected, target, onClose, onApply, onFlush }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lens, setLens] = useState<Lens>('Editorial story');
  const [count, setCount] = useState(3);
  const [brief, setBrief] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Post[]>([]);
  const [cachedIds, setCachedIds] = useState<string[] | null>(null);
  const stop = useRef(false);
  const activeRun = useRef<string | null>(null);
  const ids = [...new Set([...(target?.slides.map(s => s.assetId) || []), ...(selected.size ? [...selected] : assets.map(a => a.id))])].slice(0, 50);
  const cachedCount = ids.filter(id => cachedIds?.includes(id)).length;
  const remainingCount = ids.length - cachedCount;
  useEffect(() => {
    let mounted = true;
    Promise.all([api<Settings>('/api/settings'), api<{ ids: string[] }>(`/api/projects/${projectId}/analysis`)]).then(([status, cached]) => {
      if (mounted) { setSettings(status); setCachedIds(cached.ids); }
    }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, [projectId]);
  async function generate() {
    stop.current = false;
    setBusy(true);
    setError('');
    setProposals([]);
    const runId = activeRun.current ||= crypto.randomUUID();
    try {
      await onFlush();
      const cached = await api<{ ids: string[] }>(`/api/projects/${projectId}/analysis`);
      const completed = new Set(cached.ids);
      setCachedIds(cached.ids);
      const missing = ids.filter(id => !completed.has(id));
      for (let offset = 0; offset < missing.length; offset += 6) {
        if (stop.current) break;
        const batch = missing.slice(offset, offset + 6);
        setProgress(`Analyzing ${batch.length} photos · ${ids.filter(id => completed.has(id)).length} / ${ids.length} saved. One transient retry is allowed.`);
        await api(`/api/projects/${projectId}/analyze`, jsonRequest('POST', { assetIds: batch, consent: true, runId }));
        batch.forEach(id => completed.add(id));
        setCachedIds([...completed]);
      }
      if (!stop.current) {
        setProgress('Finding the connections. Composing your stories…');
        const result = await api<{ posts: Post[] }>(`/api/projects/${projectId}/curate`, jsonRequest('POST', { assetIds: ids, consent: true, lens, count: target ? 1 : count, brief, targetId: target?.id, runId }));
        setProposals(result.posts);
        setProgress('Ready for your eye. Nothing has been changed yet.');
      } else setProgress('Stopped. Completed analyses are cached for next time.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Curation failed. Your edits are unchanged.');
      setProgress('Paused. Saved analyses are kept; resume will skip them.');
    } finally {
      setBusy(false);
      api<Settings>('/api/settings').then(setSettings).catch(() => {});
      api<{ ids: string[] }>(`/api/projects/${projectId}/analysis`).then(cached => setCachedIds(cached.ids)).catch(() => {});
    }
  }
  return <div className="modal-backdrop curation-backdrop"><section className="dialog curation-dialog" role="dialog" aria-modal="true" aria-labelledby="curation-title"><button className="icon-button dialog-close" aria-label="Close AI curation" disabled={busy} onClick={onClose}><X size={20} /></button><div className="dialog-icon ai-icon"><Sparkles size={24} /></div><div className="eyebrow">A SECOND PAIR OF EYES</div><h2 id="curation-title">{target ? 'See this story differently.' : 'Find the stories within.'}</h2><p className="curation-intro">Not the “best” photographs. The photographs that belong together. You always have the final say.</p><div className="curation-scope"><div className="scope-photos">{ids.slice(0, 5).map(id => <img key={id} src={assetUrl(id)} alt="" />)}</div><div><strong>{ids.length} photographs</strong><span>{selected.size ? 'From your selection' : assets.length > 50 ? 'First 50 photos · select others in the library' : 'From this collection'}{target ? ' + current story' : ''}</span></div></div>
    {cachedIds && <div className="notice" aria-live="polite"><strong>{cachedCount} / {ids.length} photos analyzed and saved.</strong> {remainingCount ? `${remainingCount} remaining. Completed photos will not be sent again.` : 'All selected photos are cached. Ready to compose posts.'}</div>}
    {!proposals.length && <><span className="field-label">LOOK THROUGH A DIFFERENT LENS</span><div className="lens-options">{(['Editorial story', 'Color & mood', 'Chronology'] as Lens[]).map((l, i) => <button key={l} disabled={busy} className={lens === l ? 'active' : ''} onClick={() => setLens(l)}><span className="lens-number">0{i + 1}</span><div><strong>{l}</strong><span>{i === 0 ? 'Context, details, contrast. A visual rhythm.' : i === 1 ? 'Unexpected connections in color and feeling.' : 'Follow the moments as they unfolded.'}</span></div>{lens === l && <Check size={17} />}</button>)}</div><div className="curation-fields"><label className="field-label">{target ? 'REWORKING ONE POST' : 'NUMBER OF STORIES'}<select disabled={busy || Boolean(target)} value={target ? 1 : count} onChange={e => setCount(+e.target.value)}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? 'story' : 'stories'}</option>)}</select></label><label className="field-label">CREATIVE DIRECTION <span className="optional">OPTIONAL</span><textarea placeholder="Keep the quiet moments. Avoid repeating similar stage shots…" maxLength={800} value={brief} disabled={busy} onChange={e => setBrief(e.target.value)} /></label></div>{target && <div className="safety-note"><ShieldCheck size={17} /><span>{target.slides.filter(s => s.pinned).length} pinned positions are protected. Existing framing stays with pinned slides.</span></div>}<label className="consent-check"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>Send small, metadata-stripped image copies to Anthropic for this curation. I approve API usage up to $0.50 for this run, including at most one retry per request for temporary provider failures. Originals remain on my Mac.</span></label></>}
    {proposals.length > 0 && <div className="proposal-review">{proposals.map(p => <div key={p.id}><div className="proposal-thumbs">{p.slides.slice(0, 8).map(s => <img key={s.id} src={assetUrl(s.assetId)} alt="" />)}</div><h3>{p.title} <span>{p.slides.length} slides</span></h3><p>{p.rationale}</p></div>)}</div>}
    <div className="ai-budget"><span>HAIKU 4.5 · CACHED ANALYSIS</span><strong>{settings ? `$${settings.used.toFixed(3)} / $${settings.limit.toFixed(2)}` : 'Checking…'}</strong></div><p className="budget-note">{settings && <>Recorded token cost: ${(settings.recorded ?? settings.used).toFixed(3)} · Held reservations: ${(settings.reserved ?? 0).toFixed(3)}.<br /></>}Held reservations are not confirmed spending; they conservatively count toward this app’s allowance. This is not your Anthropic balance or invoice. Successful generations can incur costs even if a later batch fails.</p>
    {settings && !settings.configured && <div className="notice">AI isn’t connected yet. Set <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> and restart. Never paste your key into chat.</div>}
    {error && <div className="notice error" role="alert">{error}</div>}{progress && <div className="ai-progress" aria-live="polite">{busy ? <LoaderCircle size={16} className="spin" /> : error ? <X size={16} /> : <CheckCircle2 size={16} />}{progress}</div>}
    {busy ? <button className="button secondary full" onClick={() => { stop.current = true; setProgress('Stopping after the current request…'); }}>Stop after this request</button> : proposals.length ? <div className="proposal-actions"><button className="button secondary" onClick={() => { setProposals([]); setProgress(''); activeRun.current = null; setConsent(false); }}>Revisit direction</button><button className="button primary" onClick={() => onApply(proposals, target?.id)}>{target ? 'Replace with this proposal' : 'Add proposals to board'}<ArrowRight size={16} /></button></div> : <button className="button primary full" disabled={!consent || !ids.length || !settings?.configured} onClick={() => void generate()}><Sparkles size={16} />{error ? (remainingCount ? `Resume ${remainingCount} unfinished photo${remainingCount === 1 ? '' : 's'}` : 'Retry post generation') : target ? 'Reimagine this story' : 'Curate my photographs'}<ArrowRight size={16} /></button>}
  </section></div>;
}
