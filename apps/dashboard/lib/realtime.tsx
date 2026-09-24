'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useSWRConfig } from 'swr';
import { API_URL, getAccessToken, onTokenChange } from './api';
import type { RealtimeEvent } from './types';

type Listener = (event: RealtimeEvent) => void;

interface RealtimeState {
  connected: boolean;
  subscribe(listener: Listener): () => void;
}

const RealtimeContext = createContext<RealtimeState>({
  connected: false,
  subscribe: () => () => undefined,
});

function realtimeOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (explicit) return explicit;
  // Same-origin deploys (API under /api) connect to the page's own origin.
  if (API_URL.startsWith('/')) return typeof window === 'undefined' ? '' : window.location.origin;
  return API_URL;
}

// One socket per session. Every incident event revalidates the cached API
// responses it could affect, so screens stay live without refresh.
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { mutate } = useSWRConfig();
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    let socket: Socket | null = null;
    const connect = (token: string | null): void => {
      socket?.close();
      socket = null;
      setConnected(false);
      if (!token) return;
      socket = io(realtimeOrigin(), {
        path: '/realtime',
        auth: { token },
        transports: ['websocket'],
      });
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));
      socket.on('incident.event', (event: RealtimeEvent) => {
        listeners.current.forEach((l) => l(event));
        void mutate(
          (key) =>
            typeof key === 'string' &&
            (key.startsWith('/incidents') ||
              key.startsWith('/services') ||
              key.startsWith('/analytics')),
        );
      });
    };
    connect(getAccessToken());
    const off = onTokenChange(connect);
    return () => {
      off();
      socket?.close();
    };
  }, [mutate]);

  return (
    <RealtimeContext.Provider
      value={{
        connected,
        subscribe: (listener) => {
          listeners.current.add(listener);
          return () => listeners.current.delete(listener);
        },
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext);
}
