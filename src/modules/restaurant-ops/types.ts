import type {
  CashMovementType,
  InventoryTransactionType,
  InvoiceStatus,
  InvoiceType,
  JournalEntryStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  TableStatus
} from "../../types.js";

export type Table = {
  id: string;
  restaurantId: string;
  name: string;
  area: string;
  capacity: number;
  status: TableStatus;
  currentOrderId: string;
  qrCode: string;
  createdAt?: string;
  updatedAt?: string;
};

export type OrderLine = {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  notes: string;
  modifiers: string[];
  total: number;
};

export type Order = {
  id: string;
  restaurantId: string;
  name: string;
  tableId: string;
  type: OrderType;
  source: "QR" | "WAITER" | "POS";
  status: OrderStatus;
  items: OrderLine[];
  subTotal: number;
  discount: number;
  tax: number;
  serviceCharge: number;
  total: number;
  paidAmount: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  paymentMethod: PaymentMethod;
  notes: string;
  orderedAt?: string;
  createdById: string;
  closedById: string;
  invoiceId: string;
  paymentId: string;
  inventoryDeductedAt: string;
  completedAt: string;
  cancelledAt: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type InventoryItem = {
  id: string;
  restaurantId: string;
  name: string;
  category: string;
  unit: string;
  currentQuantity: number;
  minimumQuantity: number;
  averageCost: number;
  sellPrice: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type RecipeIngredient = {
  id: string;
  restaurantId: string;
  menuItemId: string;
  inventoryItemId: string;
  quantity: number;
  unit: string;
  createdAt?: string;
  updatedAt?: string;
};

export type InventoryTransaction = {
  id: string;
  restaurantId: string;
  inventoryItemId: string;
  type: InventoryTransactionType;
  quantity: number;
  balanceAfter: number;
  referenceType: string;
  referenceId: string;
  reason: string;
  createdById: string;
  createdAt?: string;
};

export type Supplier = {
  id: string;
  restaurantId: string;
  name: string;
  phone: string;
  balance: number;
  notes: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type InvoiceItem = {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type Invoice = {
  id: string;
  restaurantId: string;
  type: InvoiceType;
  status: InvoiceStatus;
  orderId: string;
  supplierId: string;
  items: InvoiceItem[];
  subTotal: number;
  discount: number;
  tax: number;
  serviceCharge: number;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: PaymentMethod;
  dueDate: string;
  notes: string;
  createdById: string;
  createdAt?: string;
  updatedAt?: string;
};

export type OperationalPayment = {
  id: string;
  restaurantId: string;
  invoiceId: string;
  orderId: string;
  supplierId: string;
  type: InvoiceType;
  amount: number;
  method: PaymentMethod;
  note: string;
  createdById: string;
  paidAt: string;
  createdAt?: string;
};

export type Expense = {
  id: string;
  restaurantId: string;
  category: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paidAt: string;
  notes: string;
  createdById: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CashRegister = {
  id: string;
  restaurantId: string;
  name: string;
  openingBalance: number;
  currentBalance: number;
  isOpen: boolean;
  openedById: string;
  closedById: string;
  openedAt: string;
  closedAt: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CashMovement = {
  id: string;
  restaurantId: string;
  cashRegisterId: string;
  type: CashMovementType;
  amount: number;
  referenceType: string;
  referenceId: string;
  note: string;
  createdById: string;
  createdAt?: string;
};

export type Account = {
  id: string;
  restaurantId: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type JournalEntryLine = {
  accountId: string;
  debit: number;
  credit: number;
  memo: string;
};

export type JournalEntry = {
  id: string;
  restaurantId: string;
  status: JournalEntryStatus;
  referenceType: string;
  referenceId: string;
  lines: JournalEntryLine[];
  memo: string;
  createdById: string;
  postedAt: string;
  createdAt?: string;
  updatedAt?: string;
};
