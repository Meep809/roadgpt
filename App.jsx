/*
Intersection & Interchange Designer
File: intersection-designer.jsx
Usage:
  - Create a new Vite + React project (recommended) or add to existing React app.
  - Save this file as src/App.jsx and run the dev server.
  - To deploy to GitHub Pages, build (`npm run build`) and push the `dist`/`build` to the gh-pages branch or use GitHub Actions.

What it does (feature summary):
  - Interactive SVG canvas for drawing roads (polylines) and nodes (intersections).
  - Toolbar with tools: Select, Add Node, Add Road, Move, Delete, Templates (Diamond, T-intersection, Roundabout)
  - Snap-to-grid toggle and simple snapping between nodes.
  - Property panel for selected items (road width, lane count, node type).
  - Export SVG and JSON for saving designs.
  - Undo stack (basic)

Notes:
  - This is intentionally compact yet functional: extend it as needed (add lane markings, traffic signals, ramps, labels, measurements).
  - Uses inline Tailwind-style class names; if your project does not have Tailwind, adjust styles in CSS.

*/

import React, { useState, useRef, useEffect } from "react";

// Simple utility helpers
const uid = (prefix = "id") => prefix + "_" + Math.random().toString(36).slice(2, 9);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export default function App() {
  // canvas size
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(700);

  // data model
  const [nodes, setNodes] = useState([]); // {id,x,y,type}
  const [roads, setRoads] = useState([]); // {id,points:[nodeId],width,laneCount}

  // UI state
  const [mode, setMode] = useState("select"); // select | add-node | add-road | move | delete | template
  const [selected, setSelected] = useState(null); // {type:'node'|'road',id}
  const [snap, setSnap] = useState(true);
  const [gridSize, setGridSize] = useState(10);
  const [currentRoadTemp, setCurrentRoadTemp] = useState(null); // building road: [nodeId,...]
  const svgRef = useRef(null);

  // undo stack
  const undoStack = useRef([]);
  const pushUndo = (label = "change") => {
    undoStack.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), roads: JSON.parse(JSON.stringify(roads)), label });
    if (undoStack.current.length > 50) undoStack.current.shift();
  };
  const undo = () => {
    const s = undoStack.current.pop();
    if (s) {
      setNodes(s.nodes);
      setRoads(s.roads);
    }
  };

  // helpers to find nearest node
  function findNearbyNode(p, radius = 12) {
    let best = null;
    for (const n of nodes) {
      const d = dist(p, n);
      if (d <= radius && (!best || d < best.d)) best = { node: n, d };
    }
    return best ? best.node : null;
  }

  function snapPoint(raw) {
    if (!snap) return raw;
    // snap to grid
    const gx = Math.round(raw.x / gridSize) * gridSize;
    const gy = Math.round(raw.y / gridSize) * gridSize;
    // also snap to existing node if close
    const near = findNearbyNode({ x: gx, y: gy }, 14);
    if (near) return { x: near.x, y: near.y, nodeId: near.id };
    return { x: gx, y: gy };
  }

  // Mouse handlers
  const onCanvasClick = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const raw = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const p = snapPoint(raw);

    if (mode === "add-node") {
      pushUndo();
      const newNode = { id: uid("n"), x: p.x, y: p.y, type: "intersection" };
      setNodes((s) => [...s, newNode]);
      setSelected({ type: "node", id: newNode.id });
      return;
    }

    if (mode === "add-road") {
      // if click near existing node, use it, else create a node
      pushUndo();
      let nodeId = p.nodeId;
      if (!nodeId) {
        const newNode = { id: uid("n"), x: p.x, y: p.y, type: "intersection" };
        setNodes((s) => [...s, newNode]);
        nodeId = newNode.id;
      }
      if (!currentRoadTemp) {
        // start new road
        setCurrentRoadTemp({ id: uid("rtmp"), points: [nodeId], width: 12, laneCount: 2 });
        setSelected(null);
      } else {
        // append to current road; if last point equals nodeId, finish
        setCurrentRoadTemp((t) => {
          if (t.points[t.points.length - 1] === nodeId) return t;
          return { ...t, points: [...t.points, nodeId] };
        });
      }
      return;
    }

    if (mode === "select") {
      // try select node
      const near = findNearbyNode({ x: p.x, y: p.y }, 10);
      if (near) {
        setSelected({ type: "node", id: near.id });
        return;
      }
      // try select road by proximity to segment
      for (const r of roads) {
        const pts = r.points.map((pid) => nodes.find((n) => n.id === pid));
        for (let i = 0; i < pts.length - 1; i++) {
          if (!pts[i] || !pts[i + 1]) continue;
          const d = pointToSegmentDistance({ x: p.x, y: p.y }, pts[i], pts[i + 1]);
          if (d < 8) {
            setSelected({ type: "road", id: r.id });
            return;
          }
        }
      }
      setSelected(null);
    }

    if (mode === "delete") {
      // delete node if clicked nearby
      const near = findNearbyNode({ x: p.x, y: p.y }, 10);
      if (near) {
        pushUndo();
        // remove node, remove references in roads
        setNodes((s) => s.filter((n) => n.id !== near.id));
        setRoads((rs) => rs.map((r) => ({ ...r, points: r.points.filter((pid) => pid !== near.id) })).filter((r) => r.points.length > 1));
        setSelected(null);
        return;
      }
      // delete road if clicked near
      for (const r of roads) {
        const pts = r.points.map((pid) => nodes.find((n) => n.id === pid));
        for (let i = 0; i < pts.length - 1; i++) {
          if (!pts[i] || !pts[i + 1]) continue;
          const d = pointToSegmentDistance({ x: p.x, y: p.y }, pts[i], pts[i + 1]);
          if (d < 8) {
            pushUndo();
            setRoads((s) => s.filter((rr) => rr.id !== r.id));
            setSelected(null);
            return;
          }
        }
      }
    }
  };

  // double click to finish road
  const onCanvasDoubleClick = (e) => {
    if (mode === "add-road" && currentRoadTemp) {
      // finalize
      setRoads((s) => [...s, { id: uid("r"), points: currentRoadTemp.points, width: currentRoadTemp.width, laneCount: currentRoadTemp.laneCount }]);
      setCurrentRoadTemp(null);
    }
  };

  // move selected node by dragging
  const dragging = useRef(null);
  const onMouseDown = (e) => {
    if (mode === "move" && selected && selected.type === "node") {
      const rect = svgRef.current.getBoundingClientRect();
      dragging.current = { id: selected.id, ox: e.clientX - rect.left, oy: e.clientY - rect.top };
    }
  };
  const onMouseMove = (e) => {
    if (!dragging.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const raw = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const p = snapPoint(raw);
    setNodes((s) => s.map((n) => (n.id === dragging.current.id ? { ...n, x: p.x, y: p.y } : n)));
  };
  const onMouseUp = (e) => {
    if (dragging.current) {
      pushUndo();
      dragging.current = null;
    }
  };

  // utility: distance from point to segment
  function pointToSegmentDistance(p, v, w) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return dist(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return dist(p, proj);
  }

  // Templates
  function insertDiamond(cx = 300, cy = 200, spacing = 120) {
    pushUndo();
    // diamond interchange: 4 ramps connecting a cross
    // center nodes
    const center = { id: uid("n"), x: cx, y: cy, type: "junction" };
    const nN = { id: uid("n"), x: cx, y: cy - spacing, type: "exit" };
    const nE = { id: uid("n"), x: cx + spacing, y: cy, type: "exit" };
    const nS = { id: uid("n"), x: cx, y: cy + spacing, type: "exit" };
    const nW = { id: uid("n"), x: cx - spacing, y: cy, type: "exit" };
    const newNodes = [center, nN, nE, nS, nW];
    // main cross roads
    const r1 = { id: uid("r"), points: [nW.id, nE.id], width: 18, laneCount: 2 };
    const r2 = { id: uid("r"), points: [nN.id, nS.id], width: 18, laneCount: 2 };
    // diamond ramps
    const ramps = [
      { id: uid("r"), points: [nN.id, center.id, nE.id], width: 10, laneCount: 1 },
      { id: uid("r"), points: [nE.id, center.id, nS.id], width: 10, laneCount: 1 },
      { id: uid("r"), points: [nS.id, center.id, nW.id], width: 10, laneCount: 1 },
      { id: uid("r"), points: [nW.id, center.id, nN.id], width: 10, laneCount: 1 }
    ];
    setNodes((s) => [...s, ...newNodes]);
    setRoads((s) => [...s, r1, r2, ...ramps]);
  }

  function insertT(cx = 500, cy = 350, spacing = 120) {
    pushUndo();
    const nA = { id: uid("n"), x: cx - spacing, y: cy, type: "exit" };
    const nB = { id: uid("n"), x: cx + spacing, y: cy, type: "exit" };
    const nC = { id: uid("n"), x: cx, y: cy - spacing, type: "intersection" };
    setNodes((s) => [...s, nA, nB, nC]);
    setRoads((s) => [...s, { id: uid("r"), points: [nA.id, nB.id], width: 18, laneCount: 2 }, { id: uid("r"), points: [nC.id, { id: nC.id }], width: 14, laneCount: 1 }]);
  }

  function insertRoundabout(cx = 700, cy = 200, radius = 60, arms = 4) {
    pushUndo();
    const center = { id: uid("n"), x: cx, y: cy, type: "roundabout" };
    const ring = [];
    const exits = [];
    const roadsToAdd = [];
    for (let i = 0; i < arms; i++) {
      const ang = (2 * Math.PI * i) / arms;
      const ex = { id: uid("n"), x: cx + Math.cos(ang) * (radius + 50), y: cy + Math.sin(ang) * (radius + 50), type: "exit" };
      exits.push(ex);
    }
    // create circular ring as nodes along circle
    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
      const ang = (2 * Math.PI * i) / ringCount;
      ring.push({ id: uid("n"), x: cx + Math.cos(ang) * radius, y: cy + Math.sin(ang) * radius, type: "round" });
    }
    // ring road
    const ringRoad = { id: uid("r"), points: ring.map((n) => n.id), width: 12, laneCount: 1 };
    // connect exits
    for (const ex of exits) {
      // find nearest ring node
      let nearest = ring[0];
      let bestD = dist(ex, ring[0]);
      for (const rn of ring) {
        const d = dist(ex, rn);
        if (d < bestD) {
          bestD = d;
          nearest = rn;
        }
      }
      roadsToAdd.push({ id: uid("r"), points: [ex.id, nearest.id], width: 10, laneCount: 1 });
    }
    setNodes((s) => [...s, center, ...ring, ...exits]);
    setRoads((s) => [...s, ringRoad, ...roadsToAdd]);
  }

  // Export functions
  function exportJSON() {
    const payload = { nodes, roads };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "intersection-design.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportSVG() {
    const svg = svgRef.current.cloneNode(true);
    // remove interactive handlers for export
    svg.removeAttribute("onmousedown");
    const serializer = new XMLSerializer();
    const src = serializer.serializeToString(svg);
    const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "intersection-design.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  // UI: property panel updates
  function updateSelectedNode(patch) {
    pushUndo();
    setNodes((s) => s.map((n) => (n.id === selected.id ? { ...n, ...patch } : n)));
  }
  function updateSelectedRoad(patch) {
    pushUndo();
    setRoads((s) => s.map((r) => (r.id === selected.id ? { ...r, ...patch } : r)));
  }

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") {
        setCurrentRoadTemp(null);
        setMode("select");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        undo();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nodes, roads]);

  // render helpers
  function renderRoad(r) {
    const pts = r.points.map((pid) => nodes.find((n) => n.id === pid)).filter(Boolean);
    if (pts.length < 2) return null;
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    return (
      <g key={r.id}>
        <path d={d} strokeWidth={r.width} stroke="#666" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {/* centerline */}
        <path d={d} strokeWidth={1} strokeDasharray="6 6" stroke="#fff" fill="none" opacity={0.5} />
      </g>
    );
  }

  function renderNode(n) {
    const isSel = selected && selected.type === "node" && selected.id === n.id;
    return (
      <g key={n.id}>
        <circle cx={n.x} cy={n.y} r={isSel ? 8 : 6} fill={isSel ? "#ff6b6b" : "#222"} />
      </g>
    );
  }

  return (
    <div className="h-screen flex" style={{ fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ width: 320, borderRight: "1px solid #ddd", padding: 12 }}>
        <h3 style={{ margin: 0 }}>Intersection Designer</h3>
        <div style={{ marginTop: 8 }}>
          <div>
            <label>Tool:</label>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {[
                ["select", "Select"],
                ["add-node", "Add Node"],
                ["add-road", "Add Road"],
                ["move", "Move"],
                ["delete", "Delete"],
              ].map(([k, label]) => (
                <button key={k} onClick={() => setMode(k)} className={`px-2 py-1`} style={{ background: mode === k ? "#222" : "#fff", color: mode === k ? "#fff" : "#222", border: "1px solid #ccc" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label>Grid</label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap
              <input type="number" value={gridSize} onChange={(e) => setGridSize(Number(e.target.value || 10))} style={{ width: 60 }} /> px
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Templates</label>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => insertDiamond(280, 200)}>Diamond</button>
              <button onClick={() => insertRoundabout(600, 200)}>Roundabout</button>
              <button onClick={() => insertT(500, 350)}>T-intersection</button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Export</label>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={exportJSON}>Export JSON</button>
              <button onClick={exportSVG}>Export SVG</button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Actions</label>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={() => { pushUndo(); setNodes([]); setRoads([]); }}>Clear</button>
              <button onClick={undo}>Undo</button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Canvas</label>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value || 1200))} style={{ width: 90 }} />
              <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value || 700))} style={{ width: 90 }} />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <hr />
            <div style={{ marginTop: 6 }}>
              <strong>Selected</strong>
              <div style={{ marginTop: 6 }}>
                {selected ? (
                  selected.type === "node" ? (
                    (() => {
                      const n = nodes.find((x) => x.id === selected.id);
                      if (!n) return <div>Nothing</div>;
                      return (
                        <div>
                          <div>Node: {n.id}</div>
                          <div style={{ marginTop: 6 }}>
                            X: <input type="number" value={Math.round(n.x)} onChange={(e) => updateSelectedNode({ x: Number(e.target.value || 0) })} style={{ width: 80 }} />
                            Y: <input type="number" value={Math.round(n.y)} onChange={(e) => updateSelectedNode({ y: Number(e.target.value || 0) })} style={{ width: 80 }} />
                          </div>
                          <div style={{ marginTop: 6 }}>
                            Type:
                            <select value={n.type} onChange={(e) => updateSelectedNode({ type: e.target.value })}>
                              <option value="intersection">intersection</option>
                              <option value="exit">exit</option>
                              <option value="roundabout">roundabout</option>
                              <option value="junction">junction</option>
                            </select>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    (() => {
                      const r = roads.find((x) => x.id === selected.id);
                      if (!r) return <div>Nothing</div>;
                      return (
                        <div>
                          <div>Road: {r.id}</div>
                          <div style={{ marginTop: 6 }}>
                            Width: <input type="number" value={r.width} onChange={(e) => updateSelectedRoad({ width: Number(e.target.value || 12) })} style={{ width: 80 }} /> px
                          </div>
                          <div style={{ marginTop: 6 }}>
                            Lanes: <input type="number" value={r.laneCount} onChange={(e) => updateSelectedRoad({ laneCount: Number(e.target.value || 1) })} style={{ width: 80 }} />
                          </div>
                        </div>
                      );
                    })()
                  )
                ) : (
                  <div>none</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <svg
          ref={svgRef}
          width={width}
          height={height}
          onClick={onCanvasClick}
          onDoubleClick={onCanvasDoubleClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          style={{ background: "#f7f7f7", display: "block" }}
        >
          {/* grid */}
          {Array.from({ length: Math.ceil(width / gridSize) }).map((_, i) => (
            <line key={`gv${i}`} x1={i * gridSize} x2={i * gridSize} y1={0} y2={height} stroke="#eee" strokeWidth={1} />
          ))}
          {Array.from({ length: Math.ceil(height / gridSize) }).map((_, i) => (
            <line key={`gh${i}`} x1={0} x2={width} y1={i * gridSize} y2={i * gridSize} stroke="#eee" strokeWidth={1} />
          ))}

          {/* roads */}
          {roads.map((r) => renderRoad(r))}
          {currentRoadTemp && (() => renderRoad({ ...currentRoadTemp, id: currentRoadTemp.id }))()}

          {/* nodes */}
          {nodes.map((n) => renderNode(n))}

        </svg>
      </div>
    </div>
  );
}
