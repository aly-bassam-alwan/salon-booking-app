import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import type { TextInputProps } from 'react-native';

import { TextField } from '@/components/form';

/** A TextField wired to react-hook-form, showing the zod error message. */
export function ControlledField<T extends FieldValues>({
  control,
  name,
  label,
  ...inputProps
}: { control: Control<T>; name: Path<T>; label: string } & Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'onBlur'
>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          value={field.value ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          {...inputProps}
        />
      )}
    />
  );
}

export const emailInputProps = {
  autoCapitalize: 'none',
  autoComplete: 'email',
  autoCorrect: false,
  keyboardType: 'email-address',
  textContentType: 'emailAddress',
} as const satisfies TextInputProps;

export const newPasswordInputProps = {
  autoCapitalize: 'none',
  autoComplete: 'new-password',
  secureTextEntry: true,
  textContentType: 'newPassword',
} as const satisfies TextInputProps;
