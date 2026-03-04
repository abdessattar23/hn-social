'use client';
import { useEffect } from 'react';
import { useAuth } from './auth';

export function useRequireAuth() {
  const { token, ready } = useAuth();

  useEffect(() => {
    if (ready && !token) {
      const returnUrl = window.location.pathname + window.location.search;
      window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    }
  }, [ready, token]);

  return { token, ready, authed: ready && !!token };
}
