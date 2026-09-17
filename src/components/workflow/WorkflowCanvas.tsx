"use client";

/**
 * The React Flow canvas — the heart of the workflow editor.
 *
 * It owns the live node/edge state (positions, selection, the dotted grid),
 * while every structural change funnels through the pure graph model in
 * `@/lib/workflow-graph` so the same connect / remove / layout rules that the
 * save path relies on are the ones you get on the canvas.
 *
 * Interactions:
 *   drag a tool from the palette  →  new node at the drop point
 *   drag a coloured port          →  connect (n8n rules: no loops, one input…)
 *   click a node                  →  the config rail takes over
 *   select + Delete               →  remove node (start is protected)
 *   Ctrl+Z / Ctrl+Shift+Z         →  undo / redo structure
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Icon } from "@/components/ui";
import type { FlowNode, ToolId } from "@/lib/workflow-builder";
import {
  appendRecipeToGraph,
  connectGraph,
  connectProblem,
  mainLine,
  makeNode,
  removeNodeGraph,
  validateGraph,
  type GNodeKind,
  type Graph,
} from "@/lib/workflow-graph";
import { WF_NODE_TYPES, WfNodeProvider, type WfLookups } from "./WfNodeCards";

/* ---------------------------------------------------------- graph ⇄ RF -- */

const TYPE_TO_KIND: Record<string, GNodeKind> = {
  wf_start: "start",
  wf_approval: "approval",
  wf_action: "action",
};
const KIND_TO_TYPE: Record<GNodeKind, string> = {
  start: "wf_start",
  approval: "wf_approval",
  action: "wf_action",
};

type WfNode = Node;

function toRfNode(n: Graph["nodes"][number]): WfNode {
  return { id: n.id, type: KIND_TO_TYPE[n.kind], position: n.position, data: n.data as unknown as Record<string, unknown> };
}

function edgeColor(sourceHandle?: string): string {
  return sourceHandle === "approve" ? "#15803d" : sourceHandle === "reject" ? "#dc2626" : "#98a4bb";
}

function toRfEdge(e: Graph["edges"][number]): Edge {
  return {
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    type: "smoothstep",
    style: { stroke: edgeColor(e.sourceHandle), strokeWidth: 2 },
  };
}

function graphFromRf(nodes: WfNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: TYPE_TO_KIND[n.type ?? ""] ?? "action",
      position: { x: n.position.x, y: n.position.y },
      data: n.data as unknown as FlowNode,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? undefined,
      target: e.target,
    })),
  };
}

/**
 * Rebuilding node objects from the graph would silently drop React Flow's
 * own per-node state (selected / dragging) — which made the config rail
 * collapse on every keystroke. Merge that state back, matched by id.
 */
function withRfState(next: WfNode[], prev: WfNode[]): WfNode[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  return next.map((n) => {
    const old = byId.get(n.id);
    return old ? { ...n, selected: old.selected, dragging: old.dragging ?? false } : n;
  });
}

/* ---------------------------------------------------------------- props -- */

export interface WorkflowCanvasApi {
  patchNode: (id: string, patch: Partial<FlowNode>) => void;
  removeNode: (id: string) => void;
  addNodeAtCenter: (kind: GNodeKind, tool: ToolId) => void;
  appendRecipe: (recipeId: string) => void;
  undo: () => void;
  redo: () => void;
  fitView: () => void;
  getGraph: () => Graph;
}

interface Props {
  initial: Graph;
  ro: boolean;
  lookups: WfLookups;
  onGraph: (g: Graph) => void;
  onSelection: (ids: string[]) => void;
  apiRef: React.MutableRefObject<WorkflowCanvasApi | null>;
}

