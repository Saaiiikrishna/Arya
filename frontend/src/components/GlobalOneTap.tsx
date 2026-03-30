"use client";

import { useGoogleOneTapLogin } from '@react-oauth/google';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function GlobalOneTap() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  useGoogleOneTapLogin({
    disabled: isAuthenticated,
    onSuccess: async (credentialResponse) => {
      console.log('Google One Tap Success');
      try {
        if (!credentialResponse.credential) return;
        await api.googleLogin(credentialResponse.credential);
        
        // Use reload to ensure all auth headers and states are refreshed
        window.location.reload();
      } catch (e) {
        console.error('Google Auth Failed', e);
      }
    },
    onError: () => {
      console.log('Google One Tap Login Failed');
    },
    use_fedcm_for_prompt: false,
  });

  return null;
}

