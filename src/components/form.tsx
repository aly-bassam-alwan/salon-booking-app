import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Scrollable, keyboard-aware screen with a title. */
export function FormScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.content}>
              <ThemedText type="title" accessibilityRole="header">
                {title}
              </ThemedText>
              {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

type TextFieldProps = TextInputProps & { label: string; error?: string };

export function TextField({ label, error, style, ...inputProps }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, borderColor: error ? theme.danger : theme.border },
          style,
        ]}
        {...inputProps}
      />
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }} accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary
          ? { backgroundColor: theme.primary }
          : { borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
        (pressed || inactive) && styles.dimmed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? theme.onPrimary : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={{ color: isPrimary ? theme.onPrimary : theme.text }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

/** An error or success message box, announced to screen readers. */
export function FormMessage({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const theme = useTheme();
  const color = tone === 'error' ? theme.danger : tone === 'success' ? theme.success : theme.text;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.message, { borderColor: color }]}
    >
      <ThemedText style={{ color }}>{children}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth / 2,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  field: { gap: Spacing.one },
  input: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  dimmed: { opacity: 0.6 },
  message: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.three },
});
