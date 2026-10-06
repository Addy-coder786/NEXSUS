import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@nexus/shared';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { useForgotPassword } from '../hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/FormField';
import { applyApiErrorToForm } from '@/lib/form-errors';

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit((values) => {
    forgot.mutate(values, {
      onSuccess: () => setSentTo(values.email),
      onError: (error) => applyApiErrorToForm(error, setError),
    });
  });

  return (
    <AuthLayout
      title="Reset your password"
      description="We will email you a link to choose a new password"
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <div className="flex flex-col items-center gap-2 text-center" role="status">
          <MailCheck className="size-8 text-success" aria-hidden />
          <p className="text-[13px]">
            If an account exists for <strong>{sentTo}</strong>, a reset link is on its way. The link expires in one
            hour.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormField id="email" label="Email" error={formState.errors.email?.message}>
            <Input type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
          </FormField>
          <Button type="submit" className="w-full" loading={forgot.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
