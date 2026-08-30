import { AppShell } from '@/components/AppShell';
import { useActivities } from '@/data/activityStore';
import { signOut, useSession } from '@/data/authStore';
import { useBankAccounts } from '@/data/mockBankAccounts';
import { type BusinessSettings, saveBusinessProfile, useBusinessProfile } from '@/data/mockBusiness';
import { addCategory, deleteCategory, useCategories } from '@/data/mockCategories';
import { useCustomers } from '@/data/mockCustomers';
import { useExpenses } from '@/data/mockExpenses';
import { useInvoices } from '@/data/mockInvoices';
import { useSubscription } from '@/data/subscriptionStore';
import { downloadBlob } from '@/utils/downloadFile';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const subscriptionStatusLabels: Record<string, string> = {
  trialing: 'Free trial active',
  active: 'Active — $20/month',
  past_due: 'Payment failed — update your card',
  canceled: 'Canceled',
  unpaid: 'Unpaid',
  none: 'No subscription',
};

function stripObjectUrl<T extends { objectUrl?: string }>({ objectUrl, ...rest }: T) {
  return rest;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
  downloadBlob(filename, blob);
}

const termOptions = ['Net 15', 'Net 30', 'Due on Receipt', 'Custom'] as const;
type TermOption = (typeof termOptions)[number];

function getTermOption(value?: string): TermOption {
  if (value === 'Net 15' || value === 'Net 30' || value === 'Due on Receipt') {
    return value;
  }
  return 'Custom';
}

