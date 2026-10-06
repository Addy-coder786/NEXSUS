import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@nexus/shared';
import { toast } from 'sonner';
import { AuthLayout } from '../components/AuthLayout';
import { OAuthButtons } from '../components/OAuthButtons';
import { useRegister } from '../hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/FormField';
import { applyApiErrorToForm } from '@/lib/form-errors';

export function RegisterPage() {
  const navigate = useNavigate();
  const registerUser = useRegister();
  const { register, handleSubmit, setError, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) => {
    registerUser.mutate(values, {
      onSuccess: () => {
        toast.success('Account created. Check your inbox to verify your email.');
        navigate('/', { replace: true });
      },
      onError: (error) =>
        applyApiErrorToForm(error, setError, {
          onOther: (message) => setError('root', { type: 'server', message }),
        }),
    });
  });

  return (
    <AuthLayout
      title="Create your account"
      description="Start collaborating with your team in minutes"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formState.errors.root ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {formState.errors.root.message}
          </p>
        ) : null}
        <FormField id="name" label="Full name" error={formState.errors.name?.message}>
          <Input autoComplete="name" placeholder="Ada Lovelace" {...register('name')} />
        </FormField>
        <FormField id="email" label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
        </FormField>
        <FormField
          id="password"
          label="Password"
          error={formState.errors.password?.message}
          hint="At least 8 characters with upper and lower case letters and a number."
        >
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <Button type="submit" className="w-full" loading={registerUser.isPending}>
          Create account
        </Button>
        <OAuthButtons />
      </form>
    </AuthLayout>
  );
}
