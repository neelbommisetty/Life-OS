'use client';

import { TRPCProvider } from '@/trpc/provider';

type Props = {
  children: React.ReactNode;
};

export function Providers({ children }: Props) {
  return <TRPCProvider>{children}</TRPCProvider>;
}

