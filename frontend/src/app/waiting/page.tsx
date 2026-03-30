"use client";

import { useRouter } from 'next/navigation';
import WaitingRoom from '@/components/WaitingRoom';

export default function WaitingRoomPage() {
  const router = useRouter();

  return (
    <WaitingRoom onComplete={() => router.push('/admin')} />
  );
}
