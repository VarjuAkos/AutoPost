'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Aperture, ArrowLeft, Check, ChevronDown, CircleHelp, FolderOpen, Grid2X2, Layers3, Plus, Sparkles, Undo2, X } from 'lucide-react';
import { useProject } from '@/lib/useProject';
import { newPost, newSlide, type Post } from '@/lib/domain';
import { PhotoLibrary } from './library/PhotoLibrary';
import { PostBoard } from './board/PostBoard';
import { CarouselEditor } from './editor/CarouselEditor';
import { CurationPanel } from './board/CurationPanel';

export function Studio({ projectId }: { projectId: string }) {
  const { project, error, saveState, change, flush, undo, undoCount, addAsset } = useProject(projectId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'board' | 'sheets'>('board');
  const [editing, setEditing] = useState<string | null>(null);
  const [curation, setCuration] = useState<{ targetId?: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [help, setHelp] = useState(false);
  const router = useRouter();
  if (!project) return <div className="loading-screen"><Aperture size={30} className={error ? '' : 'spin'} /><h2>{error || 'Opening the studio…'}</h2><Link href="/" className="text-button">Back to collections</Link></div>;
  const { document: doc, assets } = project;
  const activePost = doc.posts.find(p => p.id === editing);
  const used = new Set(doc.posts.flatMap(p => p.slides.map(s => s.assetId)));
  function createPost() {
    if (doc.posts.length >= 100) { setNotice('This collection has reached 100 posts.'); return; }
    const post = newPost([...selected], doc.posts.length, `Story ${String(doc.posts.length + 1).padStart(2, '0')}`);
    change(d => ({ ...d, posts: [...d.posts, post] }));
    setSelected(new Set());
    if (post.slides.length) setEditing(post.id);
  }
  function update(post: Post) { change(d => ({ ...d, posts: d.posts.map(p => p.id === post.id ? post : p) })); }
  function transfer(postId: string, assetId: string, from?: { postId: string; slideId: string }) {
    if (!assets.some(a => a.id === assetId)) return;
    const target = doc.posts.find(p => p.id === postId);
    if (!target || target.slides.length >= 20 || from?.postId === postId) return;
    const existing = from ? doc.posts.find(p => p.id === from.postId)?.slides.find(s => s.id === from.slideId) : undefined;
    if (from && !existing) return;
    change(d => ({ ...d, posts: d.posts.map(p => p.id === postId ? { ...p, slides: [...p.slides, existing || newSlide(assetId, p.frame)] } : p.id === from?.postId ? { ...p, slides: p.slides.filter(s => s.id !== from.slideId) } : p) }));
  }
  async function exportCurrent() {
    if (!activePost) return;
    await flush();
    const response = await fetch(`/api/projects/${projectId}/posts/${activePost.id}/export`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).error || 'Export failed.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${activePost.title.replace(/[^a-zA-Z0-9_-]/g, '-') || 'carousel'}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return <div className="studio-shell">
    <nav className="studio-rail"><button className="rail-brand" aria-label="Back to collections" onClick={() => void flush().then(() => router.push('/')).catch(e => setNotice(e.message))}><Aperture size={28} strokeWidth={1.4} /></button><div className="rail-divider" /><button className="rail-button" title="Collections" aria-label="Collections" onClick={() => void flush().then(() => router.push('/')).catch(e => setNotice(e.message))}><FolderOpen size={21} strokeWidth={1.5} /></button><button className="rail-button active" aria-label="Editing table"><Layers3 size={21} strokeWidth={1.5} /></button><div className="rail-bottom"><button className="rail-button" title="How the studio works" aria-label="Help" onClick={() => setHelp(true)}><CircleHelp size={20} strokeWidth={1.5} /></button><span className="rail-avatar">A</span></div></nav>
    <div className="studio-main"><header className="studio-header"><div className="project-title"><div className="breadcrumb">COLLECTIONS <span>/</span> YOUR EDITING TABLE</div><div><h1>{doc.title}</h1><ChevronDown size={15} className="muted" /></div></div><div className="studio-header-actions"><span className={`save-indicator ${saveState === 'Not saved' ? 'failed' : ''}`}><span />{saveState}</span><button className="icon-button" aria-label="Undo last edit" title="Undo last edit" disabled={!undoCount} onClick={undo}><Undo2 size={18} /></button><div className="header-divider" /><button className="button secondary" onClick={createPost}><Plus size={16} /> New post</button><button className="button primary" disabled={!assets.length} onClick={() => setCuration({})}><Sparkles size={16} /> Curate with AI</button></div></header>
      <div className="studio-content"><PhotoLibrary projectId={projectId} assets={assets} posts={doc.posts} selected={selected} sections={doc.sections} onSelect={id => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onSelectAll={ids => setSelected(new Set(ids))} onAsset={addAsset} onCreate={createPost} onSection={label => change(d => ({ ...d, sections: { ...d.sections, ...Object.fromEntries([...selected].map(id => [id, label])) } }))} />
        <main className="board-area"><div className="board-toolbar"><div><span className="board-title">The editing table</span><span className="board-stat">{doc.posts.length} {doc.posts.length === 1 ? 'story' : 'stories'}<i />{assets.length - used.size} unused photographs</span></div><div className="view-toggle"><button className={view === 'board' ? 'active' : ''} title="Spatial board" aria-label="Spatial board" onClick={() => setView('board')}><Layers3 size={15} /> Board</button><button className={view === 'sheets' ? 'active' : ''} title="Contact sheets" aria-label="Contact sheets" onClick={() => setView('sheets')}><Grid2X2 size={15} /> Sheets</button></div></div><div className="board-canvas"><PostBoard posts={doc.posts} assets={assets} viewport={doc.viewport} view={view} onOpen={setEditing} onAccept={id => change(d => ({ ...d, posts: d.posts.map(p => p.id === id ? { ...p, status: 'accepted' } : p) }))} onDrop={transfer} onPositions={positions => change(d => ({ ...d, posts: d.posts.map(p => { const next = positions.find(n => n.id === p.id); return next ? { ...p, position: { x: next.x, y: next.y } } : p; }) }), false)} onViewport={viewport => { if (Math.abs(viewport.x - doc.viewport.x) + Math.abs(viewport.y - doc.viewport.y) + Math.abs(viewport.zoom - doc.viewport.zoom) > 0.01) change(d => ({ ...d, viewport }), false); }} onNew={createPost} onAI={() => setCuration({})} /></div><div className="board-bottom-note"><span><Check size={12} /> Originals untouched</span><span>Made for your eye. Not an algorithm’s.</span></div></main>
      </div>
    </div>
    {activePost && <CarouselEditor key={activePost.id} post={activePost} posts={doc.posts} assets={assets} selected={selected} saveState={saveState} onUpdate={update} onClose={() => setEditing(null)} onExport={exportCurrent} onRegenerate={() => setCuration({ targetId: activePost.id })} onMove={(slideId, target) => { const slide = activePost.slides.find(s => s.id === slideId); if (slide) transfer(target, slide.assetId, { postId: activePost.id, slideId }); }} onRemove={() => { change(d => ({ ...d, posts: d.posts.filter(p => p.id !== activePost.id) })); setEditing(null); }} />}
    {curation && <CurationPanel projectId={projectId} assets={assets} selected={selected} target={doc.posts.find(p => p.id === curation.targetId)} onClose={() => setCuration(null)} onFlush={flush} onApply={(posts, targetId) => { if (doc.posts.length + (targetId ? 0 : posts.length) > 100) { setNotice('This would exceed 100 posts.'); return; } change(d => ({ ...d, posts: targetId ? d.posts.map(p => p.id === targetId ? { ...posts[0], id: p.id, position: p.position } : p) : [...d.posts, ...posts] })); setCuration(null); setNotice(targetId ? 'New proposal applied. Your pinned frames are preserved.' : 'Proposals are on the board. Open each story and make it yours.'); }} />}
    {(error || notice) && <div className="floating-error" role="status"><span>{error || notice}</span>{error && <button className="text-button" onClick={() => void flush().catch(() => {})}>Retry save</button>}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={17} /></button></div>}
    {help && <div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label="Studio help"><button className="icon-button dialog-close" aria-label="Close help" onClick={() => setHelp(false)}><X size={18} /></button><div className="eyebrow">MAKE YOURSELF AT HOME</div><h2>A table, not a template.</h2><ol className="help-list"><li><strong>Bring your finished photos.</strong><p>Import JPEGs or PNGs. We make verified local copies and leave your originals alone.</p></li><li><strong>Find your stories.</strong><p>Select photos and make a post, drag them onto a card, or ask AI for proposals. Drag card headers to rearrange the board.</p></li><li><strong>Give every frame room.</strong><p>Open a post. Fit, crop, reorder, or change the background. Pin slides before asking AI to rethink the rest.</p></li><li><strong>Take your work with you.</strong><p>Export a ZIP of numbered 4:5 JPEGs. AirDrop them, add music in Instagram, and publish when ready.</p></li></ol><button className="button primary full" onClick={() => setHelp(false)}><ArrowLeft size={16} /> Back to your photographs</button></section></div>}
  </div>;
}
