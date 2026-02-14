import { useEffect } from 'react';

export function useAgentSocket(onCIUpdate: (data: any) => void, onPRUpdate: (data: any) => void) {
  useEffect(() => {
    const socket = new WebSocket('ws://localhost:3000');

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'ci_update') onCIUpdate(data);
      if (data.type === 'pr_update') onPRUpdate(data);
    };

    return () => socket.close();
  }, [onCIUpdate, onPRUpdate]);
}
