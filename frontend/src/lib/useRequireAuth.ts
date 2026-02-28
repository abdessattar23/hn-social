'use client';
import { useEffect } from 'react';
import { useAuth } from './auth';

export function useRequireAuth() {
  const { token, ready } = useAuth();

  useEffect(() => {
    if (ready && !token) {
      window.location.href = '/login';
    }
  }, [ready, token]);

  return { token, ready, authed: ready && !!token };
}
