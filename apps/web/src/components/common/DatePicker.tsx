import * as React from 'react';
import { Input } from '@/components/ui/input';
import { fromDateInputValue, toDateInputValue } from '@/lib/format';

interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** ISO string or null */
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
}

/** Native date input that speaks ISO strings. */
export const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
  ({ value, onChange, ...props }, ref) => (
    <Input
      ref={ref}
      type="date"
      value={toDateInputValue(value)}
      onChange={(e) => onChange(fromDateInputValue(e.target.value))}
      {...props}
    />
  ),
);
DatePicker.displayName = 'DatePicker';