function CanvasInner({ initial, ro, lookups, onGraph, onSelection, apiRef }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<WfNode>(initial.nodes.map(toRfNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges.map(toRfEdge));
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onGraphRef = useRef(onGraph);
  onGraphRef.current = onGraph;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Every graph we send to the parent, remembered — the resync effect below
  // uses it to tell "the parent replaced the graph" from "we did".
  const lastEmitted = useRef<string>("");
  const emit = useCallback((g: Graph) => {
    lastEmitted.current = JSON.stringify(g);
    onGraphRef.current(g);
  }, []);

  // When the PARENT replaces the graph (a fresh load, or the saved WFStepIDs
  // written back after a save), the canvas follows — keeping React Flow's
  // per-node state (selection) where it can. This heals any drift between
  // what is on screen and what the editor state believes.
  useEffect(() => {
    const init = JSON.stringify(initial);
    if (init === lastEmitted.current) return; // that change came from the canvas
    const cur = JSON.stringify(graphFromRf(nodes, edges));
    if (init === cur) return; // already in sync
    setNodes(withRfState(initial.nodes.map(toRfNode), nodesRef.current));
    setEdges(initial.edges.map(toRfEdge));
    lastEmitted.current = init;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  /* history — structure only (connect / remove / add / recipe), not drags */
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const [, bump] = useState(0);
  const snap = useCallback(() => JSON.stringify({ n: nodes, e: edges }), [nodes, edges]);
  const push = useCallback(() => {
    past.current = [...past.current.slice(-49), JSON.stringify({ n: nodes, e: edges })];
    future.current = [];
    bump((t) => t + 1);
  }, [nodes, edges]);

  const restore = useCallback(
    (raw: string) => {
      const p = JSON.parse(raw) as { n: WfNode[]; e: Edge[] };
      setNodes(p.n);
      setEdges(p.e);
      emit(graphFromRf(p.n, p.e));
    },
    [setNodes, setEdges, emit]
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current = [snap(), ...future.current.slice(0, 49)];
    restore(prev);
    bump((t) => t + 1);
  }, [snap, restore]);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (next === undefined) return;
    past.current = [...past.current.slice(-49), snap()];
    restore(next);
    bump((t) => t + 1);
  }, [snap, restore]);

  const apply = useCallback(
    (g: Graph) => {
      setNodes(withRfState(g.nodes.map(toRfNode), nodesRef.current));
      setEdges(g.edges.map(toRfEdge));
      emit(g);
    },
    [setNodes, setEdges, emit]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  /* --------------------------------------------------------- connections -- */

  const handleConnect = useCallback(
    (c: Connection) => {
      if (ro) return;
      const g = graphFromRf(nodes, edges);
      const conn = { source: c.source, sourceHandle: c.sourceHandle ?? undefined, target: c.target };
      const problem = connectProblem(g, conn);
      if (problem) {
        showToast(problem);
        return;
      }
      const ng = connectGraph(g, conn);
      if (ng === g) return;
      push();
      apply(ng);
    },
    [ro, nodes, edges, push, apply, showToast]
  );

  /* ------------------------------------------------------------ deletions -- */

  const handleNodesDelete = useCallback(
    (removed: Node[]) => {
      if (ro) return;
      const ids = removed.map((n) => n.id);
      if (ids.length === 0) return;
      let g = graphFromRf(nodes, edges);
      for (const id of ids) g = removeNodeGraph(g, id);
      push();
      apply(g);
    },
    [ro, nodes, edges, push, apply]
  );

  const handleEdgesDelete = useCallback(
    (removed: Edge[]) => {
      if (ro) return;
      const gone = new Set(removed.map((e) => e.id));
      const g = graphFromRf(nodes, edges);
      const ng: Graph = { ...g, edges: g.edges.filter((e) => !gone.has(e.id)) };
      push();
      apply(ng);
    },
    [ro, nodes, edges, push, apply]
  );

  /* ---------------------------------------------------------------- drop -- */

  const addNode = useCallback(
    (kind: GNodeKind, tool: ToolId, position: { x: number; y: number }) => {
      if (ro) return;
      if (kind === "start" && nodes.some((n) => n.type === "wf_start")) {
        showToast("There is already a start node — every flow has one.");
        return;
      }
      const n = makeNode(kind, tool, position);
      const g = graphFromRf(nodes, edges);
      const ng: Graph = { ...g, nodes: [...g.nodes, n] };
      push();
      apply(ng);
      // a fresh node opens its settings, like the old palette did
      setNodes((prev) => prev.map((x) => ({ ...x, selected: x.id === n.id })));
      onSelection([n.id]);
    },
    [ro, nodes, edges, push, apply, showToast, setNodes, onSelection]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/x-wf-node");
      if (!raw) return;
      try {
        const { kind, tool } = JSON.parse(raw) as { kind: GNodeKind; tool: ToolId };
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNode(kind, tool, pos);
      } catch {
        /* ignore malformed drops */
      }
    },
    [screenToFlowPosition, addNode]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  /* -------------------------------------------------------------- rail API -- */

  const patchNode = useCallback(
    (id: string, patch: Partial<FlowNode>) => {
      if (ro) return;
      const g = graphFromRf(nodes, edges);
      const ng: Graph = {
        ...g,
        nodes: g.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      };
      // data edits are not structural — update without touching undo history,
      // and keep the selection flags so the config rail doesn't collapse
      setNodes(withRfState(ng.nodes.map(toRfNode), nodesRef.current));
      emit(ng);
    },
    [ro, nodes, edges, setNodes, emit]
  );

  const removeNode = useCallback(
    (id: string) => {
      if (ro) return;
      const g = graphFromRf(nodes, edges);
      const ng = removeNodeGraph(g, id);
      if (ng === g) return;
      push();
      apply(ng);
    },
    [ro, nodes, edges, push, apply]
  );

  const addNodeAtCenter = useCallback(
    (kind: GNodeKind, tool: ToolId) => {
      if (ro) return;
      const g = graphFromRf(nodes, edges);
      const line = mainLine(g);
      const last = line[line.length - 1];
      const pos = last
        ? { x: last.position.x + 280, y: last.position.y }
        : { x: 40, y: 120 };
      addNode(kind, tool, pos);
    },
    [ro, nodes, edges, addNode]
  );

  const appendRecipe = useCallback(
    (recipeId: string) => {
      if (ro) return;
      const g = graphFromRf(nodes, edges);
      const ng = appendRecipeToGraph(g, recipeId);
      if (ng === g) {
        showToast("Nothing to attach that preset to right now.");
        return;
      }
      push();
      apply(ng);
    },
    [ro, nodes, edges, push, apply, showToast]
  );

  useEffect(() => {
    apiRef.current = {
      patchNode,
      removeNode,
      addNodeAtCenter,
      appendRecipe,
      undo,
      redo,
      fitView,
      getGraph: () => graphFromRf(nodes, edges),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchNode, removeNode, addNodeAtCenter, appendRecipe, undo, redo, nodes, edges]);

  /* ------------------------------------------------------------- selection -- */

  const handleSelection = useCallback(
    (params: { nodes: WfNode[] }) => {
      onSelection(params.nodes.map((n) => n.id));
    },
    [onSelection]
  );

  /* ------------------------------------------------------------ drag stop -- */

  const handleDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, _node: WfNode, all: WfNode[]) => {
      // positions are part of the saved canvas — notify without touching history
      emit(graphFromRf(all, edgesRef.current));
    },
    [emit]
  );

  /* -------------------------------------------------------------- ctx value -- */

  const issues = useMemo(() => {
    const g = graphFromRf(nodes, edges);
    const out: Record<string, string[]> = {};
    for (const p of validateGraph(g)) if (p.key) out[p.key] = [...(out[p.key] ?? []), p.reason];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const ctxValue = useMemo(
    () => ({ lookups, issues, onPatch: patchNode, onRemove: removeNode, ro }),
    [lookups, issues, patchNode, removeNode, ro]
  );

  const nodeTypes = useMemo(() => WF_NODE_TYPES, []);
  const startCount = nodes.filter((n) => n.type === "wf_start").length;
  const hasContent = nodes.length > startCount;

  return (
    <div
      className="relative h-full w-full bg-[#f3f5fa]"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <WfNodeProvider value={ctxValue}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          onSelectionChange={handleSelection}
          onNodeDragStop={handleDragStop}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={!ro}
          nodesConnectable={!ro}
          nodesFocusable={!ro}
          elementsSelectable
          deleteKeyCode={ro ? null : ["Backspace", "Delete"]}
          connectionRadius={30}
          autoPanOnConnect
          connectionLineStyle={{ stroke: "#a33900", strokeWidth: 2, strokeDasharray: "6 3" }}
          proOptions={{ hideAttribution: false }}
          className="!bg-transparent"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#c9d2e3" />
          <Controls showInteractive={false} className="!shadow-tier2 !border-surface-variant !bg-white" />
          <MiniMap
            pannable
            zoomable
            className="!bg-white/90 !border !border-surface-variant"
            nodeColor={(n) => {
              const t = n.type;
              return t === "wf_start" ? "#059669" : t === "wf_approval" ? "#a33900" : "#7c3aed";
            }}
            maskColor="rgba(243,245,250,0.7)"
          />
        </ReactFlow>
      </WfNodeProvider>

      {/* toolbar */}
      <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={ro || past.current.length === 0}
          className="icon-btn !h-8 !w-8 pointer-events-auto !bg-white !shadow-tier1"
          title="Undo (Ctrl+Z)"
        >
          <Icon name="undo" className="text-[18px]" />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={ro || future.current.length === 0}
          className="icon-btn !h-8 !w-8 pointer-events-auto !bg-white !shadow-tier1"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Icon name="redo" className="text-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.15, duration: 250 })}
          className="icon-btn !h-8 !w-8 pointer-events-auto !bg-white !shadow-tier1"
          title="Fit to view"
        >
          <Icon name="fit_screen" className="text-[18px]" />
        </button>
      </div>

      {/* connection-refused toast */}
      {toast && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-medium text-amber-800 shadow-tier1">
          {toast}
        </div>
      )}

      {/* empty state */}
      {!hasContent && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#c9d2e3] bg-white/60 px-8 py-6 text-center backdrop-blur-[2px]">
            <Icon name="account_tree" className="text-[30px] text-outline" />
            <p className="text-sm font-semibold text-on-surface">A fresh canvas</p>
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Drag a tool from the left panel and drop it here, or click one to add it. The start marker is already
              waiting — connect things to it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
