"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BookingsLiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      router.refresh();
    }, 2000);

    return () => {
      window.clearInterval(refreshTimer);
    };
  }, [router]);

  return null;
}