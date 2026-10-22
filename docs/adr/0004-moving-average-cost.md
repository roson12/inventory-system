# Moving weighted-average cost per Product per Warehouse

Inventory value uses a moving weighted-average unit cost stored on each Inventory Balance. Receipts revalue: `newAvg = (onHand * avg + receivedQty * unitCost) / (onHand + receivedQty)`. Issues, dispatches, and negative adjustments use the current average and do not change it. Transfers move stock at the source average, and the destination revalues with that cost.

**Why:** FIFO layers add substantial table and edge-case complexity for no stated requirement. Moving average is auditable and matches the per-warehouse balances.

**Rules:**
- Opening stock requires an explicit unit cost.
- Returns restock at the original Customer Order item unit price unless an authorized user records a different cost; the chosen cost is written to the Stock Movement.
- Positive adjustments default to current average cost and may specify a cost with permission.
- Every Stock Movement stores `unitCost`, `quantity`, and `balanceAfter`; history is never rewritten.
