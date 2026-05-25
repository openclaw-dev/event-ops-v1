'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2 } from 'lucide-react';

import { createOperator } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// GCC countries first, then wider MENA.
const COUNTRIES = [
  { group: 'GCC', options: [
    { value: 'AE', label: 'United Arab Emirates' },
    { value: 'SA', label: 'Saudi Arabia' },
    { value: 'KW', label: 'Kuwait' },
    { value: 'QA', label: 'Qatar' },
    { value: 'BH', label: 'Bahrain' },
    { value: 'OM', label: 'Oman' },
  ]},
  { group: 'MENA', options: [
    { value: 'JO', label: 'Jordan' },
    { value: 'LB', label: 'Lebanon' },
    { value: 'EG', label: 'Egypt' },
    { value: 'IQ', label: 'Iraq' },
    { value: 'MA', label: 'Morocco' },
    { value: 'TN', label: 'Tunisia' },
  ]},
];

const CURRENCIES = [
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'SAR', label: 'SAR — Saudi Riyal' },
  { value: 'KWD', label: 'KWD — Kuwaiti Dinar' },
  { value: 'QAR', label: 'QAR — Qatari Riyal' },
  { value: 'BHD', label: 'BHD — Bahraini Dinar' },
  { value: 'OMR', label: 'OMR — Omani Rial' },
  { value: 'USD', label: 'USD — US Dollar' },
];

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters.').max(200),
  country_code: z.string().length(2, 'Select a country.'),
  default_currency: z.string().length(3, 'Select a currency.'),
});

type FormData = z.infer<typeof schema>;

export default function OnboardingPage() {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      country_code: 'AE',
      default_currency: 'AED',
    },
  });

  async function onSubmit(data: FormData) {
    setServerError(null);
    const result = await createOperator(data);
    if (result?.error) {
      setServerError(result.error);
    }
    // On success, createOperator redirects — no further action needed here.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Set up your account</CardTitle>
              <CardDescription className="text-sm">
                Tell us about your event company.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Operator name */}
            <div className="space-y-1.5">
              <Label htmlFor="name">Company / operator name</Label>
              <Input
                id="name"
                placeholder="e.g. Coastline Events FZE"
                autoFocus
                {...register('name')}
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            {/* Country */}
            <div className="space-y-1.5">
              <Label htmlFor="country">Country</Label>
              <Select
                defaultValue="AE"
                onValueChange={(val) => setValue('country_code', val, { shouldValidate: true })}
              >
                <SelectTrigger id="country" aria-invalid={!!errors.country_code}>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map(({ group, options }) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {options.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {errors.country_code && (
                <p className="text-xs text-destructive">{errors.country_code.message}</p>
              )}
            </div>

            {/* Currency */}
            <div className="space-y-1.5">
              <Label htmlFor="currency">Default currency</Label>
              <Select
                defaultValue="AED"
                onValueChange={(val) =>
                  setValue('default_currency', val, { shouldValidate: true })
                }
              >
                <SelectTrigger id="currency" aria-invalid={!!errors.default_currency}>
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.default_currency && (
                <p className="text-xs text-destructive">{errors.default_currency.message}</p>
              )}
            </div>

            {serverError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {serverError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create operator & continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
