'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Backdrop } from '@/components/backdrop';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
    setBusy(false);
    if (error) return setError(error.message ?? 'Could not send the code');
    setStep('otp');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.emailOtp({ email, otp });
    setBusy(false);
    if (error) return setError(error.message ?? 'Wrong or expired code');
    router.push('/');
  }

  return (
    <main className="flex min-h-svh flex-col justify-end p-4 pb-[max(4rem,env(safe-area-inset-bottom))] md:justify-center md:px-[120px] md:py-10">
      <Backdrop photo="winterSun" wash="linear-gradient(180deg, rgb(11 26 51 / 0) 0%, rgb(11 26 51 / 0.15) 100%)" caption />
      <div className="glass w-full rounded-[36px] p-7 md:max-w-[440px] md:rounded-[40px] md:p-11">
        <div className="flex flex-col gap-4 md:gap-5">
          <Image src="/alversjo-logo.png" alt="Alversjö" width={88} height={88} priority className="size-14 md:size-[88px]" />
          <h1 className="font-serif text-[32px] leading-[1.1] font-bold text-ink md:text-[40px]">
            {step === 'email' ? 'Welcome to Alversjö' : 'Check your email'}
          </h1>
          <p className="text-[15px] leading-normal text-ink-soft md:text-base">
            {step === 'email'
              ? 'A place for co-creation and exploration, in close collaboration with nature and wildlife.'
              : <>We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>. It works for 5 minutes.</>}
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {step === 'email' ? (
            <form onSubmit={sendCode} className="flex flex-col gap-4 md:gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" placeholder="you@example.org" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</Button>
              <p className="text-sm text-ink-soft">We send you a 6-digit code. There’s no password to remember.</p>
            </form>
          ) : (
            <form onSubmit={verify} className="flex flex-col gap-4 md:gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="otp">Code</Label>
                <Input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="123456" required autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} className="tabular tracking-[0.3em]" />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={busy}>Sign in</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => { setError(null); setOtp(''); setStep('email'); }}>Use another email</Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
