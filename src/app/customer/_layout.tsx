import { Tabs } from 'expo-router';

export default function CustomerLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Book' }} />
      <Tabs.Screen name="appointments" options={{ title: 'My appointments' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
