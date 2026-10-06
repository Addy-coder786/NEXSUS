import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@nexus/shared';
import { toast } from 'sonner';
import { AuthLayout } from '../components/AuthLayout';
import { OAuthButtons } from '../components/OAuthButtons';
import { useLogin, useResendVerification } from '../hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FormField } from '@/components/common/FormField';
import { applyApiErrorToForm } from '@/lib/form-errors';
import { getErrorMessage } from '@/lib/api';

export function LoginPage() {
  const location = useLocation();
  const [search] = useSearchParams();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const oauthError = search.get('error');
  const login = useLogin();
  const resend = useResendVerification();
  const [unverified, setUnverified] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });
  const { register, handleSubmit, setError, setValue, watch, formState } = form;
  const rememberMe = watch('rememberMe');

  const onSubmit = handleSubmit((values) => {
    setUnverified(false);
    login.mutate(values, {
      onError: (error) =>
        applyApiErrorToForm(error, setError, {
          onOther: (message, code) => {
            if (code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
            else setError('root', { type: 'server', message });
          },
        }),
    });
  });

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to your NEXUS workspace"
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {oauthError ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {oauthError === 'oauth_failed' ? 'Sign-in with the provider failed. Please try again.' : oauthError}
          </p>
        ) : null}
        {unverified ? (
          <div role="alert" className="rounded-md border bg-warning/15 px-3 py-2 text-[13px]">
            <p>Your email address is not verified yet. Check your inbox for the verification link.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              loading={resend.isPending}
              onClick={() =>
                resend.mutate(undefined, {
                  onSuccess: () => toast.success('Verification email sent'),
                  onError: (e) => toast.error(getErrorMessage(e)),
                })
              }
            >
              Resend verification
            </Button>
          </div>
        ) : null}
        {formState.errors.root ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {formState.errors.root.message}
          </p>
        ) : null}

        <FormField id="email" label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
        </FormField>
        <FormField id="password" label="Password" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </FormField>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="rememberMe"
              checked={rememberMe}
              onCheckedChange={(v) => setValue('rememberMe', v === true)}
            />
            <Label htmlFor="rememberMe" className="font-normal">
              Remember me
            </Label>
          </div>
          <Link to="/forgot-password" className="text-[13px] text-primary hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={login.isPending}>
          Sign in
        </Button>

        <OAuthButtons redirect={from} />
      </form>
    </AuthLayout>
  );
}
