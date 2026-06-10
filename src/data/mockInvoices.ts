export const invoiceLabels = {
  description: 'Freight Description',
  shipper: 'Shipper Address',
  consignee: 'Consignee Address',
  bol: 'BOL Number',
  po: 'PO Number',
};

export const invoiceDraft = {
  number: '26032',
  date: '06/09/2026',
  terms: 'Net 30',
  customer: 'Independent Steel',
  poNumber: 'PO-44321',
  bolNumber: 'BOL-99812',
  shipper: 'Address',
  consignee: 'Address',
  freightDescription: 'Steel Beams',
  total: '$625',
};

export const invoiceLineItems = [{ description: 'Flatbed Freight', amount: '$625' }];

export const invoices = [
  {
    invoice: '26031',
    customer: 'Independent Steel',
    amount: '$625',
    status: 'Sent',
    invoiceDate: 'Apr 1, 2026',
  },
  {
    invoice: '26028',
    customer: 'Louisville Dryer',
    amount: '$850',
    status: 'Overdue',
    invoiceDate: 'Mar 18, 2026',
  },
  {
    invoice: '26027',
    customer: 'ABC Steel',
    amount: '$275',
    status: 'Draft',
    invoiceDate: 'Apr 10, 2026',
  },
];

export const waitingToBePaid = [
  { invoice: '#26031', customer: 'Independent Steel Co.', amount: '$625', status: 'Due Apr 14' },
  { invoice: '#26028', customer: 'Louisville Dryer', amount: '$850', status: '14 days overdue' },
  { invoice: '#26027', customer: 'ABC Steel', amount: '$275', status: 'Due tomorrow' },
];
