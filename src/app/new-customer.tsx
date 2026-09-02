import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { saveCustomer, useCustomers } from '@/data/mockCustomers';
import { generateId } from '@/utils/id';

export default function NewCustomerScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const searchParams = useLocalSearchParams();
  const customers = useCustomers();
  const [originalId, setOriginalId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [showSavedToast, setShowSavedToast] = useState(false);

  useEffect(() => {
    if (showSavedToast) {
      const timer = setTimeout(() => setShowSavedToast(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showSavedToast]);

  useEffect(() => {
    const customerId = typeof searchParams.customerId === 'string' ? searchParams.customerId : '';
    if (!customerId || originalId) {
      return;
    }

    const foundCustomer = customers.find((item) => item.id === customerId);

    if (foundCustomer) {
      setOriginalId(foundCustomer.id);
      setCompanyName(foundCustomer.name);
      setContactName(foundCustomer.contact);
      setEmail(foundCustomer.email);
      setPhone(foundCustomer.phone);
      setAddress(foundCustomer.address);
      setNotes(foundCustomer.notes);
    }
  }, [customers, originalId, searchParams.customerId]);

  function buildCustomerToSave() {
    return {
      id: originalId || generateId(),
      name: companyName,
      contact: contactName,
      email,
      phone,
      address,
      notes,
    };
  }

  function handleSaveCustomer() {
    saveCustomer(buildCustomerToSave(), originalId || undefined);
    router.replace('/customers');
  }

  function handleSave() {
    const customerToSave = buildCustomerToSave();
    saveCustomer(customerToSave, originalId || undefined);
    setOriginalId(customerToSave.id);
    setShowSavedToast(true);
  }

  function handleSaveAndClose() {
    saveCustomer(buildCustomerToSave(), originalId || undefined);
    router.replace('/customers');
  }

  function handleCancel() {
    router.push('/customers');
  }

  return (
    <AppShell activeNav="Customers">
      <Head>
        <title>New Customer | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {showSavedToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>Saved</Text>
        </View>
      )}
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.eyebrow}>Customers</Text>
          <Text style={[styles.heading, isCompact && styles.headingCompact]}>{originalId ? 'Edit Customer' : 'Add Customer'}</Text>
        </View>

        <Pressable style={styles.cancelTopButton} onPress={() => router.push('/customers')}>
          <Text style={styles.cancelTopButtonText}>Back to Customers</Text>
        </Pressable>
      </View>

      <View style={[styles.formCard, isCompact && styles.formCardCompact]}>
        <View style={styles.formGrid}>
          <Field label="Company Name" value={companyName} onChangeText={setCompanyName} />
          <Field label="Contact Name" value={contactName} onChangeText={setContactName} />
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </View>

        <View style={styles.wideSection}>
          <Field label="Address" value={address} onChangeText={setAddress} multiline />
        </View>

        <View style={styles.wideSection}>
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
        </View>

        <View
          style={[
            styles.bottomActionBar,
            Platform.OS === 'web' && !isCompact && styles.bottomActionBarSticky,
            isCompact && styles.bottomActionBarCompact,
          ]}
        >
          {!isCompact && (
            <View>
              <Text style={styles.actionLabel}>Customer ready.</Text>
              <Text style={styles.actionSubtext}>Ready to use for invoices and payment tracking.</Text>
            </View>
          )}

          <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
            <Pressable style={[styles.secondaryButton, isCompact && styles.actionButtonCompact]} onPress={handleCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>

            <Pressable style={[styles.primaryButton, isCompact && styles.actionButtonCompact]} onPress={handleSave}>
              <Text style={styles.primaryButtonText}>Save</Text>
            </Pressable>

            <Pressable style={[styles.secondaryButton, isCompact && styles.actionButtonCompact]} onPress={handleSaveAndClose}>
              <Text style={styles.secondaryButtonText}>Save & Go Back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        editable
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  pageHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#ff7a00',
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
  headingCompact: {
    fontSize: 24,
  },
  cancelTopButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  cancelTopButtonText: {
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
  formCardCompact: {
    padding: 16,
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  wideSection: {
    marginTop: 18,
  },
  field: {
    flexBasis: '48%',
    flexGrow: 1,
    gap: 8,
  },
  fieldLabel: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 14,
    borderWidth: 1,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multilineInput: {
    minHeight: 126,
    textAlignVertical: 'top',
  },
  bottomActionBar: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
    marginTop: 24,
    padding: 16,
  },
  bottomActionBarSticky: {
    position: 'fixed',
    left: 48,
    right: 48,
    bottom: 24,
    zIndex: 60,
  },
  bottomActionBarCompact: {
    padding: 12,
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
  actionRow: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'flex-end',
  },
  actionRowCompact: {
    flexDirection: 'column',
    width: '100%',
  },
  actionButtonCompact: {
    alignItems: 'center',
    width: '100%',
  },
  secondaryButton: {
    backgroundColor: '#2b2b2b',
    borderColor: '#3d3d3d',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#d4d4d4',
    fontSize: 16,
    fontWeight: '900',
  },
  primaryButton: {
    backgroundColor: '#ff7a00',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#ff7a00',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  primaryButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
  toast: {
    position: 'fixed',
    top: 20,
    left: '50%',
    marginLeft: -60,
    backgroundColor: '#43a047',
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
