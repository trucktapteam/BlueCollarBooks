export type Customer = {
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

export const customers: Customer[] = [
  {
    name: 'Independent Steel',
    contact: 'Mason Clarke',
    phone: '(502) 555-0148',
    email: 'dispatch@independentsteel.example',
    address: '1400 River Road, Louisville, KY',
    notes: 'Flatbed steel loads. Usually pays on Net 30.',
  },
  {
    name: 'Louisville Dryer',
    contact: 'Dana Whitaker',
    phone: '(502) 555-0192',
    email: 'ap@louisvilledryer.example',
    address: '88 Industrial Parkway, Louisville, KY',
    notes: 'Repair equipment freight and rush shipments.',
  },
  {
    name: 'ABC Steel',
    contact: 'Riley Brooks',
    phone: '(812) 555-0175',
    email: 'billing@abcsteel.example',
    address: '240 Foundry Lane, Jeffersonville, IN',
    notes: 'Smaller recurring steel runs.',
  },
];
