'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, jsonRequest } from './api';
import type { Asset, Project, ProjectDocument } from './domain';

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('Saved locally');
  const latest = useRef<Project | null>(null);
  const saved = useRef<ProjectDocument | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef<ProjectDocument[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  useEffect(() => {
    let active = true;
    api<Project>(`/api/projects/${id}`).then(value => {
      if (!active) return;
      latest.current = value;
      saved.current = value.document;
      setProject(value);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id]);
  const flush = useCallback(async function save(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) { await pending.current; return save(); }
    const current = latest.current;
    if (!current || current.document === saved.current) return;
    const task = (async () => {
      try {
        const result = await api<{ revision: number }>(`/api/projects/${id}`, jsonRequest('PUT', { revision: current.revision, document: current.document }));
        saved.current = current.document;
        if (latest.current) {
          latest.current = { ...latest.current, revision: result.revision };
          setProject(latest.current);
        }
        setSaveState('Saved locally');
        setError('');
      } catch (e) {
        setSaveState('Not saved');
        setError(e instanceof Error ? e.message : 'Saving failed.');
        throw e;
      }
    })();
    pending.current = task;
    try { await task; } finally { pending.current = null; }
    if (latest.current?.document !== saved.current) return save();
  }, [id]);
  const change = useCallback((updater: (doc: ProjectDocument) => ProjectDocument, remember = true) => {
    const current = latest.current;
    if (!current) return;
    const document = updater(current.document);
    if (remember) {
      history.current = [...history.current.slice(-29), current.document];
      setUndoCount(history.current.length);
    }
    latest.current = { ...current, document };
    setProject(latest.current);
    setSaveState('Saving…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 450);
  }, [flush]);
  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (previous) change(() => previous, false);
    setUndoCount(history.current.length);
  }, [change]);
  const addAsset = useCallback((asset: Asset) => {
    const current = latest.current;
    if (!current || current.assets.some(a => a.id === asset.id)) return;
    latest.current = { ...current, assets: [...current.assets, asset] };
    setProject(latest.current);
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (latest.current?.document !== saved.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  return { project, error, saveState, change, flush, undo, undoCount, addAsset };
}
