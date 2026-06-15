import { AppShell } from '@/components/AppShell';
import { saveBusinessProfile, useBusinessProfile } from '@/data/mockBusiness';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function SettingsScreen() {
  const profile = useBusinessProfile();
  const [businessName, setBusinessName] = useState(profile.businessName || '');
  const [contactName, setContactName] = useState(profile.contactName || '');
  const [address, setAddress] = useState(profile.address || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [email, setEmail] = useState(profile.email || '');
  const [website, setWebsite] = useState(profile.website || '');
  const [defaultPaymentTerms, setDefaultPaymentTerms] = useState(profile.defaultPaymentTerms || '');
  const [startingInvoiceNumber, setStartingInvoiceNumber] = useState(profile.startingInvoiceNumber || '');
  const [showSavedToast, setShowSavedToast] = useState(false);

  useEffect(() => {
    if (showSavedToast) {
      const timer = setTimeout(() => setShowSavedToast(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showSavedToast]);

  function handleSave() {
    saveBusinessProfile({
      businessName,
      contactName,
      address,
      phone,
      email,
      website,
      defaultPaymentTerms,
      startingInvoiceNumber,
    });
    setShowSavedToast(true);
  }

  function handleSignOut() {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('bcb_dev_logged_in');
      }
    } catch {
      // ignore
    }

    router.replace('/login');
  }

  function handleLogoUpload(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string | null;
      if (result) {
        saveBusinessProfile({ logoDataUrl: result });
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <AppShell activeNav="Settings">
      {showSavedToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>Saved</Text>
        </View>
      )}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Settings</Text>
          <Text style={styles.heading}>Business Settings</Text>
        </View>

        <Pressable style={styles.backButton} onPress={() => router.push('/')}>
          <Text style={styles.backButtonText}>Back to dashboard</Text>
        </Pressable>
      </View>

      <View style={styles.formCard}>
        <View style={styles.logoRow}>
          <View style={styles.logoPreviewCard}>
            {profile.logoDataUrl ? (
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore allow web uri
              <Image source={{ uri: profile.logoDataUrl }} style={styles.logoImage} />
            ) : (
              <Image source={profile.logoModule} style={styles.logoImage} />
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Logo</Text>
            {Platform.OS === 'web' ? (
              <input
                type="file"
                accept="image/*"
                onChange={(e: any) => handleLogoUpload(e.target.files && e.target.files[0])}
              />
            ) : (
              <Text style={styles.fieldLabel}>Logo upload is available on web only.</Text>
            )}
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Business Name</Text>
            <TextInput style={styles.input} value={businessName} onChangeText={setBusinessName} />
          </View>

          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Contact Name</Text>
            <TextInput style={styles.input} value={contactName} onChangeText={setContactName} />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput style={styles.input} value={address} onChangeText={setAddress} />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} />
          </View>

          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Website</Text>
            <TextInput style={styles.input} value={website} onChangeText={setWebsite} />
          </View>

          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Default Payment Terms</Text>
            <TextInput style={styles.input} value={defaultPaymentTerms} onChangeText={setDefaultPaymentTerms} />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Starting Invoice Number</Text>
            <TextInput style={styles.input} value={startingInvoiceNumber} onChangeText={setStartingInvoiceNumber} />
          </View>
        </View>

        <View style={[styles.bottomActionBar, Platform.OS === 'web' && styles.bottomActionBarSticky]}>
          <View>
            <Text style={styles.actionLabel}>Business settings</Text>
            <Text style={styles.actionSubtext}>Changes saved locally.</Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={styles.primaryButton} onPress={handleSave}>
              <Text style={styles.primaryButtonText}>Save Settings</Text>
            </Pressable>
            <Pressable style={styles.signOutButton} onPress={handleSignOut}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  eyebrow: {
    color: '#f97316',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  heading: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
  },
  backButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  backButtonText: {
    color: '#d4d4d4',
    fontSize: 15,
    fontWeight: '800',
  },
  formCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    padding: 28,
  },
  logoRow: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  logoPreviewCard: {
    width: 120,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  fieldCol: { flex: 1 },
  fieldLabel: { color: '#a3a3a3', fontSize: 13, fontWeight: '800', marginBottom: 6 },
  input: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 10,
    borderWidth: 1,
    color: '#ffffff',
    padding: 12,
  },
  actionRow: { marginTop: 18, flexDirection: 'row', justifyContent: 'flex-end' },
  primaryButton: {
    backgroundColor: '#f97316',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: { color: '#fff', fontWeight: '800' },
  signOutButton: {
    marginLeft: 12,
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  signOutText: { color: '#d4d4d4', fontWeight: '800' },
  bottomActionBar: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#323232',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    marginTop: 24,
    padding: 16,
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  actionSubtext: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
  bottomActionBarSticky: {
    position: 'fixed',
    left: 48,
    right: 48,
    bottom: 24,
    zIndex: 60,
  },
  toast: {
    position: 'fixed',
    top: 20,
    left: '50%',
    marginLeft: -60,
    backgroundColor: '#22c55e',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 100,
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
