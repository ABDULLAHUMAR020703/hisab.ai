import type { OfficialImportTemplate } from '../../types'

export const INVENTORY_OFFICIAL_TEMPLATES: OfficialImportTemplate[] = [
  {
    id: 'standard',
    name: 'hisab.ai Inventory',
    columns: [
      { header: 'Product / Service Name', fieldKey: 'name', required: true, example: 'Dell Latitude 5540 Laptop' },
      { header: 'Quantity On Hand', fieldKey: 'quantity', example: '25' },
      { header: 'Item Type', fieldKey: 'itemType', example: 'Inventory' },
      { header: 'Category', fieldKey: 'category', example: 'Hardware' },
      { header: 'SKU', fieldKey: 'itemCode', example: 'SKU-10042' },
      { header: 'Purchase Cost Includes Tax', fieldKey: 'purchaseCostIncludesTax', example: 'No' },
      { header: 'Sales Price Includes Tax', fieldKey: 'salesPriceIncludesTax', example: 'Yes' },
      { header: 'Price', fieldKey: 'salePrice', example: '4500' },
      { header: 'Cost', fieldKey: 'costPrice', example: '3800' },
      { header: 'Income Account', fieldKey: 'incomeAccount', example: '4100 Sales Revenue' },
      { header: 'Expense Account', fieldKey: 'expenseAccount', example: '5000 Cost of Goods Sold' },
      { header: 'Inventory Asset Account', fieldKey: 'inventoryAssetAccount', example: '1500 Inventory Asset' },
      { header: 'Sales Description', fieldKey: 'description', example: '14-inch business laptop with Intel Core i7' },
      { header: 'Purchase Description', fieldKey: 'purchaseDescription', example: 'Procured from authorised Dell distributor' },
      { header: 'Reorder Point', fieldKey: 'minQuantity', example: '5' },
      { header: 'Preferred Supplier', fieldKey: 'preferredSupplier', example: 'Al Rajhi Trading Establishment' },
    ],
  },
]
