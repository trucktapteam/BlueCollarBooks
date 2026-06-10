import { Asset } from 'expo-asset';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardTypeOptions } from 'react-native';
import {
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { AppShell } from '@/components/AppShell';
import { businessProfile } from '@/data/mockBusiness';
import { type Customer, useCustomers } from '@/data/mockCustomers';
import {
    formatInvoiceAmount,
    type Invoice,
    invoiceDraft,
    invoiceLabels,
    type InvoiceLineItem,
    invoiceLineItems,
    type InvoiceStatus,
    invoiceStatuses,
    parseInvoiceAmount,
    saveInvoice,
    useInvoices,
} from '@/data/mockInvoices';

function getNextInvoiceNumber(invoices: Invoice[]) {
    const numericValues = invoices
        .map((invoice) => Number(invoice.invoice.replace(/\D/g, '')))
        .filter((value) => Number.isFinite(value) && value > 0);

    const nextNumber = numericValues.length ? Math.max(...numericValues) + 1 : Number(invoiceDraft.number) || 0;
    return String(nextNumber);
}

export default function NewInvoiceScreen() {
  const businessLogoUri = Asset.fromModule(businessProfile.logo).uri;
  const searchParams = useLocalSearchParams();
  const customers = useCustomers();
  const invoices = useInvoices();
  const [originalInvoiceNumber, setOriginalInvoiceNumber] = useState<string | undefined>(undefined);
  const [number, setNumber] = useState(() => getNextInvoiceNumber(invoices));
  const [date, setDate] = useState(invoiceDraft.date);
  const [terms, setTerms] = useState(invoiceDraft.terms);
  const [customer, setCustomer] = useState(invoiceDraft.customer);
  const [selectedCustomerName, setSelectedCustomerName] = useState('');
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
  const [poNumber, setPoNumber] = useState(invoiceDraft.poNumber);
  const [bolNumber, setBolNumber] = useState(invoiceDraft.bolNumber);
  const [shipper, setShipper] = useState(invoiceDraft.shipper);
  const [consignee, setConsignee] = useState(invoiceDraft.consignee);
  const [freightDescription, setFreightDescription] = useState(invoiceDraft.freightDescription);
  const [status, setStatus] = useState<InvoiceStatus>('Draft');
  const [lineItems, setLineItems] = useState(invoiceLineItems);
  const invoiceTotal = useMemo(
    () => formatInvoiceAmount(lineItems.reduce((total, item) => total + parseInvoiceAmount(item.amount), 0)),
    [lineItems]
  );

  function updateLineItem(index: number, field: 'description' | 'amount', value: string) {
    setLineItems((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  function handleAddLineItem() {
    setLineItems((items) => [...items, { description: '', amount: '$0' }]);
  }

  const invoiceParam = typeof searchParams.invoice === 'string' ? searchParams.invoice : '';
  const preselectedCustomerName =
    typeof searchParams.customer === 'string' ? searchParams.customer : '';

  const selectedCustomer = useMemo(
    () => customers.find((item) => item.name === selectedCustomerName),
    [customers, selectedCustomerName]
  );

  useEffect(() => {
    if (invoiceParam && !originalInvoiceNumber) {
      const foundInvoice = invoices.find((item) => item.invoice === invoiceParam);

      if (foundInvoice) {
        setOriginalInvoiceNumber(foundInvoice.invoice);
        setNumber(foundInvoice.invoice);
        setDate(foundInvoice.invoiceDate);
        setTerms(foundInvoice.terms ?? invoiceDraft.terms);
        setCustomer(foundInvoice.customer);
        setSelectedCustomerName(foundInvoice.customer);
        setPoNumber(foundInvoice.poNumber ?? invoiceDraft.poNumber);
        setBolNumber(foundInvoice.bolNumber ?? invoiceDraft.bolNumber);
        setShipper(foundInvoice.shipper ?? invoiceDraft.shipper);
        setConsignee(foundInvoice.consignee ?? invoiceDraft.consignee);
        setFreightDescription(foundInvoice.freightDescription ?? invoiceDraft.freightDescription);
        setStatus(foundInvoice.status);
        setLineItems(foundInvoice.lineItems ?? invoiceLineItems);
      }
      return;
    }

    if (!preselectedCustomerName || selectedCustomerName) {
      return;
    }

    const foundCustomer = customers.find((item) => item.name === preselectedCustomerName);

    if (foundCustomer) {
      handleSelectCustomer(foundCustomer);
    }
  }, [customers, invoices, invoiceParam, originalInvoiceNumber, preselectedCustomerName, selectedCustomerName]);

  function handleSelectCustomer(selectedCustomer: Customer) {
    setSelectedCustomerName(selectedCustomer.name);
    setCustomer(selectedCustomer.name);
    setConsignee(selectedCustomer.address);
  }

  function handleSelectExistingCustomer(selectedCustomer: Customer) {
    setIsCustomerDropdownOpen(false);
    handleSelectCustomer(selectedCustomer);
  }

  function handleSelectManualEntry() {
    setIsCustomerDropdownOpen(false);
    setSelectedCustomerName('');
    setCustomer('');
    setConsignee('');
  }

  function handleAddNewCustomerOption() {
    setIsCustomerDropdownOpen(false);
    router.push('/new-customer');
  }

  function handleCustomerNameChange(value: string) {
    setCustomer(value);
    setSelectedCustomerName('');
  }

  function handleSaveDraft() {
    saveInvoice(
      {
        invoice: number,
        customer: customer.trim(),
        amount: invoiceTotal,
        status,
        invoiceDate: date,
        poNumber,
        bolNumber,
        shipper,
        consignee,
        freightDescription,
        lineItems,
      },
      originalInvoiceNumber
    );
    router.replace('/invoices');
  }

  const previewPdf = () => {
    const html = buildInvoiceTemplate({
      businessLogoUri,
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
      customerPhone: selectedCustomer?.phone ?? '',
      customerEmail: selectedCustomer?.email ?? '',
    });

    if (Platform.OS === 'web') {
      const previewWindow = window.open('', '_blank');

      if (previewWindow) {
        previewWindow.document.write(html);
        previewWindow.document.close();
      }
    }
  };

  return (
    <AppShell activeNav="Invoices">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Invoices</Text>
          <Text style={styles.heading}>{originalInvoiceNumber ? 'Edit Invoice' : 'New Invoice'}</Text>
        </View>

        <Pressable style={styles.backButton} onPress={() => router.push('/invoices')}>
          <Text style={styles.backButtonText}>Back to invoices</Text>
        </Pressable>
      </View>

              <View style={styles.formCard}>
                <View style={styles.compactRow}>
                <Field label="Invoice #" value={number} onChangeText={setNumber} />
                <Field label="Invoice Date" value={date} onChangeText={setDate} />
                <Field label="Terms" value={terms} onChangeText={setTerms} />
              </View>

              <View style={styles.customerRow}>
                <Field label="Customer" value={customer} onChangeText={handleCustomerNameChange} />
                <Field label={invoiceLabels.po} value={poNumber} onChangeText={setPoNumber} />
                <Field label={invoiceLabels.bol} value={bolNumber} onChangeText={setBolNumber} />
              </View>

              <View style={styles.customerSelectorSection}>
                <Text style={styles.fieldLabel}>Select existing customer</Text>
                <Pressable style={styles.customerDropdown} onPress={() => setIsCustomerDropdownOpen((open) => !open)}>
                  <Text style={styles.customerDropdownText}>
                    {selectedCustomerName || customer || 'Select existing customer or type manually'}
                  </Text>
                  <Text style={styles.customerDropdownIcon}>{isCustomerDropdownOpen ? '˄' : '˅'}</Text>
                </Pressable>

                {isCustomerDropdownOpen && (
                  <View style={styles.customerDropdownList}>
                    <Pressable style={styles.customerDropdownOption} onPress={handleSelectManualEntry}>
                      <Text style={styles.customerDropdownOptionText}>Manual Entry</Text>
                      <Text style={styles.customerDropdownOptionSubtext}>
                        Type customer name and address manually.
                      </Text>
                    </Pressable>

                    <Pressable style={styles.customerDropdownOption} onPress={handleAddNewCustomerOption}>
                      <Text style={styles.customerDropdownOptionText}>+ Add New Customer</Text>
                    </Pressable>

                    {customers.map((existingCustomer) => {
                      const isActive = existingCustomer.name === selectedCustomerName;

                      return (
                        <Pressable
                          key={existingCustomer.name}
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
                  <Text style={styles.selectedCustomerMeta}>Type a customer name manually if they are not saved yet.</Text>
                )}
              </View>

              <View style={styles.addressGrid}>
                <Field label={invoiceLabels.shipper} value={shipper} onChangeText={setShipper} multiline />
                <Field label={invoiceLabels.consignee} value={consignee} onChangeText={setConsignee} multiline />
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
                <Text style={styles.sectionTitle}>Line Items</Text>
                <Pressable style={styles.addLineButton} onPress={handleAddLineItem}>
                  <Text style={styles.addLineButtonText}>+ Add Line Item</Text>
                </Pressable>
              </View>

              <View style={styles.lineItemTable}>
                <View style={styles.lineItemHeader}>
                  <Text style={[styles.tableHeaderText, styles.descriptionColumn]}>Description</Text>
                  <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
                </View>

                {lineItems.map((item, index) => (
                  <View key={index} style={styles.lineItemRow}>
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
                <Text style={styles.totalLabel}>Invoice Total</Text>
                <Text style={styles.totalValue}>{invoiceTotal}</Text>
              </View>

              <View style={styles.bottomActionBar}>
                <View>
                  <Text style={styles.actionLabel}>Ready when the paperwork is.</Text>
                  <Text style={styles.actionSubtext}>Mock-only draft. No backend storage yet.</Text>
                </View>

                <View style={styles.actionRow}>
                  <Pressable style={styles.secondaryButton} onPress={handleSaveDraft}>
                    <Text style={styles.secondaryButtonText}>Save Draft</Text>
                  </Pressable>

                  <Pressable style={styles.previewButton} onPress={previewPdf}>
                    <Text style={styles.previewButtonText}>Preview PDF</Text>
                  </Pressable>

                  <Pressable style={styles.primaryButton} onPress={previewPdf}>
                    <Text style={styles.primaryButtonText}>Generate PDF</Text>
                  </Pressable>
                </View>
              </View>
            </View>
    </AppShell>
  );
}

function buildInvoiceTemplate({
  businessLogoUri,
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
  customerPhone,
  customerEmail,
}: {
  businessLogoUri: string;
  number: string;
  date: string;
  terms: string;
  customer: string;
  poNumber: string;
  bolNumber: string;
  shipper: string;
  consignee: string;
  freightDescription: string;
  lineItems: InvoiceLineItem[];
  invoiceTotal: string;
  customerPhone: string;
  customerEmail: string;
}) {
  const rows = lineItems
    .map(
      (item) => `
        <tr>
          <td>${item.description}</td>
          <td class="amount">${item.amount}</td>
        </tr>
      `,
    )
    .join('');

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
            width: 8.5in;
            min-height: 11in;
            margin: 0 auto;
            background: #ffffff;
            padding: 0.55in;
          }
          .top {
            align-items: flex-start;
            border-bottom: 3px solid #f97316;
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
            color: #f97316;
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
          .total {
            align-items: flex-end;
            display: flex;
            flex-direction: column;
            margin-top: 28px;
          }
          .total-label {
            color: #71717a;
            font-size: 13px;
            font-weight: 900;
            text-transform: uppercase;
          }
          .total-value {
            color: #f97316;
            font-size: 42px;
            font-weight: 900;
            margin-top: 4px;
          }
          .footer {
            border-top: 1px solid #e4e4e7;
            color: #71717a;
            font-size: 12px;
            font-weight: 700;
            margin-top: 42px;
            padding-top: 16px;
          }
        </style>
      </head>
      <body>
        <main class="page">
          <section class="top">
            <div>
              <img class="logo" src="${businessLogoUri}" alt="${businessProfile.businessName}" />
              <div class="business-name">${businessProfile.businessName}</div>
              <div class="business-details">
                ${businessProfile.address}<br />
                ${businessProfile.phone}<br />
                ${businessProfile.email}
              </div>
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
              ${customerPhone || customerEmail ? `<div class="customer-contact">${customerPhone ? `Phone: ${customerPhone}` : ''}${customerPhone && customerEmail ? ' &bull; ' : ''}${customerEmail ? `Email: ${customerEmail}` : ''}</div>` : ''}
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

          <section class="total">
            <div class="total-label">Invoice Total</div>
            <div class="total-value">${invoiceTotal}</div>
          </section>

          <section class="footer">
            ${businessProfile.businessName} invoice preview. Mock data only.
          </section>
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
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderColor: 'rgba(249, 115, 22, 0.45)',
  },
  customerChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  customerChipTextActive: {
    color: '#f97316',
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
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
  },
  customerDropdownOptionText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '900',
  },
  customerDropdownOptionTextActive: {
    color: '#f97316',
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
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderColor: 'rgba(249, 115, 22, 0.45)',
  },
  statusChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  statusChipTextActive: {
    color: '#f97316',
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
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.42)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addLineButtonText: {
    color: '#f97316',
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
  attachCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderColor: 'rgba(249, 115, 22, 0.32)',
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
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  attachIconText: {
    color: '#f97316',
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
  previewButton: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.42)',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  previewButtonText: {
    color: '#f97316',
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
