import React, { useEffect, useRef } from 'react';
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

export default function ExecutionGraph({ tasks, taskStates }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const animationRef = useRef<number | null>(null);

  const height = 600;

  const colorMap: Record<string, string> = {
    planned: '#444',
    pr_opened: '#00f2ff',
    running: '#ffaa00',
    blocked: '#ff4d6d',
    merged: '#00ff88'
  };

  useEffect(() => {
    if (!tasks.length) return;

    const layerMap: Record<string, number> = {};
    tasks.forEach((t) => {
      layerMap[t.id] = t.dependencies?.length ? 1 + Math.max(...t.dependencies.map((d) => layerMap[d] ?? 0)) : 0;
    });

    nodesRef.current = tasks.map((t, i) => ({
      id: t.id,
      layer: layerMap[t.id],
      x: 150 + layerMap[t.id] * 250,
      y: 150 + i * 80,
      vx: 0,
      vy: 0
    }));

    const edges = tasks.flatMap((t) => t.dependencies?.map((dep) => ({ from: dep, to: t.id })) || []);

    const animate = () => {
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

          const force = 3000 / (dist * dist);

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
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return;

        const desired = 200;
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
      });

      const svg = svgRef.current;
      if (svg) {
        svg.innerHTML = '';

        edges.forEach((e) => {
          const a = nodesRef.current.find((n) => n.id === e.from);
          const b = nodesRef.current.find((n) => n.id === e.to);
          if (!a || !b) return;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + 80} ${a.y}, ${b.x - 80} ${b.y}, ${b.x} ${b.y}`);
          path.setAttribute('stroke', '#444');
          path.setAttribute('fill', 'none');
          svg.appendChild(path);
        });

        nodesRef.current.forEach((n) => {
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', n.x.toString());
          circle.setAttribute('cy', n.y.toString());
          circle.setAttribute('r', '28');
          circle.setAttribute('fill', colorMap[taskStates[n.id]] || '#444');
          circle.setAttribute('stroke', '#00f2ff');

          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', n.x.toString());
          text.setAttribute('y', (n.y + 4).toString());
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('fill', '#fff');
          text.setAttribute('font-size', '12');
          text.textContent = n.id;

          g.appendChild(circle);
          g.appendChild(text);
          svg.appendChild(g);
        });
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [tasks, taskStates]);

  return <svg ref={svgRef} width="100%" height={height} style={{ background: '#0d0d15' }} />;
}
