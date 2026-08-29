import { useBusinessProfile } from '@/data/mockBusiness';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BrandColors } from '@/constants/theme';
const defaultLogo = require('@/assets/images/blue-collar-books-logo.jpg');

type AppRoute = '/' | '/invoices' | '/payments' | '/expenses' | '/customers' | '/reports' | '/settings';
type ActiveNav = 'Dashboard' | 'Invoices' | 'Payments' | 'Expenses' | 'Customers' | 'Reports' | 'Settings';

const navItems: { label: string; icon: string; route?: AppRoute }[] = [
  { label: 'Dashboard', icon: '💵', route: '/dashboard' },
  { label: 'Invoices', icon: '📄', route: '/invoices' },
  { label: 'Payments', icon: '✔', route: '/payments' },
  { label: 'Expenses', icon: '🧾', route: '/expenses' },
  { label: 'Customers', icon: '👤', route: '/customers' },
  { label: 'Reports', icon: '📈', route: '/reports' },
  { label: 'Settings', icon: '⚙', route: '/settings' },
];

export function AppShell({ activeNav, children }: { activeNav: ActiveNav; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const showSidebar = width >= 900;
  const profile = useBusinessProfile();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.appShell}>
        {showSidebar && (
          <View style={styles.sidebar}>
              <View style={styles.sidebarLogoCard}>
                <Image source={defaultLogo} style={styles.sidebarLogo} />
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
                    <Text style={[styles.navIcon, isActive && styles.navIconActive]}>{item.icon}</Text>
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
    backgroundColor: BrandColors.background,
  },
  appShell: {
    flex: 1,
    backgroundColor: BrandColors.background,
    flexDirection: 'row',
  },
  sidebar: {
    width: 280,
    backgroundColor: '#151515',
    borderRightColor: BrandColors.borderSubtle,
    borderRightWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 36,
  },
  sidebarLogoCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: BrandColors.orangeBorder,
    borderRadius: 18,
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
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  navItemActive: {
    backgroundColor: BrandColors.cardRaised,
    borderColor: BrandColors.orangeBorder,
    shadowColor: BrandColors.orange,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
  },
  navIcon: {
    color: BrandColors.muted,
    fontSize: 18,
    width: 24,
  },
  navIconActive: {
    color: BrandColors.orange,
  },
  navText: {
    color: BrandColors.label,
    fontSize: 16,
    fontWeight: '800',
  },
  navTextActive: {
    color: BrandColors.white,
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
