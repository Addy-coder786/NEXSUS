import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { resetPasswordSchema } from '@nexus/shared';
import { toast } from 'sonner';
import { AuthLayout } from '../components/AuthLayout';
import { useResetPassword } from '../hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/FormField';
import { applyApiErrorToForm } from '@/lib/form-errors';

const formSchema = resetPasswordSchema
  .pick({ password: true })
  .extend({ confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type FormValues = z.infer<typeof formSchema>;

export function ResetPasswordPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = search.get('token') ?? '';
  const reset = useResetPassword();
  const { register, handleSubmit, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = handleSubmit((values) => {
    reset.mutate(
      { token, password: values.password },
      {
        onSuccess: () => {
          toast.success('Password updated. Please sign in.');
          navigate('/login', { replace: true });
        },
        onError: (error) =>
          applyApiErrorToForm(error, setError, {
            onOther: (message) => setError('root', { type: 'server', message }),
          }),
      },
    );
  });

  if (!token) {
    return (
      <AuthLayout title="Invalid link" description="This password reset link is missing its token.">
        <Button asChild className="w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formState.errors.root ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {formState.errors.root.message}
          </p>
        ) : null}
        <FormField
          id="password"
          label="New password"
          error={formState.errors.password?.message}
          hint="At least 8 characters with upper and lower case letters and a number."
        >
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <FormField id="confirm" label="Confirm password" error={formState.errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirm')} />
        </FormField>
        <Button type="submit" className="w-full" loading={reset.isPending}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
