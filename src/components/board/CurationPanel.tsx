'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, LoaderCircle, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api, jsonRequest } from '@/lib/api';
import { CURATION_LIMITS, assetUrl, type Asset, type Lens, type Post } from '@/lib/domain';

type Settings = { used: number; recorded?: number; reserved?: number; uncertain?: number; pending?: number; limit: number; configured: boolean; model: string };
type Props = { projectId: string; assets: Asset[]; selected: Set<string>; target?: Post; onClose: () => void; onApply: (posts: Post[], targetId?: string) => void; onFlush: () => Promise<void> };
export function CurationPanel({ projectId, assets, selected, target, onClose, onApply, onFlush }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scope, setScope] = useState<'all' | 'selection'>(selected.size ? 'selection' : 'all');
  const [lens, setLens] = useState<Lens>('Editorial story');
  const [count, setCount] = useState<number | null>(target ? 1 : null);
  const [minSlides, setMinSlides] = useState(Math.min(3, Math.max(1, selected.size || assets.length)));
  const [maxSlides, setMaxSlides] = useState(Math.max(8, target?.slides.length || 0));
  const [budgetUsd, setBudgetUsd] = useState(0.5);
  const [brief, setBrief] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Post[]>([]);
  const [summary, setSummary] = useState<{ considered: number; used: number } | null>(null);
  const [cachedIds, setCachedIds] = useState<string[] | null>(null);
  const [runScope, setRunScope] = useState<string[] | null>(null);
  const stop = useRef(false);
  const activeRun = useRef<string | null>(null);
  const scopeIds = [...new Set([...(target?.slides.map(s => s.assetId) || []), ...(scope === 'selection' ? [...selected] : assets.map(a => a.id))])];
  const ids = runScope ?? scopeIds;
  const cachedCount = ids.filter(id => cachedIds?.includes(id)).length;
  const remainingCount = ids.length - cachedCount;
  const validation = ids.length > CURATION_LIMITS.photos ? `This run supports up to ${CURATION_LIMITS.photos} photos. Choose a smaller explicit selection; nothing will be silently truncated.`
    : !ids.length ? 'Choose at least one photo.'
      : !Number.isInteger(minSlides) || !Number.isInteger(maxSlides) || minSlides < 1 || maxSlides > 20 || minSlides > maxSlides ? 'Choose a photos-per-post range between 1 and 20.'
        : target?.slides.some((slide, index) => slide.pinned && index >= maxSlides) ? 'Increase the maximum photos per post to preserve every pinned position.'
          : ids.length < (target ? 1 : count ?? 1) * minSlides ? 'Not enough photos for that post count and minimum size. Reduce the count or minimum.'
          : !Number.isFinite(budgetUsd) || budgetUsd < 0.05 || budgetUsd > CURATION_LIMITS.maxRunUsd ? 'Choose a run allowance between $0.05 and $20.'
            : settings && budgetUsd > settings.limit ? 'This run allowance exceeds your total app allowance. Reduce it or adjust AUTOPOST_AI_LIMIT_USD locally.' : '';

  useEffect(() => {
    let mounted = true;
    Promise.all([api<Settings>('/api/settings'), api<{ ids: string[] }>(`/api/projects/${projectId}/analysis`)]).then(([status, cached]) => {
      if (mounted) { setSettings(status); setCachedIds(cached.ids); }
    }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, [projectId]);

  function resetRun() {
    activeRun.current = null;
    setRunScope(null);
    setConsent(false);
    setProposals([]);
    setSummary(null);
    setError('');
    setProgress('');
  }
  async function generate() {
    if (busy || !consent || validation) return;
    stop.current = false;
    setBusy(true);
    setError('');
    setProposals([]);
    setSummary(null);
    setRunScope(ids);
    const runId = activeRun.current ||= crypto.randomUUID();
    try {
      await onFlush();
      const cached = await api<{ ids: string[] }>(`/api/projects/${projectId}/analysis`);
      const completed = new Set(cached.ids);
      setCachedIds(cached.ids);
      const missing = ids.filter(id => !completed.has(id));
      for (let offset = 0; offset < missing.length; offset += CURATION_LIMITS.analysisBatch) {
        if (stop.current) break;
        const batch = missing.slice(offset, offset + CURATION_LIMITS.analysisBatch);
        setProgress(`Analyzing batch ${Math.floor(offset / CURATION_LIMITS.analysisBatch) + 1} / ${Math.ceil(missing.length / CURATION_LIMITS.analysisBatch)} · ${ids.filter(id => completed.has(id)).length} / ${ids.length} saved. One transient retry is allowed.`);
        await api(`/api/projects/${projectId}/analyze`, jsonRequest('POST', { assetIds: batch, consent: true, runId, budgetUsd }));
        batch.forEach(id => completed.add(id));
        setCachedIds([...completed]);
      }
      if (!stop.current) {
        setProgress(`Sonnet is finding highlights across all ${ids.length} saved descriptions. Composing distinct stories…`);
        const result = await api<{ posts: Post[]; consideredCount?: number; selectedCount?: number }>(`/api/projects/${projectId}/curate`, jsonRequest('POST', { assetIds: ids, consent: true, lens, count: target ? 1 : count, minSlides, maxSlides, brief, targetId: target?.id, runId, budgetUsd }));
        setProposals(result.posts);
        setSummary({ considered: result.consideredCount ?? ids.length, used: result.selectedCount ?? new Set(result.posts.flatMap(p => p.slides.map(s => s.assetId))).size });
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

  return <div className="modal-backdrop curation-backdrop"><section className="dialog curation-dialog" role="dialog" aria-modal="true" aria-labelledby="curation-title">
    <button className="icon-button dialog-close" aria-label="Close AI curation" disabled={busy} onClick={onClose}><X size={20} /></button>
    <div className="dialog-icon ai-icon"><Sparkles size={24} /></div>
    <div className="eyebrow">A SECOND PAIR OF EYES</div>
    <h2 id="curation-title">{target ? 'See this story differently.' : 'Find the stories within.'}</h2>
    <p className="curation-intro">Consider the whole collection. Keep the strongest connections, not every photograph. You always have the final say.</p>
    <div className="curation-scope"><div className="scope-photos">{ids.slice(0, 5).map(id => <img key={id} src={assetUrl(id)} alt="" />)}</div><div><strong>{ids.length} photographs considered</strong><span>{scope === 'selection' ? 'Your explicit selection' : 'Whole collection'}{target ? ' + current story' : ''} · Highlights first</span></div></div>
    {cachedIds && <div className="notice" aria-live="polite"><strong>{cachedCount} / {ids.length} photos analyzed and saved.</strong> {remainingCount ? `${remainingCount} remaining. Completed photos will not be sent again.` : 'All selected photos are cached. Ready to compose posts.'}</div>}
    {!proposals.length && <>
      <label className="field-label">PHOTOS TO CONSIDER<select className="curation-select" aria-label="Photos to consider" disabled={busy} value={scope} onChange={e => { resetRun(); setScope(e.target.value as 'all' | 'selection'); }}><option value="all">Whole collection ({assets.length})</option><option value="selection" disabled={!selected.size}>Selected photos ({selected.size})</option></select></label>
      <span className="field-label">LOOK THROUGH A DIFFERENT LENS</span>
      <div className="lens-options">{(['Editorial story', 'Color & mood', 'Chronology'] as Lens[]).map((l, i) => <button key={l} disabled={busy} className={lens === l ? 'active' : ''} onClick={() => { resetRun(); setLens(l); }}><span className="lens-number">0{i + 1}</span><div><strong>{l}</strong><span>{i === 0 ? 'Context, details, contrast. A visual rhythm.' : i === 1 ? 'Unexpected connections in color and feeling.' : 'Follow the moments as they unfolded.'}</span></div>{lens === l && <Check size={17} />}</button>)}</div>
      <div className="curation-fields">
        <label className="field-label">{target ? 'REWORKING ONE POST' : 'NUMBER OF STORIES'}<select aria-label="Number of stories" disabled={busy || Boolean(target)} value={count ?? 'auto'} onChange={e => { resetRun(); setCount(e.target.value === 'auto' ? null : Number(e.target.value)); }}><option value="auto">Auto — strongest stories (up to 20)</option>{Array.from({ length: CURATION_LIMITS.posts }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} {n === 1 ? 'story' : 'stories'}</option>)}</select></label>
        <div className="curation-range"><label className="field-label">MIN PHOTOS / POST<input type="number" aria-label="Minimum photos per post" min={1} max={20} value={minSlides} disabled={busy} onChange={e => { resetRun(); setMinSlides(Number(e.target.value)); }} /></label><label className="field-label">MAX PHOTOS / POST<input type="number" aria-label="Maximum photos per post" min={1} max={20} value={maxSlides} disabled={busy} onChange={e => { resetRun(); setMaxSlides(Number(e.target.value)); }} /></label></div>
        <p className="micro-explanation">Auto prefers fewer strong stories over filler. Manual requests an exact count. Similar moments should compete for a place, not fill every slide. Unused photos stay in your library.</p>
        <label className="field-label">RUN ALLOWANCE (USD)<input type="number" aria-label="Run allowance in USD" min={0.05} max={Math.min(CURATION_LIMITS.maxRunUsd, settings?.limit ?? CURATION_LIMITS.maxRunUsd)} step={0.05} value={budgetUsd} disabled={busy} onChange={e => { resetRun(); setBudgetUsd(Number(e.target.value)); }} /></label>
        <p className="micro-explanation">This is a spending ceiling, not a price estimate. Larger collections may need a larger allowance. {settings && `Your total app allowance has $${Math.max(0, settings.limit - settings.used).toFixed(3)} remaining.`} Changing settings starts a new run and requires consent again; cached analyses are retained.</p>
        <label className="field-label">CREATIVE DIRECTION <span className="optional">OPTIONAL</span><textarea placeholder="Favor quiet street moments and unusual details. Avoid repetitive skyline views…" maxLength={800} value={brief} disabled={busy} onChange={e => { resetRun(); setBrief(e.target.value); }} /></label>
      </div>
      {target && <div className="safety-note"><ShieldCheck size={17} /><span>{target.slides.filter(s => s.pinned).length} pinned positions are protected. Existing framing stays with pinned slides.</span></div>}
      {validation && <div className="notice error" role="alert">{validation}</div>}
      <label className="consent-check"><input type="checkbox" checked={consent} disabled={busy || Boolean(validation)} onChange={e => setConsent(e.target.checked)} /><span>Use Anthropic Haiku 4.5 to analyze small, metadata-stripped image copies and Sonnet 4.6 to compose posts from saved descriptions and my creative direction. Cached photos will not be analyzed again. I approve API usage up to ${Number.isFinite(budgetUsd) ? budgetUsd.toFixed(2) : '0.00'} for this run, including at most one retry per request for temporary provider failures. Originals remain on my Mac.</span></label>
    </>}
    {summary && <div className="notice"><strong>{summary.considered} considered · {summary.used} chosen · {summary.considered - summary.used} left in the library.</strong> These are highlights, not a requirement to use every photograph.</div>}
    {proposals.length > 0 && <div className="proposal-review">{proposals.map(p => <div key={p.id}><div className="proposal-thumbs">{p.slides.slice(0, 8).map(s => <img key={s.id} src={assetUrl(s.assetId)} alt="" />)}</div><h3>{p.title} <span>{p.slides.length} slides</span></h3><p>{p.rationale}</p></div>)}</div>}
    <div className="ai-budget"><span>HAIKU 4.5 ANALYSIS · SONNET 4.6 STORIES</span><strong>{settings ? `$${settings.used.toFixed(3)} / $${settings.limit.toFixed(2)}` : 'Checking…'}</strong></div>
    <p className="budget-note">{settings && <>Recorded token cost: ${(settings.recorded ?? settings.used).toFixed(3)} · Held reservations: ${(settings.reserved ?? 0).toFixed(3)}.<br /></>}Held reservations are not confirmed spending; they conservatively count toward this app’s allowance. This is not your Anthropic balance or invoice. Successful generations can incur costs even if a later batch fails.</p>
    {settings && !settings.configured && <div className="notice">AI isn’t connected yet. Set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> or <code>.env.local</code> and restart. Never paste your key into chat.</div>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {progress && <div className="ai-progress" aria-live="polite">{busy ? <LoaderCircle size={16} className="spin" /> : error ? <X size={16} /> : <CheckCircle2 size={16} />}{progress}</div>}
    {busy ? <button className="button secondary full" onClick={() => { stop.current = true; setProgress('Stopping after the current request…'); }}>Stop after this request</button> : proposals.length ? <div className="proposal-actions"><button className="button secondary" onClick={resetRun}>Revisit direction</button><button className="button primary" onClick={() => onApply(proposals, target?.id)}>{target ? 'Replace with this proposal' : 'Add proposals to board'}<ArrowRight size={16} /></button></div> : <button className="button primary full" disabled={!consent || !ids.length || !settings?.configured || Boolean(validation)} onClick={() => void generate()}><Sparkles size={16} />{error ? (remainingCount ? `Resume ${remainingCount} unfinished photo${remainingCount === 1 ? '' : 's'}` : 'Retry post generation') : target ? 'Reimagine this story' : 'Curate my photographs'}<ArrowRight size={16} /></button>}
  </section></div>;
}
