'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aperture, ArrowUpRight, Plus, ShieldCheck, Layers3, ArrowRight, X, FolderOpen } from 'lucide-react';
import { api, jsonRequest } from '@/lib/api';
import { assetUrl, type Project, type ProjectSummary } from '@/lib/domain';

export function LibraryHome() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => { api<ProjectSummary[]>('/api/projects').then(setProjects).catch(e => setError(e.message)).finally(() => setLoaded(true)); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const project = await api<Project>('/api/projects', jsonRequest('POST', { title }));
      router.push(`/projects/${project.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create project.'); setBusy(false); }
  }
  return <div className="home">
    <header className="home-nav"><Link href="/" className="brand"><Aperture size={25} strokeWidth={1.6} />autopost<span className="brand-dot">.</span></Link><span className="nav-label">THE PHOTOGRAPHER’S EDITING TABLE</span><div className="local-badge"><span /> Local studio</div></header>
    <main className="home-main">
      <section className="home-hero">
        <div className="hero-copy"><div className="eyebrow"><span className="tiny-line" /> FROM FINISHED PHOTOS TO FINISHED POSTS</div><h1>Good photographs<br />deserve to be <em>seen.</em></h1><p>Your work is already made. Find the stories inside it,<br className="desktop-break" /> give them room to breathe, and put them out into the world.</p><button className="button primary large" onClick={() => setCreate(true)}>Start a collection <ArrowUpRight size={19} /></button><div className="hero-footnote"><ShieldCheck size={15} /> Your originals stay untouched. Your studio stays local.</div></div>
        <div className="editorial-art" aria-hidden="true"><div className="art-orbit" /><div className="art-card back"><div className="art-photo landscape"><div /></div><span>THE WIDER PICTURE</span></div><div className="art-card front"><div className="art-photo portrait"><div className="art-sun" /><div className="art-hill" /><div className="art-hill second" /></div><span>01 / A DIFFERENT PERSPECTIVE</span></div><div className="art-note"><span /> A little space.<br />A stronger story.</div><span className="art-cross">+</span></div>
      </section>
      <section className="collections"><div className="section-heading"><div><div className="eyebrow">YOUR WORK, IN PROGRESS</div><h2>Collections <span>{String(projects.length).padStart(2, '0')}</span></h2></div><button className="button subtle" onClick={() => setCreate(true)}><Plus size={17} /> New collection</button></div>
        {error && <div className="notice error" role="alert">{error}</div>}
        {!loaded ? <div className="empty-collection">Opening your local library…</div> : projects.length ? <div className="collection-grid">{projects.map(p => <Link href={`/projects/${p.id}`} className="collection-card" key={p.id}><div className={`collection-cover ${p.covers.length ? '' : 'empty'}`}>{p.covers.length ? p.covers.map(id => <img src={assetUrl(id)} alt="" key={id} loading="lazy" />) : <FolderOpen size={38} strokeWidth={1} />}</div><div className="collection-info"><div><h3>{p.title}</h3><p>{p.count} photographs <span>·</span> {p.postCount} stories</p></div><ArrowUpRight size={20} /></div></Link>)}<button className="new-collection-tile" onClick={() => setCreate(true)}><Plus size={28} strokeWidth={1} /><span>Begin another story</span></button></div> : <button className="empty-collection" onClick={() => setCreate(true)}><div className="empty-icon"><Layers3 size={27} strokeWidth={1.3} /></div><div><h3>A trip. A shoot. A night worth remembering.</h3><p>Give your photographs a home. Start with one collection.</p></div><ArrowRight size={21} /></button>}
      </section>
      <footer className="home-footer"><span>LESS FRICTION. MORE PHOTOGRAPHY.</span><span>Curate thoughtfully. Publish intentionally.</span></footer>
    </main>
    {create && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setCreate(false); }}><form className="dialog create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title" onSubmit={submit}><button type="button" className="icon-button dialog-close" aria-label="Close" onClick={() => setCreate(false)}><X size={19} /></button><div className="dialog-icon"><FolderOpen size={25} /></div><div className="eyebrow">A PLACE FOR YOUR PHOTOGRAPHS</div><h2 id="create-title">Start a collection.</h2><p>A trip, a festival, a Sunday afternoon. Name the story before you find the posts.</p><label className="field-label" htmlFor="collection-title">COLLECTION NAME</label><input id="collection-title" autoFocus placeholder="Sziget, after hours" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} required /><div className="safety-note"><ShieldCheck size={18} /><span>Photos are copied into this app’s local library. Originals are never modified.</span></div><button className="button primary full" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create collection'}<ArrowRight size={17} /></button>{error && <p className="error-text" role="alert">{error}</p>}</form></div>}
  </div>;
}
