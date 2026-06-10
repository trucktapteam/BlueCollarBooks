import { router } from 'expo-router';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ReactNode } from 'react';

import { businessProfile } from '@/data/mockBusiness';

type AppRoute = '/' | '/invoices' | '/expenses';
type ActiveNav = 'Dashboard' | 'Invoices' | 'Expenses';

const navItems: { label: string; route?: AppRoute }[] = [
  { label: 'Dashboard', route: '/' },
  { label: 'Invoices', route: '/invoices' },
  { label: 'Expenses', route: '/expenses' },
  { label: 'Customers' },
  { label: 'Reports' },
];

export function AppShell({ activeNav, children }: { activeNav: ActiveNav; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 900;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.appShell}>
        {showSidebar && (
          <View style={styles.sidebar}>
            <View style={styles.sidebarLogoCard}>
              <Image source={businessProfile.logo} style={styles.sidebarLogo} />
            </View>

            <View style={styles.navList}>
              {navItems.map((item) => {
                const isActive = item.label === activeNav;

                return (
                  <Pressable
                    key={item.label}
                    disabled={!item.route}
                    onPress={() => {
                      if (item.route) {
                        router.push(item.route);
                      }
                    }}
                    style={[styles.navItem, isActive && styles.navItemActive]}
                  >
                    <View style={[styles.navDot, isActive && styles.navDotActive]} />
                    <Text style={[styles.navText, isActive && styles.navTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.container, !showSidebar && styles.compactContainer]}>{children}</View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#121212',
  },
  appShell: {
    flex: 1,
    backgroundColor: '#121212',
    flexDirection: 'row',
  },
  sidebar: {
    width: 280,
    backgroundColor: '#181818',
    borderRightColor: '#2f2f2f',
    borderRightWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 36,
  },
  sidebarLogoCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: 'rgba(249, 115, 22, 0.36)',
    borderRadius: 12,
    borderWidth: 1,
    height: 78,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 6,
  },
  sidebarLogo: {
    height: 62,
    resizeMode: 'contain',
    width: '100%',
  },
  navList: {
    gap: 10,
  },
  navItem: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  navItemActive: {
    backgroundColor: '#242424',
    borderColor: '#343434',
  },
  navDot: {
    backgroundColor: '#404040',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  navDotActive: {
    backgroundColor: '#f97316',
  },
  navText: {
    color: '#a3a3a3',
    fontSize: 16,
    fontWeight: '700',
  },
  navTextActive: {
    color: '#ffffff',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 48,
    paddingVertical: 44,
  },
  container: {
    width: '100%',
    maxWidth: 1440,
  },
  compactContainer: {
    alignSelf: 'center',
  },
});
