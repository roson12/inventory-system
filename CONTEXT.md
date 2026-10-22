# Inventory Management System

A multi-warehouse inventory and order-management context. It tracks what stock exists, where it is, and every change to it, while separating customers who buy from staff who operate the warehouse.

## Language

### Actors

**User**:
An authenticated account with exactly one role.
_Avoid_: Account, member, profile

**Customer**:
A User with the Customer role who places Customer Orders. A Customer is never a Staff, Admin, or Super Admin.
_Avoid_: Client, buyer, client account

**Staff**:
A User with the Staff role who performs warehouse and order-processing tasks within assigned Warehouses.
_Avoid_: Employee, worker, operator

**Admin**:
A User with the Admin role who manages day-to-day operations but not system-wide security or role policy.
_Avoid_: Manager, superuser

**Super Admin**:
A User with the Super Admin role, the only role allowed to manage role permissions and system settings.
_Avoid_: Owner, root, administrator

**Role**:
One of Customer, Staff, Admin, Super Admin. A User has exactly one Role.
_Avoid_: Group, user type

**Permission**:
A named capability (for example `inventory.adjust`) granted to a Role or overridden per User.
_Avoid_: Right, privilege, scope

### Catalog

**Product**:
A sellable or stockable item identified by a unique SKU.
_Avoid_: Item, SKU (SKU is the identifier, not the Product)

**SKU**:
The unique business identifier of a Product. A barcode is an optional alternate identifier.
_Avoid_: Product code, item number

**Category**:
A hierarchical grouping of Products.
_Avoid_: Product type, department

### Stock

**Warehouse**:
A physical location that holds its own Inventory Balances.
_Avoid_: Store, location, site

**Storage Location**:
An optional subdivision of a Warehouse. Not used for balances in v1.
_Avoid_: Bin, shelf

**On-hand**:
The quantity physically present in a Warehouse.
_Avoid_: Stock, quantity, inventory

**Reserved**:
The quantity of On-hand stock held for confirmed Customer Orders but not yet dispatched.
_Avoid_: Allocated, locked

**Available**:
On-hand minus Reserved. The quantity that may still be sold or moved.
_Avoid_: Free stock, sellable

**Inventory Balance**:
The current On-hand, Reserved, and moving-average unit cost for one Product in one Warehouse.
_Avoid_: Stock level, stock record

**Stock Movement**:
An immutable ledger entry recording a signed quantity change to an Inventory Balance.
_Avoid_: Transaction, adjustment (an Adjustment is a kind of Stock Movement)

**Adjustment**:
A Stock Movement that corrects stock without a purchase or sale, always with a reason and an approver for Staff requests.
_Avoid_: Correction, fix

**Transfer**:
A movement of stock from one Warehouse to another at the source warehouse's carrying cost.
_Avoid_: Relocation, move

### Procurement

**Supplier**:
An external organization from which Products are purchased.
_Avoid_: Vendor, merchant

**Purchase Order**:
A commitment to buy quantities of Products from a Supplier, received into one Warehouse.
_Avoid_: Order, PO (when ambiguous with Customer Order)

**Goods Receipt**:
The recorded arrival of stock against a Purchase Order, which is the only event that increases On-hand stock for a purchase.
_Avoid_: Delivery, intake, receiving

### Sales

**Customer Order**:
A request from a Customer to buy Products. It creates no stock reservation until it is Confirmed.
_Avoid_: Order, sale, sales order

**Confirmation**:
The act of reserving Available stock for a Pending Customer Order, performed by Staff or Admin.
_Avoid_: Approval, acceptance

**Reservation**:
A hold on stock for a Confirmed Customer Order. Releasing a Reservation makes the quantity Available again.
_Avoid_: Allocation, lock

**Dispatch**:
The act of shipping a Confirmed Customer Order, which consumes its Reservations and reduces On-hand.
_Avoid_: Shipment, fulfillment, delivery

**Return**:
A request to send back delivered Products, with optional restocking.
_Avoid_: Refund (a refund is a payment outcome, not the stock event)

## Roles and vocabulary rules

- Use **Customer Order** for sales and **Purchase Order** for procurement. Never write a bare "order".
- Use **On-hand**, **Reserved**, and **Available** deliberately; never write "stock quantity" without specifying which.
- Revenue is not profit. Profit is only reported when moving-average cost data is available.
