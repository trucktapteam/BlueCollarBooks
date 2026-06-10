import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { saveCustomer } from '@/data/mockCustomers';

export default function NewCustomerScreen() {
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  function handleSaveCustomer() {
    saveCustomer({
      name: companyName,
      contact: contactName,
      email,
      phone,
      address,
      notes,
    });
    router.replace('/customers');
  }

  return (
    <AppShell activeNav="Customers">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Customers</Text>
          <Text style={styles.heading}>New Customer</Text>
        </View>

        <Pressable style={styles.cancelTopButton} onPress={() => router.push('/customers')}>
          <Text style={styles.cancelTopButtonText}>Back to customers</Text>
        </Pressable>
      </View>

      <View style={styles.formCard}>
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

        <View style={styles.bottomActionBar}>
          <View>
            <Text style={styles.actionLabel}>Customer draft ready.</Text>
            <Text style={styles.actionSubtext}>Mock-only customer list. No backend storage yet.</Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={styles.secondaryButton} onPress={() => router.push('/customers')}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>

            <Pressable style={styles.primaryButton} onPress={handleSaveCustomer}>
              <Text style={styles.primaryButtonText}>Save Customer</Text>
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
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  primaryButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
});
