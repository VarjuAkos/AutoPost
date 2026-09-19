'use client';

import { useRef, useState } from 'react';
import { Upload, Plus, Check, X, Search, ImagePlus, RefreshCw, FolderInput } from 'lucide-react';
import { api } from '@/lib/api';
import { assetUrl, type Asset, type Post } from '@/lib/domain';

type QueueItem = { file: File; state: 'waiting' | 'working' | 'done' | 'duplicate' | 'error'; error?: string };
type Props = { projectId: string; assets: Asset[]; posts: Post[]; selected: Set<string>; sections: Record<string, string>; onSelect: (id: string) => void; onSelectAll: (ids: string[]) => void; onAsset: (asset: Asset) => void; onCreate: () => void; onSection: (label: string) => void };
export function PhotoLibrary({ projectId, assets, posts, selected, sections, onSelect, onSelectAll, onAsset, onCreate, onSection }: Props) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [section, setSection] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const cancel = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const used = new Set(posts.flatMap(p => p.slides.map(s => s.assetId)));
  const visible = assets.filter(a => (filter !== 'unused' || !used.has(a.id)) && (filter !== 'selected' || selected.has(a.id)) && `${a.filename} ${sections[a.id] || ''}`.toLowerCase().includes(search.toLowerCase()));
  async function process(items: QueueItem[]) {
    if (running) return;
    cancel.current = false;
    setRunning(true);
    const next = [...items];
    setQueue([...next]);
    for (let i = 0; i < next.length; i++) {
      if (cancel.current) break;
      if (next[i].state === 'done' || next[i].state === 'duplicate') continue;
      next[i] = { ...next[i], state: 'working', error: undefined };
      setQueue([...next]);
      try {
        if (next[i].file.size > 50 * 1024 * 1024) throw new Error('Larger than 50 MiB.');
        const result = await api<{ asset: Asset; duplicate: boolean }>(`/api/projects/${projectId}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(next[i].file.name) }, body: next[i].file });
        onAsset(result.asset);
        next[i] = { ...next[i], state: result.duplicate ? 'duplicate' : 'done' };
      } catch (e) { next[i] = { ...next[i], state: 'error', error: e instanceof Error ? e.message : 'Import failed.' }; }
      setQueue([...next]);
    }
    setRunning(false);
  }
  function importFiles(files: FileList | File[]) {
    const images = Array.from(files).filter(f => /\.(jpe?g|png)$/i.test(f.name));
    if (!images.length) { setQueue([{ file: new File([], 'No supported photos'), state: 'error', error: 'Choose JPEG or PNG files.' }]); return; }
    void process(images.map(file => ({ file, state: 'waiting' })));
  }
  const completed = queue.filter(q => ['done', 'duplicate'].includes(q.state)).length;
  return <aside className={`photo-library ${dragOver ? 'drop-active' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }} onDragLeave={() => setDragOver(false)} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragOver(false); if (!running) importFiles(e.dataTransfer.files); } }}>
    <div className="library-heading"><div><span className="eyebrow">SOURCE MATERIAL</span><h2>Photographs <span>{assets.length}</span></h2></div><button className="icon-button" title="Import photos" aria-label="Import photos" disabled={running} onClick={() => fileInput.current?.click()}><Plus size={19} /></button></div>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png" multiple hidden aria-label="Photo files" onChange={e => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
    <input ref={folderInput} type="file" multiple hidden aria-label="Photo folder" {...{ webkitdirectory: '', directory: '' }} onChange={e => { if (e.target.files) importFiles(e.target.files); e.target.value = ''; }} />
    <div className="library-tabs">{['all', 'unused', 'selected'].map(tab => <button key={tab} className={filter === tab ? 'active' : ''} onClick={() => setFilter(tab)}>{tab === 'all' ? 'All photos' : tab === 'unused' ? 'Unused' : 'Selected'}{tab === 'selected' && selected.size > 0 && <span>{selected.size}</span>}</button>)}</div>
    {assets.length > 0 && <div className="library-search"><Search size={14} /><input placeholder="Filename or section…" aria-label="Search photos" value={search} onChange={e => setSearch(e.target.value)} /></div>}
    {queue.length > 0 && <div className="import-progress" aria-live="polite"><div><span>{running ? 'Making verified copies…' : `${completed} of ${queue.length} imported`}</span>{running ? <button onClick={() => { cancel.current = true; }}>Stop queue</button> : <button aria-label="Dismiss import status" onClick={() => setQueue([])}><X size={13} /></button>}</div><progress max={queue.length} value={completed} />{queue.filter(q => q.state === 'error').slice(0, 3).map((q, i) => <p className="error-text" key={i}>{q.file.name}: {q.error}</p>)}{!running && queue.some(q => ['error', 'waiting'].includes(q.state)) && <button className="text-button" onClick={() => void process(queue)}><RefreshCw size={12} /> Retry / continue</button>}{queue.some(q => q.state === 'duplicate') && <small>Existing copies were skipped.</small>}</div>}
    <div className="library-scroll">
      {!assets.length ? <div className="library-empty"><div className="drop-illustration"><ImagePlus size={32} strokeWidth={1.2} /></div><h3>Bring your photographs.</h3><p>Drop edited JPEGs or PNGs here.<br />We’ll make safe local copies.</p><button className="button primary" disabled={running} onClick={() => fileInput.current?.click()}><Upload size={15} /> Choose photos</button><button className="text-button" disabled={running} onClick={() => folderInput.current?.click()}><FolderInput size={14} /> Or choose a folder</button><span className="micro-copy">UP TO 50 MiB PER PHOTO · ORIGINALS UNTOUCHED</span></div> : <><div className="library-selection-row"><span>{visible.length} photographs</span><button onClick={() => onSelectAll(selected.size ? [] : visible.map(a => a.id))}>{selected.size ? 'Clear selection' : 'Select all'}</button></div><div className="photo-grid">{visible.map(asset => <button key={asset.id} className={`photo-tile ${selected.has(asset.id) ? 'selected' : ''}`} onClick={() => onSelect(asset.id)} title={asset.filename} aria-label={`Select ${asset.filename}`} aria-pressed={selected.has(asset.id)} draggable onDragStart={e => { e.dataTransfer.setData('application/autopost-asset', asset.id); e.dataTransfer.effectAllowed = 'copy'; }}><img src={assetUrl(asset.id)} alt={asset.filename} loading="lazy" draggable={false} /><span className="photo-select-dot">{selected.has(asset.id) && <Check size={11} />}</span>{used.has(asset.id) && <span className="used-dot" title="Used in a post" />}<span className="photo-filename">{sections[asset.id] || asset.filename}</span></button>)}</div>{!visible.length && <p className="muted library-no-results">No photographs in this view.</p>}</>}
    </div>
    {selected.size > 0 ? <div className="selection-footer"><div><strong>{selected.size} selected</strong><button className="text-button" onClick={() => onSelectAll([])}>Clear</button></div><button className="button primary full" onClick={onCreate}><Plus size={15} /> Make a post {selected.size > 20 && '(first 20)'}</button><div className="section-input"><input value={section} maxLength={60} placeholder="Section, day, or shoot…" aria-label="Selection section" onChange={e => setSection(e.target.value)} /><button onClick={() => { onSection(section); setSection(''); }}>Label</button></div></div> : <div className="library-footer"><button className="text-button" disabled={running} onClick={() => folderInput.current?.click()}><FolderInput size={14} /> Import a folder</button><span>Drag photos onto a post</span></div>}
  </aside>;
}
