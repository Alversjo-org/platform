'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-renders the current page from the server every few seconds while it's on screen. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
