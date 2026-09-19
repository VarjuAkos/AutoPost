'use client';

import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant, applyNodeChanges, type Node, type NodeProps, type NodeChange, type Viewport } from '@xyflow/react';
import { ArrowUpRight, Plus, Sparkles, GripHorizontal, Layers3, Pin, Check } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { assetUrl, type Asset, type Post } from '@/lib/domain';
import { SlidePreview } from '../editor/SlidePreview';

type PostData = { post: Post; index: number; assets: Asset[]; open: (id: string) => void; accept: (id: string) => void; drop: (postId: string, assetId: string, from?: { postId: string; slideId: string }) => void };
type PostFlowNode = Node<PostData, 'post'>;
function PostNode({ data }: NodeProps<PostFlowNode>) {
  const { post, index, assets, open, accept, drop } = data;
  const cover = post.slides[0];
  const coverAsset = assets.find(a => a.id === cover?.assetId);
  return <div className={`post-card ${post.status === 'draft' ? 'draft' : ''}`} onDragOver={e => { if (e.dataTransfer.types.some(t => t.startsWith('application/autopost'))) e.preventDefault(); }} onDrop={e => {
    const photo = e.dataTransfer.getData('application/autopost-asset');
    const moved = e.dataTransfer.getData('application/autopost-slide');
    if (photo || moved) { e.preventDefault(); e.stopPropagation(); }
    if (photo) drop(post.id, photo);
    if (moved) { try { const value = JSON.parse(moved); if (typeof value.assetId === 'string' && typeof value.postId === 'string' && typeof value.slideId === 'string') drop(post.id, value.assetId, value); } catch {} }
  }}>
    <div className="post-drag-handle"><span className="post-index">STORY {String(index + 1).padStart(2, '0')}</span><GripHorizontal size={17} /><span className={`post-status ${post.status}`}>{post.status === 'draft' ? 'AI proposal' : `${post.slides.length} slides`}</span></div>
    <button className="post-cover nodrag" onClick={() => open(post.id)} aria-label={`Edit ${post.title}`}>{coverAsset ? <SlidePreview asset={coverAsset} frame={cover.frame} thumbnail /> : <div className="post-cover-empty"><Plus size={28} strokeWidth={1} /><span>Drop photographs here</span></div>}<span className="cover-open"><ArrowUpRight size={17} /></span></button>
    {post.slides.length > 1 && <div className="post-contact-strip nodrag">{post.slides.slice(1, 6).map(slide => <div key={slide.id} draggable onDragStart={e => { e.dataTransfer.setData('application/autopost-slide', JSON.stringify({ assetId: slide.assetId, postId: post.id, slideId: slide.id })); e.dataTransfer.effectAllowed = 'move'; }}><img src={assetUrl(slide.assetId)} alt="" draggable={false} loading="lazy" />{slide.pinned && <Pin size={10} />}</div>)}{post.slides.length > 6 && <span>+{post.slides.length - 6}</span>}</div>}
    <div className="post-caption"><h3><button className="nodrag" onClick={() => open(post.id)}>{post.title}</button></h3><p>{post.rationale || 'A story in the making. Arrange it your way.'}</p><div className="post-caption-bottom"><span>{post.lens}</span>{post.status === 'draft' ? <button className="text-button nodrag" onClick={() => accept(post.id)}><Check size={12} /> Keep this story</button> : <span>4:5 / CAROUSEL</span>}</div></div>
  </div>;
}
const nodeTypes = { post: PostNode };
type Props = { posts: Post[]; assets: Asset[]; viewport: Viewport; view: 'board' | 'sheets'; onOpen: (id: string) => void; onAccept: (id: string) => void; onDrop: PostData['drop']; onPositions: (positions: { id: string; x: number; y: number }[]) => void; onViewport: (v: Viewport) => void; onNew: () => void; onAI: () => void };
export function PostBoard({ posts, assets, viewport, view, onOpen, onAccept, onDrop, onPositions, onViewport, onNew, onAI }: Props) {
  const [nodeState, setNodeState] = useState<PostFlowNode[]>([]);
  const nodes = useMemo<PostFlowNode[]>(() => posts.map((post, index) => {
    const local = nodeState.find(node => node.id === post.id);
    return { ...local, id: post.id, type: 'post', position: local?.dragging ? local.position : post.position, dragHandle: '.post-drag-handle', data: { post, index, assets, open: onOpen, accept: onAccept, drop: onDrop } };
  }), [posts, assets, nodeState, onOpen, onAccept, onDrop]);
  function onChanges(changes: NodeChange<PostFlowNode>[]) {
    setNodeState(applyNodeChanges(changes, nodes));
  }
  if (!posts.length) return <div className="board-empty"><div className="empty-board-art"><div /><div /><div /><Layers3 size={33} strokeWidth={1} /></div><div className="eyebrow">YOUR EDITING TABLE</div><h2>Find the story<br /><em>between the photographs.</em></h2><p>Select a few photos and make a post.<br />Or let AI suggest a different way to see your collection.</p><div><button className="button primary" onClick={onNew}><Plus size={16} /> Create a post</button><button className="button secondary" onClick={onAI} disabled={!assets.length}><Sparkles size={16} /> Curate with AI</button></div><span className="board-empty-foot">NOTHING IS FINAL. EVERYTHING IS YOURS TO ARRANGE.</span></div>;
  if (view === 'sheets') return <div className="sheets-grid">{nodes.map(node => <PostNode key={node.id} id={node.id} data={node.data} type="post" dragging={false} isConnectable={false} positionAbsoluteX={0} positionAbsoluteY={0} zIndex={0} selectable={false} deletable={false} draggable={false} selected={false} />)}<button className="new-post-tile" onClick={onNew}><Plus size={26} strokeWidth={1} /> Another story</button></div>;
  return <ReactFlow<PostFlowNode> nodes={nodes} edges={[]} nodeTypes={nodeTypes} onNodesChange={onChanges} onNodeDragStop={(_, node, moved) => onPositions((moved.length ? moved : [node]).map(item => ({ id: item.id, ...item.position })))} nodeExtent={[[-10000, -10000], [10000, 10000]]} defaultViewport={viewport} onMoveEnd={(_, v) => onViewport(v)} minZoom={0.2} maxZoom={2} nodesConnectable={false} deleteKeyCode={null} panOnScroll zoomOnDoubleClick={false}><Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#c8c7c0" /><Controls showInteractive={false} position="bottom-left" /></ReactFlow>;
}
