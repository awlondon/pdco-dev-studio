import React, { useMemo } from 'react';
import type { Task } from './types';

type Props = {
  tasks: Task[];
  taskStates: Record<string, string>;
};

export default function ExecutionGraph({ tasks, taskStates }: Props) {
  const positions = useMemo(() => {
    const layers: Record<string, number> = {};

    const resolveLayer = (task: Task): number => {
      if (!task.dependencies?.length) return 0;
      return 1 + Math.max(...task.dependencies.map((dep) => layers[dep] ?? 0));
    };

    tasks.forEach((task) => {
      layers[task.id] = resolveLayer(task);
    });

    const grouped: Record<number, Task[]> = {};
    tasks.forEach((task) => {
      grouped[layers[task.id]] ||= [];
      grouped[layers[task.id]].push(task);
    });

    const pos: Record<string, { x: number; y: number }> = {};
    Object.entries(grouped).forEach(([layer, layerTasks]) => {
      layerTasks.forEach((task, index) => {
        pos[task.id] = {
          x: 150 + Number(layer) * 250,
          y: 100 + index * 120
        };
      });
    });

    return pos;
  }, [tasks]);

  const colorMap: Record<string, string> = {
    planned: '#444',
    pr_opened: '#00f2ff',
    running: '#ffaa00',
    blocked: '#ff4d6d',
    merged: '#00ff88'
  };

  return (
    <svg className="agents-graph" viewBox="0 0 1200 600" role="img" aria-label="Agent execution graph">
      {tasks.flatMap((task) =>
        task.dependencies?.map((dep) => {
          const from = positions[dep];
          const to = positions[task.id];
          if (!from || !to) return null;
          return (
            <path
              key={`${dep}-${task.id}`}
              d={`M ${from.x} ${from.y} C ${from.x + 80} ${from.y}, ${to.x - 80} ${to.y}, ${to.x} ${to.y}`}
              stroke="#555"
              fill="none"
            />
          );
        }) || []
      )}

      {tasks.map((task) => {
        const point = positions[task.id];
        if (!point) {
          return null;
        }

        return (
          <g key={task.id}>
            <circle cx={point.x} cy={point.y} r={30} fill={colorMap[taskStates[task.id]] || '#444'} stroke="#00f2ff" />
            <text x={point.x} y={point.y + 4} textAnchor="middle" fill="#fff" fontSize="12">
              {task.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