export default function SettingsScreen() {
  const profile = useBusinessProfile();
  const categories = useCategories();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const customers = useCustomers();
  const invoices = useInvoices();
  const expenses = useExpenses();
  const bankAccounts = useBankAccounts();
  const activities = useActivities();
  const session = useSession();
  const subscription = useSubscription();
  const [isManagingSubscription, setIsManagingSubscription] = useState(false);
  const [businessName, setBusinessName] = useState(profile.businessName || '');
  const [contactName, setContactName] = useState(profile.contactName || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [email, setEmail] = useState(profile.email || '');
  const [website, setWebsite] = useState(profile.website || '');
  const [street, setStreet] = useState(profile.street || profile.address || '');
  const [city, setCity] = useState(profile.city || '');
  const [state, setState] = useState(profile.state || '');
  const [zip, setZip] = useState(profile.zip || '');
  const [selectedTerms, setSelectedTerms] = useState<TermOption>(() => getTermOption(profile.defaultPaymentTerms));
  const [customTerms, setCustomTerms] = useState(
    getTermOption(profile.defaultPaymentTerms) === 'Custom' ? profile.defaultPaymentTerms || '' : ''
  );
  const [invoiceNotes, setInvoiceNotes] = useState(profile.invoiceNotes || '');
  const [paymentInstructions, setPaymentInstructions] = useState(profile.paymentInstructions || '');
  const [showSavedToast, setShowSavedToast] = useState(false);

  const logoSource = useMemo(() => {
    if (profile.logoDataUrl) {
      return { uri: profile.logoDataUrl };
    }
    return profile.logoModule;
  }, [profile.logoDataUrl, profile.logoModule]);

  useEffect(() => {
    if (showSavedToast) {
      const timer = setTimeout(() => setShowSavedToast(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showSavedToast]);

  function getDefaultTerms() {
    return selectedTerms === 'Custom' ? customTerms.trim() : selectedTerms;
  }

  function handleSave() {
    const address = [street, [city, state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

    saveBusinessProfile({
      businessName,
      contactName,
      phone,
      email,
      website,
      street,
      city,
      state,
      zip,
      address,
      defaultPaymentTerms: getDefaultTerms(),
      invoiceNotes,
      paymentInstructions,
    });
    setShowSavedToast(true);
  }

  function handleBackupAllData() {
    const businessSettings: BusinessSettings = {
      businessName: profile.businessName,
      contactName: profile.contactName,
      address: profile.address,
      street: profile.street,
      city: profile.city,
      state: profile.state,
      zip: profile.zip,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      defaultPaymentTerms: profile.defaultPaymentTerms,
      invoiceNotes: profile.invoiceNotes,
      paymentInstructions: profile.paymentInstructions,
      startingInvoiceNumber: profile.startingInvoiceNumber,
      logoDataUrl: profile.logoDataUrl ?? null,
    };

    const backup = {
      exportedAt: new Date().toISOString(),
      version: 1,
      businessSettings,
      customers,
      // line items and payments are nested inside each invoice, matching how they're actually stored
      invoices: invoices.map((invoice) => ({
        ...invoice,
        attachments: invoice.attachments?.map(stripObjectUrl),
      })),
      expenses: expenses.map((expense) =>
        expense.receipt ? { ...expense, receipt: stripObjectUrl(expense.receipt) } : expense
      ),
      bankAccounts,
      activityLog: activities,
    };

    downloadJson(`bcb-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
  }

  function handleSignOut() {
    signOut();
    router.replace('/login');
  }

  async function handleManageSubscription() {
    setIsManagingSubscription(true);
    try {
      const token = session?.access_token;
      if (!token) {
        throw new Error('You need to be signed in.');
      }

      const response = await fetch('/api/create-portal-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok || !body.url) {
        throw new Error(body.error ?? 'Could not open subscription management.');
      }

      window.location.href = body.url;
    } catch (error) {
      // Rare enough (only fires if the portal call itself fails, e.g. no
      // customer on file yet) that a console log plus resetting the button
      // is enough - no dedicated error UI for this one card.
      console.error('Failed to open subscription portal', error);
      setIsManagingSubscription(false);
    }
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

  function handleRemoveLogo() {
    saveBusinessProfile({ logoDataUrl: null });
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setIsAddingCategory(true);
    try {
      await addCategory(name);
      setNewCategoryName('');
    } finally {
      setIsAddingCategory(false);
    }
  }

  async function handleDeleteCategory(categoryId: string) {
    setDeletingCategoryId(categoryId);
    try {
      await deleteCategory(categoryId);
    } finally {
      setDeletingCategoryId(null);
    }
  }

  return (
    <AppShell activeNav="Settings">
      <Head>
        <title>Settings | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {showSavedToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>Saved</Text>
        </View>
      )}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Settings</Text>
          <Text style={styles.heading}>Business Profile</Text>
        </View>

        <Pressable style={styles.backButton} onPress={() => router.push('/dashboard')}>
          <Text style={styles.backButtonText}>Back to dashboard</Text>
        </Pressable>
      </View>

      <View style={styles.settingsStack}>
        <SettingsCard title="Business Information">
          <View style={styles.fieldRow}>
            <Field label="Business Name" value={businessName} onChangeText={setBusinessName} />
            <Field label="Contact Name" value={contactName} onChangeText={setContactName} />
          </View>
          <View style={styles.fieldRow}>
            <Field label="Phone Number" value={phone} onChangeText={setPhone} />
            <Field label="Email Address" value={email} onChangeText={setEmail} />
          </View>
          <View style={styles.fieldRow}>
            <Field label="Website (optional)" value={website} onChangeText={setWebsite} />
          </View>
        </SettingsCard>

        <SettingsCard title="Address">
          <View style={styles.fieldRow}>
            <Field label="Street" value={street} onChangeText={setStreet} />
          </View>
          <View style={styles.fieldRow}>
            <Field label="City" value={city} onChangeText={setCity} />
            <Field label="State" value={state} onChangeText={setState} />
            <Field label="ZIP" value={zip} onChangeText={setZip} />
          </View>
        </SettingsCard>

        <SettingsCard title="Branding">
          <View style={styles.logoRow}>
            <View style={styles.logoPreviewCard}>
              <Image source={logoSource} style={styles.logoImage} />
            </View>

            <View style={styles.logoControls}>
              <Text style={styles.fieldLabel}>Upload Logo</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event: any) => handleLogoUpload(event.target.files && event.target.files[0])}
                />
              ) : (
                <Text style={styles.helperText}>Logo upload is available on web only.</Text>
              )}

              <Pressable
                disabled={!profile.logoDataUrl}
                style={[styles.secondaryButton, !profile.logoDataUrl && styles.disabledButton]}
                onPress={handleRemoveLogo}
              >
                <Text style={[styles.secondaryButtonText, !profile.logoDataUrl && styles.disabledButtonText]}>
                  Remove Logo
                </Text>
              </Pressable>
            </View>
          </View>
        </SettingsCard>

        <SettingsCard title="Invoice Defaults">
          <View style={styles.termsGrid}>
            {termOptions.map((option) => {
              const isActive = selectedTerms === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.termChip, isActive && styles.termChipActive]}
                  onPress={() => setSelectedTerms(option)}
                >
                  <Text style={[styles.termChipText, isActive && styles.termChipTextActive]}>{option}</Text>
                </Pressable>
              );
            })}
          </View>

          {selectedTerms === 'Custom' && (
            <View style={styles.singleFieldSpacing}>
              <Field label="Custom Terms" value={customTerms} onChangeText={setCustomTerms} />
            </View>
          )}

          <View style={styles.fieldRow}>
            <Field label="Invoice Notes" value={invoiceNotes} onChangeText={setInvoiceNotes} multiline />
            <Field
              label="Payment Instructions"
              value={paymentInstructions}
              onChangeText={setPaymentInstructions}
              multiline
            />
          </View>
        </SettingsCard>

        <SettingsCard title="Expense Categories">
          <Text style={styles.helperText}>
            These show up as the Type options when adding an expense or categorizing a bank transaction. Remove one
            any time - it won't touch expenses that already used it.
          </Text>

          <View style={styles.categoryChipGrid}>
            {categories.map((category) => (
              <View key={category.id} style={styles.categoryChipRow}>
                <Text style={styles.categoryChipRowText}>{category.name}</Text>
                <Pressable
                  disabled={deletingCategoryId === category.id}
                  onPress={() => handleDeleteCategory(category.id)}
                  style={styles.categoryChipRemove}
                >
                  <Text style={styles.categoryChipRemoveText}>
                    {deletingCategoryId === category.id ? '…' : '×'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View style={styles.addCategoryRow}>
            <TextInput
              style={styles.addCategoryInput}
              placeholder="Add a category (e.g. Equipment)"
              placeholderTextColor="#6b6b6b"
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              onSubmitEditing={handleAddCategory}
            />
            <Pressable
              style={styles.secondaryButton}
              onPress={handleAddCategory}
              disabled={isAddingCategory || !newCategoryName.trim()}
            >
              <Text style={styles.secondaryButtonText}>{isAddingCategory ? 'Adding...' : 'Add Category'}</Text>
            </Pressable>
          </View>
        </SettingsCard>

        <SettingsCard title="Subscription">
          <Text style={styles.helperText}>
            {subscriptionStatusLabels[subscription?.status ?? 'none'] ?? 'No subscription'}
            {subscription?.status === 'trialing' && subscription.trialEnd
              ? ` — trial ends ${new Date(subscription.trialEnd).toLocaleDateString()}`
              : ''}
          </Text>
          <Pressable
            style={[styles.secondaryButton, isManagingSubscription && styles.disabledButton]}
            onPress={handleManageSubscription}
            disabled={isManagingSubscription}
          >
            <Text style={styles.secondaryButtonText}>
              {isManagingSubscription ? 'Opening...' : 'Manage Subscription'}
            </Text>
          </Pressable>
        </SettingsCard>

        <SettingsCard title="Backup">
          <Text style={styles.helperText}>
            Download every customer, invoice, line item, payment, expense, and business setting as one JSON file you
            can keep as a safety copy.
          </Text>
          <Pressable style={styles.secondaryButton} onPress={handleBackupAllData}>
            <Text style={styles.secondaryButtonText}>Backup All Data</Text>
          </Pressable>
        </SettingsCard>

        <View style={styles.actionBar}>
          <View>
            <Text style={styles.actionLabel}>Business profile</Text>
            <Text style={styles.actionSubtext}>Changes save to your account and flow into invoices.</Text>
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

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.settingsCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.cardContent}>{children}</View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldCol}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
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
  settingsStack: {
    gap: 22,
    paddingBottom: 36,
  },
  settingsCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    padding: 28,
  },
  cardTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  cardContent: {
    gap: 14,
    marginTop: 18,
  },
  fieldRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  fieldCol: {
    flexBasis: '31%',
    flexGrow: 1,
    gap: 8,
  },
  fieldLabel: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '800',
  },
  helperText: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '600',
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
    minHeight: 118,
    textAlignVertical: 'top',
  },
  logoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  logoPreviewCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: 'rgba(255, 122, 0, 0.36)',
    borderRadius: 14,
    borderWidth: 1,
    height: 120,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 8,
    width: 160,
  },
  logoImage: {
    height: '100%',
    resizeMode: 'contain',
    width: '100%',
  },
  logoControls: {
    flex: 1,
    gap: 12,
    minWidth: 240,
  },
  termsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  termChip: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  termChipActive: {
    backgroundColor: 'rgba(255, 122, 0, 0.14)',
    borderColor: 'rgba(255, 122, 0, 0.45)',
  },
  termChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  termChipTextActive: {
    color: '#ff7a00',
  },
  singleFieldSpacing: {
    marginTop: 4,
  },
  categoryChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChipRow: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 6,
    paddingLeft: 14,
    paddingVertical: 6,
  },
  categoryChipRowText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  categoryChipRemove: {
    alignItems: 'center',
    backgroundColor: '#333333',
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  categoryChipRemoveText: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 16,
  },
  addCategoryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  addCategoryInput: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 14,
    borderWidth: 1,
    color: '#ffffff',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 200,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionBar: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#323232',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'space-between',
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
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-end',
  },
  primaryButton: {
    backgroundColor: '#ff7a00',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  secondaryButtonText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.45,
  },
  disabledButtonText: {
    color: '#8c8c8c',
  },
  signOutButton: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  signOutText: {
    color: '#d4d4d4',
    fontSize: 15,
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
