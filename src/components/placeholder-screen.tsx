import { FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';

/** Temporary content for screens built in later phases. */
export function PlaceholderScreen({ title, phase }: { title: string; phase: string }) {
  return (
    <FormScreen title={title}>
      <ThemedText themeColor="textSecondary">Coming in {phase}.</ThemedText>
    </FormScreen>
  );
}
