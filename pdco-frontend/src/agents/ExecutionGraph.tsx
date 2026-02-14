import React, { useEffect, useMemo, useRef } from 'react';
import type { Task } from './types';

type Props = {
  tasks: Task[];
  taskStates: Record<string, string>;
};

type Node = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  layer: number;
};

type Edge = {
  from: string;
  to: string;
};

type Pulse = {
  edgeKey: string;
  t: number;
  speed: number;
};

type CurveCacheEntry = {
  a: Node;
  b: Node;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
};

export default function ExecutionGraph({ tasks, taskStates }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const animationRef = useRef<number>();
  const pulsesRef = useRef<Pulse[]>([]);
  const frameRef = useRef<number>(0);
  const taskStatesRef = useRef(taskStates);

  const height = 600;

  const colorMap: Record<string, string> = {
    planned: '#444',
    pr_opened: '#00f2ff',
    running: '#ffaa00',
    blocked: '#ff4d6d',
    merged: '#00ff88',
    ci_green: '#00f2ff'
  };

  const edgeBase = '#444';

  const edges: Edge[] = useMemo(
    () => tasks.flatMap((t) => (t.dependencies || []).map((dep) => ({ from: dep, to: t.id }))),
    [tasks]
  );

  useEffect(() => {
    taskStatesRef.current = taskStates;
  }, [taskStates]);

  const edgeKey = (e: Edge) => `${e.from}->${e.to}`;

  const edgeMode = (e: Edge) => {
    const s = taskStatesRef.current[e.to];
    if (s === 'running') return 'active';
    if (s === 'blocked') return 'blocked';
    if (s === 'merged') return 'done';
    return 'default';
  };

  const edgeStroke = (mode: string) => {
    if (mode === 'active') return '#ffaa00';
    if (mode === 'done') return '#00ff88';
    if (mode === 'blocked') return '#ff4d6d';
    return edgeBase;
  };

  const edgeWidth = (mode: string) => {
    if (mode === 'active') return 3.5;
    if (mode === 'done' || mode === 'blocked') return 3;
    return 2;
  };

  const curvePath = (ax: number, ay: number, bx: number, by: number) => {
    const dx = Math.max(60, (bx - ax) * 0.55);
    const c1x = ax + dx;
    const c1y = ay;
    const c2x = bx - dx;
    const c2y = by;
    return { d: `M ${ax} ${ay} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${bx} ${by}`, c1x, c1y, c2x, c2y };
  };

  const bezierPoint = (
    t: number,
    ax: number,
    ay: number,
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    bx: number,
    by: number
  ) => {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x = uuu * ax + 3 * uu * t * c1x + 3 * u * tt * c2x + ttt * bx;
    const y = uuu * ay + 3 * uu * t * c1y + 3 * u * tt * c2y + ttt * by;
    return { x, y };
  };

  useEffect(() => {
    if (!tasks.length) return;

    const layerMap: Record<string, number> = {};
    tasks.forEach((t) => {
      const deps = t.dependencies || [];
      layerMap[t.id] = deps.length ? 1 + Math.max(...deps.map((d) => layerMap[d] ?? 0)) : 0;
    });

    nodesRef.current = tasks.map((t, i) => ({
      id: t.id,
      layer: layerMap[t.id],
      x: 150 + layerMap[t.id] * 250,
      y: 120 + (i % 6) * 80 + Math.floor(i / 6) * 40,
      vx: 0,
      vy: 0
    }));

    pulsesRef.current = [];

    const stepPulses = () => {
      const activeEdges = edges.filter((e) => edgeMode(e) === 'active');
      const activeKeys = new Set(activeEdges.map(edgeKey));

      pulsesRef.current = pulsesRef.current.filter((p) => activeKeys.has(p.edgeKey));

      activeEdges.forEach((e) => {
        const key = edgeKey(e);
        const count = pulsesRef.current.filter((p) => p.edgeKey === key).length;
        if (count < 2 && frameRef.current % 18 === 0) {
          pulsesRef.current.push({ edgeKey: key, t: 0, speed: 0.012 + Math.random() * 0.01 });
        }
      });

      pulsesRef.current.forEach((p) => {
        p.t += p.speed;
        if (p.t > 1) {
          p.t = 0;
        }
      });
    };

    const render = () => {
      const svg = svgRef.current;
      if (!svg) return;
      svg.innerHTML = '';

      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrow');
      marker.setAttribute('markerWidth', '10');
      marker.setAttribute('markerHeight', '10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');

      const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arrowPath.setAttribute('d', 'M0,0 L9,3 L0,6 Z');
      arrowPath.setAttribute('fill', '#555');

      marker.appendChild(arrowPath);
      defs.appendChild(marker);
      svg.appendChild(defs);

      const nodeById = new Map(nodesRef.current.map((n) => [n.id, n]));
      const curveCache = new Map<string, CurveCacheEntry>();

      edges.forEach((e) => {
        const a = nodeById.get(e.from);
        const b = nodeById.get(e.to);
        if (!a || !b) return;

        const mode = edgeMode(e);
        const stroke = edgeStroke(mode);
        const width = edgeWidth(mode);

        const c = curvePath(a.x, a.y, b.x, b.y);
        curveCache.set(edgeKey(e), { a, b, c1x: c.c1x, c1y: c.c1y, c2x: c.c2x, c2y: c.c2y });

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', c.d);
        path.setAttribute('stroke', stroke);
        path.setAttribute('stroke-width', String(width));
        path.setAttribute('opacity', mode === 'default' ? '0.85' : '1');
        path.setAttribute('fill', 'none');
        path.setAttribute('marker-end', 'url(#arrow)');
        svg.appendChild(path);
      });

      pulsesRef.current.forEach((p) => {
        const c = curveCache.get(p.edgeKey);
        if (!c) return;

        const pt = bezierPoint(p.t, c.a.x, c.a.y, c.c1x, c.c1y, c.c2x, c.c2y, c.b.x, c.b.y);

        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(pt.x));
        dot.setAttribute('cy', String(pt.y));
        dot.setAttribute('r', '4.5');
        dot.setAttribute('fill', '#ffaa00');
        dot.setAttribute('opacity', '0.95');
        svg.appendChild(dot);
      });

      nodesRef.current.forEach((n) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(n.x));
        circle.setAttribute('cy', String(n.y));
        circle.setAttribute('r', '28');
        circle.setAttribute('fill', colorMap[taskStatesRef.current[n.id]] || '#444');
        circle.setAttribute('stroke', '#00f2ff');
        circle.setAttribute('stroke-width', '2');

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(n.x));
        text.setAttribute('y', String(n.y + 4));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#fff');
        text.setAttribute('font-size', '12');
        text.textContent = n.id;

        g.appendChild(circle);
        g.appendChild(text);
        svg.appendChild(g);
      });
    };

    const animate = () => {
      frameRef.current += 1;
      const nodes = nodesRef.current;

      nodes.forEach((n) => {
        const targetX = 150 + n.layer * 250;
        n.vx += (targetX - n.x) * 0.005;
      });

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const force = 2600 / (dist * dist);

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }

      edges.forEach((e) => {
        const a = nodes.find((n) => n.id === e.from);
        const b = nodes.find((n) => n.id === e.to);
        if (!a || !b) return;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;

        const desired = 220;
        const force = (dist - desired) * 0.01;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      });

      nodes.forEach((n) => {
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;

        n.y = Math.max(60, Math.min(height - 60, n.y));
        n.x = Math.max(60, Math.min(1400, n.x));
      });

      stepPulses();
      render();

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [tasks, edges]);

  return <svg ref={svgRef} width="100%" height={height} style={{ background: '#0d0d15', borderRadius: 12 }} />;
}
