import { Asset } from 'expo-asset';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardTypeOptions } from 'react-native';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppShell } from '@/components/AppShell';
import { formatBusinessAddress, useBusinessProfile } from '@/data/mockBusiness';
import { type Customer, useCustomers } from '@/data/mockCustomers';
import {
  type Invoice,
  invoiceDraft,
  invoiceLabels,
  type InvoiceLineItem,
  invoiceLineItems,
  type InvoiceStatus,
  invoiceStatuses,
  saveInvoice,
  useInvoices,
} from '@/data/mockInvoices';
import { generateId } from '@/utils/id';
import { formatMoneyCents, parseMoneyInputToCents } from '@/utils/money';
import { formatDateDisplay, formatDueDateDisplay, normalizeDateToISO, toISODateString } from '@/utils/date';

const blueCollarBooksLogo = require('@/assets/images/blue-collar-books-logo.jpg');

// The line-item form fields bind to raw typed text (e.g. "$625" or "625.50")
// rather than the stored cents number, so someone can type freely without the
// field reformatting itself on every keystroke. Amounts convert to/from cents
// only at the form boundary (loading an existing invoice, and saving).
type LineItemDraft = { id: string; description: string; amount: string };

function toLineItemDrafts(items: InvoiceLineItem[]): LineItemDraft[] {
  return items.map((item) => ({ id: item.id, description: item.description, amount: formatMoneyCents(item.amount) }));
}

// The very first invoice for a new account starts from the business's own
// configured starting number (Settings > starting invoice number, default
// 1000) rather than a hardcoded demo value - every invoice after that just
// increments off the highest existing number.
function getNextInvoiceNumber(invoices: Invoice[], startingInvoiceNumber?: string) {
    const numericValues = invoices
        .map((invoice) => Number(invoice.invoice.replace(/\D/g, '')))
        .filter((value) => Number.isFinite(value) && value > 0);

    const nextNumber = numericValues.length
      ? Math.max(...numericValues) + 1
      : Number(startingInvoiceNumber) || 1000;
    return String(nextNumber);
}

