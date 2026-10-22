import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('customer signs in and sees the catalog and their orders', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('customer@example.com');
    await page.getByLabel('Password').fill('Customer123!Pass');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('link', { name: 'Catalog' }).click();
    await expect(page.getByPlaceholder('Search by name, SKU, or barcode')).toBeVisible();
    await expect(page.getByText('Wireless Keyboard')).toBeVisible();

    await page.getByRole('link', { name: 'Orders' }).click();
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  });

  test('admin signs in and can reach inventory and purchase orders', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Password').fill('Admin123!Pass');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('link', { name: 'Stock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await page.getByRole('link', { name: 'Purchase Orders' }).click();
    await expect(page.getByRole('heading', { name: 'Purchase orders' })).toBeVisible();
  });

  test('customer cannot reach staff inventory pages', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('customer@example.com');
    await page.getByLabel('Password').fill('Customer123!Pass');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.goto('/inventory');
    await expect(page.getByText('403 — Not permitted')).toBeVisible();
  });
});