export default function NewInvoiceScreen() {
  const { width } = useWindowDimensions();
  const profile = useBusinessProfile();
  const businessLogoUri =
    profile.logoDataUrl ?? (profile.logoModule ? Asset.fromModule(profile.logoModule).uri : '');
  const watermarkLogoUri = Asset.fromModule(blueCollarBooksLogo).uri;
  const searchParams = useLocalSearchParams();
  const customers = useCustomers();
  const invoices = useInvoices();
  const [originalInvoiceId, setOriginalInvoiceId] = useState<string | undefined>(undefined);
  // Permanent identity for this invoice record, separate from the editable
  // invoice number below. A brand-new invoice gets one right away; if this
  // screen is editing an existing invoice, the effect below overwrites it
  // with that invoice's real id once it's found.
  const [recordId, setRecordId] = useState(() => generateId());
  const [number, setNumber] = useState(() => getNextInvoiceNumber(invoices, profile.startingInvoiceNumber));
  const [date, setDate] = useState(() => formatDateDisplay(toISODateString(new Date())));
  const [terms, setTerms] = useState(() => profile.defaultPaymentTerms || invoiceDraft.terms);
  const [customer, setCustomer] = useState(invoiceDraft.customer);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [poNumber, setPoNumber] = useState(invoiceDraft.poNumber);
  const [bolNumber, setBolNumber] = useState(invoiceDraft.bolNumber);
  const [shipper, setShipper] = useState(invoiceDraft.shipper);
  const [consignee, setConsignee] = useState(invoiceDraft.consignee);
  const [freightDescription, setFreightDescription] = useState(invoiceDraft.freightDescription);
  const [status, setStatus] = useState<InvoiceStatus>('Draft');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>(() => toLineItemDrafts(invoiceLineItems));
  const [showSavedToast, setShowSavedToast] = useState(false);
  const showSideActions = Platform.OS === 'web' && width >= 1100;

  useEffect(() => {
    if (showSavedToast) {
      const timer = setTimeout(() => setShowSavedToast(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showSavedToast]);
  const invoiceTotalCents = useMemo(
    () => lineItems.reduce((total, item) => total + parseMoneyInputToCents(item.amount), 0),
    [lineItems]
  );
  const invoiceTotalDisplay = formatMoneyCents(invoiceTotalCents);

  function updateLineItem(index: number, field: 'description' | 'amount', value: string) {
    setLineItems((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  function handleAddLineItem() {
    setLineItems((items) => [...items, { id: generateId(), description: '', amount: '$0' }]);
  }

  function handleRemoveLineItem(index: number) {
    setLineItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  const invoiceIdParam = typeof searchParams.invoiceId === 'string' ? searchParams.invoiceId : '';
  const preselectedCustomerId =
    typeof searchParams.customerId === 'string' ? searchParams.customerId : '';

  const selectedCustomer = useMemo(
    () => customers.find((item) => item.id === selectedCustomerId),
    [customers, selectedCustomerId]
  );

  useEffect(() => {
    if (invoiceIdParam && !originalInvoiceId) {
      const foundInvoice = invoices.find((item) => item.id === invoiceIdParam);

      if (foundInvoice) {
        setOriginalInvoiceId(foundInvoice.id);
        setRecordId(foundInvoice.id);
        setNumber(foundInvoice.invoice);
        setDate(formatDateDisplay(foundInvoice.invoiceDate));
        setTerms(foundInvoice.terms ?? profile.defaultPaymentTerms ?? invoiceDraft.terms);
        setCustomer(foundInvoice.customer);
        // Prefer the durable link; fall back to a name match for invoices saved
        // before customerId existed so the dropdown still preselects correctly.
        setSelectedCustomerId(
          foundInvoice.customerId ?? customers.find((item) => item.name === foundInvoice.customer)?.id ?? ''
        );
        setPoNumber(foundInvoice.poNumber ?? invoiceDraft.poNumber);
        setBolNumber(foundInvoice.bolNumber ?? invoiceDraft.bolNumber);
        setShipper(foundInvoice.shipper ?? invoiceDraft.shipper);
        setConsignee(foundInvoice.consignee ?? invoiceDraft.consignee);
        setFreightDescription(foundInvoice.freightDescription ?? invoiceDraft.freightDescription);
        setStatus(foundInvoice.status);
        setLineItems(toLineItemDrafts(foundInvoice.lineItems ?? invoiceLineItems));
      }
      return;
    }

    if (!preselectedCustomerId || selectedCustomerId) {
      return;
    }

    const foundCustomer = customers.find((item) => item.id === preselectedCustomerId);

    if (foundCustomer) {
      handleSelectCustomer(foundCustomer);
    }
  }, [
    customers,
    invoices,
    invoiceIdParam,
    originalInvoiceId,
    preselectedCustomerId,
    profile.defaultPaymentTerms,
    selectedCustomerId,
  ]);

  function handleSelectCustomer(selectedCustomer: Customer) {
    setSelectedCustomerId(selectedCustomer.id);
    setCustomer(selectedCustomer.name);
    setConsignee(selectedCustomer.address);
  }

  function handleSelectExistingCustomer(selectedCustomer: Customer) {
    setIsCustomerDropdownOpen(false);
    handleSelectCustomer(selectedCustomer);
  }

  function handleSelectManualEntry() {
    setIsCustomerDropdownOpen(false);
    setSelectedCustomerId('');
    setCustomer('');
    setConsignee('');
  }

  function handleAddNewCustomerOption() {
    setIsCustomerDropdownOpen(false);
    router.push('/new-customer');
  }

  function handleCustomerNameChange(value: string) {
    setCustomer(value);
    setSelectedCustomerId('');
  }

  function buildLineItemsForSave(): InvoiceLineItem[] {
    return lineItems.map((item) => ({
      id: item.id,
      description: item.description,
      amount: parseMoneyInputToCents(item.amount),
    }));
  }

  function handleSave() {
    saveInvoice(
      {
        id: recordId,
        invoice: number,
        customer: customer.trim(),
        customerId: selectedCustomer?.id,
        amount: invoiceTotalCents,
        status,
        invoiceDate: normalizeDateToISO(date),
        poNumber,
        bolNumber,
        shipper,
        consignee,
        freightDescription,
        lineItems: buildLineItemsForSave(),
      },
      originalInvoiceId
    );
    setOriginalInvoiceId(recordId);
    setShowSavedToast(true);
  }

  function handleSaveAndClose() {
    saveInvoice(
      {
        id: recordId,
        invoice: number,
        customer: customer.trim(),
        customerId: selectedCustomer?.id,
        amount: invoiceTotalCents,
        status,
        invoiceDate: normalizeDateToISO(date),
        poNumber,
        bolNumber,
        shipper,
        consignee,
        freightDescription,
        lineItems: buildLineItemsForSave(),
      },
      originalInvoiceId
    );
    router.replace('/invoices');
  }

  function buildCurrentInvoiceHtml() {
    return buildInvoiceTemplate({
      businessLogoUri,
      watermarkLogoUri,
      businessName: profile.businessName,
      businessContactName: profile.contactName ?? '',
      businessAddress: formatBusinessAddress(profile),
      businessPhone: profile.phone ?? '',
      businessEmail: profile.email ?? '',
      businessWebsite: profile.website ?? '',
      number,
      date,
      terms,
      customer,
      poNumber,
      bolNumber,
      shipper,
      consignee,
      freightDescription,
      lineItems,
      invoiceTotal: invoiceTotalDisplay,
      customerEmail: selectedCustomer?.email ?? '',
      invoiceNotes: profile.invoiceNotes ?? '',
      paymentInstructions: profile.paymentInstructions ?? '',
    });
  }

  const previewPdf = () => {
    if (Platform.OS !== 'web') return;

    // Open HTML invoice in a new tab
    const blob = new Blob([buildCurrentInvoiceHtml()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const printPdf = () => {
    if (Platform.OS !== 'web') return;

    // Open HTML invoice in a new tab and trigger print
    const blob = new Blob([buildCurrentInvoiceHtml()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const newWindow = window.open(url, '_blank');
    if (newWindow) {
      newWindow.addEventListener('load', () => {
        newWindow.print();
      });
    }
  };

  function buildInvoiceDueDate() {
    return formatDueDateDisplay(date, terms) || date;
  }

  function buildInvoiceMailto() {
    const customerEmail = selectedCustomer?.email;
    if (!customerEmail) return null;

    const subject = `Invoice #${number} from ${profile.businessName}`;
    const bodyLines = [
      `Hello ${customer},`,
      '',
      `Please find invoice #${number} for ${invoiceTotalDisplay}.`,
      `Due date: ${buildInvoiceDueDate()}`,
      ...(profile.paymentInstructions ? ['', profile.paymentInstructions] : []),
      ...(profile.invoiceNotes ? ['', profile.invoiceNotes] : []),
      '',
      `Thank you for your business.`,
      profile.businessName,
    ];
    const body = encodeURIComponent(bodyLines.join('\n'));
    return `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(subject)}&body=${body}`;
  }

  function emailInvoice() {
    const href = buildInvoiceMailto();
    if (!href) return;
    Linking.openURL(href).catch(() => {
      // ignore unsupported environments
    });
  }

  const invoiceActionsCard = (
    <View style={[styles.actionsCard, showSideActions && styles.actionsCardSticky]}>
      <View style={styles.actionsCardHeader}>
        <Text style={styles.actionsCardTitle}>Get Paid Tools</Text>
        <Text style={styles.actionsCardMeta}>Total {invoiceTotalDisplay}</Text>
      </View>

      <View style={styles.actionGroup}>
        <Text style={styles.actionGroupLabel}>Save Work</Text>
        <Pressable style={[styles.primaryButton, styles.panelActionButton]} onPress={handleSave}>
          <Text style={styles.primaryButtonText}>Save</Text>
        </Pressable>
        <Pressable style={[styles.primaryButton, styles.panelActionButton]} onPress={handleSaveAndClose}>
          <Text style={styles.primaryButtonText}>Save & Go Back</Text>
        </Pressable>
      </View>

      <View style={styles.actionGroup}>
        <Text style={styles.actionGroupLabel}>Send / Print</Text>
        <Pressable style={[styles.previewButton, styles.panelActionButton]} onPress={previewPdf}>
          <Text style={styles.previewButtonText}>Preview Invoice</Text>
        </Pressable>
        <Pressable
          disabled={!selectedCustomer?.email}
          style={[styles.emailButton, styles.panelActionButton, !selectedCustomer?.email && styles.emailButtonDisabled]}
          onPress={emailInvoice}
        >
          <Text style={[styles.emailButtonText, !selectedCustomer?.email && styles.emailButtonTextDisabled]}>
            {selectedCustomer?.email ? 'Email Invoice' : 'Add customer email first'}
          </Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, styles.panelActionButton]} onPress={printPdf}>
          <Text style={styles.secondaryButtonText}>Print</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <AppShell activeNav="Invoices">
      <Head>
        <title>New Invoice | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {showSavedToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>Saved</Text>
        </View>
      )}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Invoices</Text>
          <Text style={styles.heading}>{originalInvoiceId ? 'Edit Invoice' : 'Make Invoice'}</Text>
        </View>

        <Pressable style={styles.backButton} onPress={() => router.push('/invoices')}>
          <Text style={styles.backButtonText}>Back to Invoices</Text>
        </Pressable>
      </View>

      <View style={[styles.invoiceLayout, showSideActions && styles.invoiceLayoutDesktop]}>
        <View style={styles.invoiceFormColumn}>
          <View style={styles.formCard}>
                <View style={styles.compactRow}>
                <Field label="Invoice #" value={number} onChangeText={setNumber} />
                <Field label="Invoice Date" value={date} onChangeText={setDate} />
                <Field label="Terms" value={terms} onChangeText={setTerms} />
              </View>

              <View style={styles.customerRow}>
                <Field label="Customer" value={customer} onChangeText={handleCustomerNameChange} />
              </View>

              <View style={styles.customerSelectorSection}>
                <Text style={styles.fieldLabel}>Saved customer</Text>
                <Pressable style={styles.customerDropdown} onPress={() => setIsCustomerDropdownOpen((open) => !open)}>
                  <Text style={styles.customerDropdownText}>
                    {selectedCustomer?.name || customer || 'Pick a customer or type one in'}
                  </Text>
                  <Text style={styles.customerDropdownIcon}>{isCustomerDropdownOpen ? '˄' : '˅'}</Text>
                </Pressable>

                {isCustomerDropdownOpen && (
                  <View style={styles.customerDropdownList}>
                    <Pressable style={styles.customerDropdownOption} onPress={handleSelectManualEntry}>
                      <Text style={styles.customerDropdownOptionText}>Manual Entry</Text>
                      <Text style={styles.customerDropdownOptionSubtext}>
                        Type customer name and address yourself.
                      </Text>
                    </Pressable>

                    <Pressable style={styles.customerDropdownOption} onPress={handleAddNewCustomerOption}>
                      <Text style={styles.customerDropdownOptionText}>+ Add New Customer</Text>
                    </Pressable>

                    {customers.map((existingCustomer) => {
                      const isActive = existingCustomer.id === selectedCustomerId;

                      return (
                        <Pressable
                          key={existingCustomer.id}
                          style={[styles.customerDropdownOption, isActive && styles.customerDropdownOptionActive]}
                          onPress={() => handleSelectExistingCustomer(existingCustomer)}
                        >
                          <Text
                            style={[
                              styles.customerDropdownOptionText,
                              isActive && styles.customerDropdownOptionTextActive,
                            ]}
                          >
                            {existingCustomer.name}
                          </Text>
                          <Text style={styles.customerDropdownOptionSubtext}>{existingCustomer.address}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {selectedCustomer ? (
                  <View>
                    <Text style={styles.selectedCustomerMeta}>
                      Using saved customer details for {selectedCustomer.name}.
                    </Text>
                    {(selectedCustomer.phone || selectedCustomer.email) && (
                      <Text style={styles.selectedCustomerMeta}>
                        {selectedCustomer.phone ? `Phone: ${selectedCustomer.phone}` : ''}
                        {selectedCustomer.phone && selectedCustomer.email ? ' • ' : ''}
                        {selectedCustomer.email ? `Email: ${selectedCustomer.email}` : ''}
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text style={styles.selectedCustomerMeta}>Type a customer name if they are not saved yet.</Text>
                )}
              </View>

              <View style={styles.loadInfoCard}>
                <Text style={styles.sectionTitle}>🚛 Job / Load Info</Text>

                <View style={styles.loadInfoGrid}>
                  <Field label={invoiceLabels.po} value={poNumber} onChangeText={setPoNumber} />
                  <Field label={invoiceLabels.bol} value={bolNumber} onChangeText={setBolNumber} />
                </View>

                <View style={styles.loadAddressGrid}>
                  <Field label={invoiceLabels.shipper} value={shipper} onChangeText={setShipper} multiline />
                  <Field label={invoiceLabels.consignee} value={consignee} onChangeText={setConsignee} multiline />
                </View>
              </View>

              <View style={styles.freightRow}>
                <Field
                  label={invoiceLabels.description}
                  value={freightDescription}
                  onChangeText={setFreightDescription}
                />
              </View>

              <View style={styles.statusSection}>
                <Text style={styles.fieldLabel}>Status</Text>
                <View style={styles.statusGrid}>
                  {invoiceStatuses.map((statusName) => {
                    const isActive = statusName === status;

                    return (
                      <Pressable
                        key={statusName}
                        style={[styles.statusChip, isActive && styles.statusChipActive]}
                        onPress={() => setStatus(statusName)}
                      >
                        <Text style={[styles.statusChipText, isActive && styles.statusChipTextActive]}>
                          {statusName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.sectionDivider} />

              <View style={styles.lineItemsHeader}>
                <Text style={styles.sectionTitle}>Work & Charges</Text>
                <Pressable style={styles.addLineButton} onPress={handleAddLineItem}>
                  <Text style={styles.addLineButtonText}>+ Add Charge</Text>
                </Pressable>
              </View>

              <View style={styles.lineItemTable}>
                <View style={styles.lineItemHeader}>
                  <Text style={[styles.tableHeaderText, styles.descriptionColumn]}>Description</Text>
                  <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
                </View>

                {lineItems.map((item, index) => (
                  <View key={item.id} style={styles.lineItemRow}>
                    <TextInput
                      onChangeText={(value) => updateLineItem(index, 'description', value)}
                      style={[styles.lineItemText, styles.descriptionColumn]}
                      value={item.description}
                    />
                    <TextInput
                      keyboardType="decimal-pad"
                      onChangeText={(value) => updateLineItem(index, 'amount', value)}
                      style={[styles.lineItemAmount, styles.amountColumn]}
                      value={item.amount}
                    />
                    <Pressable
                      accessibilityLabel={`Remove line item ${index + 1}`}
                      style={styles.removeLineButton}
                      onPress={() => handleRemoveLineItem(index)}
                    >
                      <Text style={styles.removeLineButtonText}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </View>

              <Pressable style={styles.attachCard}>
                <View style={styles.attachIcon}>
                  <Text style={styles.attachIconText}>+</Text>
                </View>

                <View style={styles.attachCopy}>
                  <Text style={styles.attachTitle}>Attach signed paperwork</Text>
                  <Text style={styles.attachText}>Upload BOLs, rate confirmations, or signed delivery paperwork later.</Text>
                </View>
              </Pressable>

              <View style={styles.totalSection}>
                <Text style={styles.totalLabel}>Customer Owes</Text>
                <Text style={styles.totalValue}>{invoiceTotalDisplay}</Text>
              </View>
            </View>
          {!showSideActions && invoiceActionsCard}
        </View>

        {showSideActions && <View style={styles.actionsColumn}>{invoiceActionsCard}</View>}
      </View>
    </AppShell>
  );
}

function buildInvoiceTemplate({
  businessLogoUri,
  watermarkLogoUri,
  businessName,
  businessContactName,
  businessAddress,
  businessPhone,
  businessEmail,
  businessWebsite,
  number,
  date,
  terms,
  customer,
  poNumber,
  bolNumber,
  shipper,
  consignee,
  freightDescription,
  lineItems,
  invoiceTotal,
  customerEmail,
  invoiceNotes,
  paymentInstructions,
}: {
  businessLogoUri: string;
  watermarkLogoUri: string;
  businessName: string;
  businessContactName: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  businessWebsite: string;
  number: string;
  date: string;
  terms: string;
  customer: string;
  poNumber: string;
  bolNumber: string;
  shipper: string;
  consignee: string;
  freightDescription: string;
  lineItems: LineItemDraft[];
  invoiceTotal: string;
  customerEmail: string;
  invoiceNotes: string;
  paymentInstructions: string;
}) {
  const rows = lineItems
    .filter((item) => item.description.trim() || parseMoneyInputToCents(item.amount) !== 0)
    .map(
      (item) => `
        <tr>
          <td>${item.description}</td>
          <td class="amount">${item.amount}</td>
        </tr>
      `,
    )
    .join('');
  const businessDetails = [
    businessContactName,
    businessAddress,
    businessPhone,
    businessEmail,
    businessWebsite,
  ].filter(Boolean).join('<br />');
  const invoiceFooterSections = [
    invoiceNotes
      ? `
          <section class="note-block">
            <div class="label">Notes</div>
            <div class="note-value">${invoiceNotes}</div>
          </section>
        `
      : '',
    paymentInstructions
      ? `
          <section class="note-block">
            <div class="label">Payment Instructions</div>
            <div class="note-value">${paymentInstructions}</div>
          </section>
        `
      : '',
  ].join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Invoice #${number}</title>
        <style>
          @page { size: letter; margin: 0.5in; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #f4f4f5;
            color: #18181b;
            font-family: Arial, Helvetica, sans-serif;
          }
          .page {
            isolation: isolate;
            width: 8.5in;
            min-height: 11in;
            margin: 0 auto;
            background: #ffffff;
            padding: 0.55in;
            position: relative;
          }
          .watermark {
            left: 50%;
            max-height: 4.9in;
            max-width: 4.9in;
            opacity: 0.035;
            pointer-events: none;
            position: absolute;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 58%;
            z-index: 0;
          }
          .powered-by {
            bottom: 0.28in;
            color: #71717a;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.2px;
            opacity: 0.42;
            position: absolute;
            right: 0.42in;
            z-index: 2;
          }
          .page-content {
            position: relative;
            z-index: 1;
          }
          .top {
            align-items: flex-start;
            border-bottom: 3px solid #ff7a00;
            display: flex;
            justify-content: space-between;
            padding-bottom: 24px;
          }
          .logo {
            height: 92px;
            object-fit: contain;
          }
          .business-details {
            color: #52525b;
            font-size: 12px;
            font-weight: 700;
            line-height: 1.6;
            margin-top: 8px;
          }
          .business-name {
            color: #18181b;
            font-size: 15px;
            font-weight: 900;
            margin-top: 12px;
          }
          .invoice-title {
            color: #ff7a00;
            font-size: 34px;
            font-weight: 900;
            letter-spacing: 1px;
            margin: 0;
            text-align: right;
          }
          .invoice-meta {
            color: #52525b;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.8;
            margin-top: 10px;
            text-align: right;
          }
          .grid {
            display: grid;
            gap: 18px;
            grid-template-columns: repeat(3, 1fr);
            margin-top: 28px;
          }
          .block {
            border: 1px solid #e4e4e7;
            border-radius: 14px;
            padding: 14px;
          }
          .block.wide { grid-column: span 3; }
          .block.half { grid-column: span 1.5; }
          .label {
            color: #71717a;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0.5px;
            margin-bottom: 7px;
            text-transform: uppercase;
          }
          .value {
            color: #18181b;
            font-size: 15px;
            font-weight: 800;
            line-height: 1.35;
          }
          .customer-contact {
            color: #52525b;
            font-size: 12px;
            font-weight: 700;
            line-height: 1.35;
            margin-top: 6px;
            overflow-wrap: anywhere;
          }
          .address-grid {
            display: grid;
            gap: 18px;
            grid-template-columns: 1fr 1fr;
            margin-top: 18px;
          }
          table {
            border-collapse: collapse;
            margin-top: 28px;
            width: 100%;
          }
          th {
            background: #18181b;
            color: #ffffff;
            font-size: 12px;
            letter-spacing: 0.5px;
            padding: 13px;
            text-align: left;
            text-transform: uppercase;
          }
          td {
            border-bottom: 1px solid #e4e4e7;
            font-size: 15px;
            font-weight: 700;
            padding: 15px 13px;
          }
          .amount { text-align: right; }
          .summary-row {
            align-items: flex-start;
            display: flex;
            gap: 18px;
            justify-content: space-between;
            margin-top: 24px;
          }
          .summary-row-total-only {
            justify-content: flex-end;
          }
          .notes-column {
            display: flex;
            flex: 1;
            flex-direction: column;
            gap: 12px;
            min-width: 0;
          }
          .total {
            align-items: flex-end;
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
            width: 2.15in;
          }
          .total-label {
            color: #71717a;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
          }
          .total-value {
            color: #ff7a00;
            font-size: 24px;
            font-weight: 900;
            margin-top: 3px;
          }
          .footer {
            border-top: 1px solid #e4e4e7;
            color: #71717a;
            font-size: 12px;
            font-weight: 700;
            margin-top: 42px;
            padding-top: 16px;
          }
          .note-block {
            border: 1px solid #e4e4e7;
            border-radius: 14px;
            min-height: 108px;
            padding: 18px;
          }
          .note-value {
            color: #3f3f46;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.45;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <main class="page">
          <img class="watermark" src="${watermarkLogoUri}" alt="" aria-hidden="true" />
          <div class="page-content">
            <section class="top">
              <div>
                <img class="logo" src="${businessLogoUri}" alt="${businessName}" />
                <div class="business-name">${businessName}</div>
                ${businessDetails ? `<div class="business-details">${businessDetails}</div>` : ''}
              </div>
              <div>
                <h1 class="invoice-title">INVOICE</h1>
                <div class="invoice-meta">
                  Invoice #${number}<br />
                  Invoice Date: ${date}<br />
                  Terms: ${terms}
                </div>
              </div>
            </section>

            <section class="grid">
              <div class="block">
                <div class="label">Customer</div>
                <div class="value">${customer}</div>
                ${customerEmail ? `<div class="customer-contact">${customerEmail}</div>` : ''}
              </div>
              <div class="block">
                <div class="label">${invoiceLabels.po}</div>
                <div class="value">${poNumber}</div>
              </div>
              <div class="block">
                <div class="label">${invoiceLabels.bol}</div>
                <div class="value">${bolNumber}</div>
              </div>
            </section>

          <section class="address-grid">
            <div class="block">
              <div class="label">${invoiceLabels.shipper}</div>
              <div class="value">${shipper}</div>
            </div>
            <div class="block">
              <div class="label">${invoiceLabels.consignee}</div>
              <div class="value">${consignee}</div>
            </div>
          </section>

          <section class="grid">
            <div class="block wide">
              <div class="label">${invoiceLabels.description}</div>
              <div class="value">${freightDescription}</div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th class="amount">Amount</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <section class="summary-row${invoiceFooterSections ? '' : ' summary-row-total-only'}">
            ${invoiceFooterSections ? `<div class="notes-column">${invoiceFooterSections}</div>` : ''}
            <div class="total">
              <div class="total-label">Invoice Total</div>
              <div class="total-value">${invoiceTotal}</div>
            </div>
          </section>

          <section class="footer">
            ${businessName}
          </section>
          </div>
          <div class="powered-by">Powered by Blue Collar Books</div>
        </main>
      </body>
    </html>
  `;
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
  keyboardType?: KeyboardTypeOptions;
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
    borderColor: 'rgba(255, 122, 0, 0.36)',
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
    backgroundColor: '#ff7a00',
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
  invoiceLayout: {
    gap: 24,
    paddingBottom: 36,
  },
  invoiceLayoutDesktop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  invoiceFormColumn: {
    flex: 1,
    gap: 24,
    minWidth: 0,
  },
  actionsColumn: {
    flexBasis: 264,
    flexShrink: 0,
  },
  actionsCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 18,
    borderWidth: 1,
    gap: 18,
    padding: 18,
  },
  actionsCardSticky: {
    position: 'sticky',
    top: 16,
    zIndex: 20,
  },
  actionsCardHeader: {
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    paddingBottom: 14,
  },
  actionsCardTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  actionsCardMeta: {
    color: '#ff7a00',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 5,
  },
  actionGroup: {
    gap: 10,
  },
  actionGroupLabel: {
    color: '#737373',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  panelActionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
  },
  formCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    padding: 28,
  },
  compactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  customerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: 18,
  },
  customerSelectorSection: {
    gap: 10,
    marginTop: 18,
  },
  customerSelectorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  customerChip: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  customerChipActive: {
    backgroundColor: 'rgba(255, 122, 0, 0.14)',
    borderColor: 'rgba(255, 122, 0, 0.45)',
  },
  customerChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  customerChipTextActive: {
    color: '#ff7a00',
  },
  customerDropdown: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  customerDropdownText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  customerDropdownIcon: {
    color: '#a3a3a3',
    fontSize: 16,
    fontWeight: '900',
  },
  customerDropdownList: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
    overflow: 'hidden',
  },
  customerDropdownOption: {
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  customerDropdownOptionActive: {
    backgroundColor: 'rgba(255, 122, 0, 0.12)',
  },
  customerDropdownOptionText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '900',
  },
  customerDropdownOptionTextActive: {
    color: '#ff7a00',
  },
  customerDropdownOptionSubtext: {
    color: '#a3a3a3',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  selectedCustomerMeta: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '600',
  },
  loadInfoCard: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 18,
    borderWidth: 1,
    gap: 18,
    marginTop: 22,
    padding: 18,
  },
  loadInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  loadAddressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  addressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: 18,
  },
  freightRow: {
    marginTop: 18,
  },
  statusSection: {
    gap: 10,
    marginTop: 18,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statusChip: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusChipActive: {
    backgroundColor: 'rgba(255, 122, 0, 0.14)',
    borderColor: 'rgba(255, 122, 0, 0.45)',
  },
  statusChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  statusChipTextActive: {
    color: '#ff7a00',
  },
  field: {
    flexBasis: '31%',
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
  sectionDivider: {
    backgroundColor: '#323232',
    height: 1,
    marginVertical: 24,
  },
  lineItemsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  addLineButton: {
    backgroundColor: 'rgba(255, 122, 0, 0.12)',
    borderColor: 'rgba(255, 122, 0, 0.42)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addLineButtonText: {
    color: '#ff7a00',
    fontSize: 14,
    fontWeight: '900',
  },
  lineItemTable: {
    gap: 12,
  },
  lineItemHeader: {
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: 12,
  },
  tableHeaderText: {
    color: '#737373',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  lineItemRow: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  descriptionColumn: {
    flex: 1,
  },
  amountColumn: {
    flex: 0.28,
    textAlign: 'right',
  },
  lineItemText: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '700',
  },
  lineItemAmount: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  removeLineButton: {
    backgroundColor: '#2b2b2b',
    borderColor: '#3d3d3d',
    borderRadius: 12,
    borderWidth: 1,
    marginLeft: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  removeLineButtonText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '900',
  },
  attachCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 122, 0, 0.08)',
    borderColor: 'rgba(255, 122, 0, 0.32)',
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
    padding: 18,
  },
  attachIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 122, 0, 0.16)',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  attachIconText: {
    color: '#ff7a00',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 28,
  },
  attachCopy: {
    flex: 1,
    gap: 4,
  },
  attachTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  attachText: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '600',
  },
  totalSection: {
    alignItems: 'flex-end',
    borderTopColor: '#323232',
    borderTopWidth: 1,
    marginTop: 24,
    paddingTop: 22,
  },
  totalLabel: {
    color: '#a3a3a3',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  totalValue: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '900',
  },
  emailButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  emailButtonDisabled: {
    opacity: 0.45,
  },
  emailButtonText: {
    color: '#d4d4d4',
    fontSize: 16,
    fontWeight: '900',
  },
  emailButtonTextDisabled: {
    color: '#8c8c8c',
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
  previewButton: {
    backgroundColor: 'rgba(255, 122, 0, 0.12)',
    borderColor: 'rgba(255, 122, 0, 0.42)',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  previewButtonText: {
    color: '#ff7a00',
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
